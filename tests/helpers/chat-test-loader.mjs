// Loader só dos testes do Chat: deixa rodar o CÓDIGO REAL de lib/whatsapp-*.js
// no Node puro. Importações extensionless (padrão do Next) são resolvidas e
// todo módulo .js de lib/ importado por outro módulo de lib/ vira um stub cujas
// funções vêm de globalThis.__stubs["<nome-do-arquivo>"] — exceto os módulos
// puros (.mjs) e phone-utils, que rodam de verdade.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REAL_JS = new Set(["phone-utils.js", "client-status.js"]);

function findFile(target) {
  for (const candidate of [target, `${target}.js`, `${target}.mjs`, `${target}.jsx`]) {
    if (existsSync(candidate) && !candidate.endsWith("/") && /\.[a-z]+$/.test(candidate)) {
      try { if (readFileSync(candidate)) return candidate; } catch { /* diretório */ }
    }
  }
  return null;
}

function importedNames(parentSource, specifier) {
  const names = new Set();
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const staticRe = new RegExp(`import\\s+(?:([\\w$]+)\\s*,?\\s*)?(?:\\{([^{}]*)\\})?\\s*from\\s*["']${escaped}["']`, "g");
  for (const match of parentSource.matchAll(staticRe)) {
    if (match[1]) names.add("default");
    for (const part of (match[2] || "").split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }
  const dynamicRe = new RegExp(`\\{([^{}]*)\\}\\s*=\\s*await\\s+import\\(\\s*["']${escaped}["']\\s*\\)`, "g");
  for (const match of parentSource.matchAll(dynamicRe)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s*:\s*/)[0].trim();
      if (name) names.add(name);
    }
  }
  return [...names];
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "stub:server-only", shortCircuit: true };
  const parent = context.parentURL || "";
  if (!parent.startsWith("file:") || !(specifier.startsWith("./") || specifier.startsWith("../"))) return nextResolve(specifier, context);

  const parentPath = fileURLToPath(parent);
  const file = findFile(path.resolve(path.dirname(parentPath), specifier));
  if (!file) return nextResolve(specifier, context);
  const base = path.basename(file);
  const parentInLib = path.basename(path.dirname(parentPath)) === "lib";
  const stubIt = parentInLib && file.endsWith(".js") && !REAL_JS.has(base);
  if (!stubIt) return { url: pathToFileURL(file).href, shortCircuit: true };

  const names = importedNames(readFileSync(parentPath, "utf8"), specifier);
  const key = base.replace(/\.[a-z]+$/, "");
  return { url: `stub:${key}?names=${encodeURIComponent(names.join(","))}`, shortCircuit: true };
}

export async function load(url, context, nextLoad) {
  if (url === "stub:server-only") return { format: "module", source: "export {};", shortCircuit: true };
  if (url.startsWith("stub:")) {
    const [, rest] = url.split("stub:");
    const [key, query] = rest.split("?names=");
    const names = decodeURIComponent(query || "").split(",").filter(Boolean);
    const lines = [
      "const S = (globalThis.__stubs ??= {});",
      `const g = (n) => (...args) => { const impl = S[${JSON.stringify(key)}]?.[n]; if (!impl) throw new Error("stub não definido: ${key}." + n); return impl(...args); };`
    ];
    for (const name of names) lines.push(name === "default" ? `export default g("default");` : `export const ${name} = g(${JSON.stringify(name)});`);
    return { format: "module", source: lines.join("\n"), shortCircuit: true };
  }
  return nextLoad(url, context);
}
