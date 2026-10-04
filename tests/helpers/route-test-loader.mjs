// Loader só dos testes de ROTAS (tags de cliente): roda o código REAL de
// app/api/**/route.js e de lib/client-tags.js no Node puro. O alias "@/lib/x"
// é resolvido; módulos de lib listados em REAL rodam de verdade, os demais
// viram stubs cujas funções vêm de globalThis.__stubs["<nome>"]; "next/server"
// vira um NextResponse mínimo ({ status, body }).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REAL = new Set(["client-tags"]);

function findFile(target) {
  for (const candidate of [target, `${target}.js`, `${target}.mjs`]) {
    if (/\.[a-z]+$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

function importedNames(parentSource, specifier) {
  const names = new Set();
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const re = new RegExp(`import\\s+(?:([\\w$]+)\\s*,?\\s*)?(?:\\{([^{}]*)\\})?\\s*from\\s*["']${escaped}["']`, "g");
  for (const match of parentSource.matchAll(re)) {
    if (match[1]) names.add("default");
    for (const part of (match[2] || "").split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }
  return [...names];
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "stub:server-only", shortCircuit: true };
  if (specifier === "next/server") return { url: "stub:next-server", shortCircuit: true };
  const parent = context.parentURL || "";
  const alias = specifier.startsWith("@/");
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  if (!parent.startsWith("file:") || !(alias || relative)) return nextResolve(specifier, context);

  const parentPath = fileURLToPath(parent);
  const base = alias ? path.join(ROOT, specifier.slice(2)) : path.resolve(path.dirname(parentPath), specifier);
  const file = findFile(base);
  if (!file) return nextResolve(specifier, context);
  const key = path.basename(file).replace(/\.[a-z]+$/, "");
  const fromTest = parentPath.startsWith(path.join(ROOT, "tests"));
  if (fromTest || file.endsWith(".mjs") || REAL.has(key)) return { url: pathToFileURL(file).href, shortCircuit: true };

  const names = importedNames(readFileSync(parentPath, "utf8"), specifier);
  return { url: `stub:${key}?names=${encodeURIComponent(names.join(","))}`, shortCircuit: true };
}

export async function load(url, context, nextLoad) {
  if (url === "stub:server-only") return { format: "module", source: "export {};", shortCircuit: true };
  if (url === "stub:next-server") {
    return {
      format: "module",
      shortCircuit: true,
      source: "export const NextResponse = { json: (body, init = {}) => ({ status: init.status || 200, body }) };"
    };
  }
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
