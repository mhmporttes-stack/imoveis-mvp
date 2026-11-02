// Loader só dos testes do Lote de SMS: roda o CÓDIGO REAL de lib/sms-batch.js (e o que ele importa) no Node puro.
// Resolve as importações sem extensão (padrão do Next), ignora "server-only" e troca o acesso ao Supabase
// (lib/supabase e "@/lib/supabase") pelo banco falso de tests/helpers/sms-batch-fake-db.mjs. Existe porque
// o Lote de SMS ficou fora do ar em produção com um ReferenceError (função chamada e não definida) que nenhum
// teste de regra pura enxergava — ver docs/INCIDENTES.md (2026-11-02, Lote de SMS).
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let root = "";
let fakeUrl = "";

export function initialize(data) {
  root = data.root;
  fakeUrl = data.fakeUrl;
}

const isFile = (candidate) => {
  try { return existsSync(candidate) && statSync(candidate).isFile(); } catch { return false; }
};

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  const parent = context.parentURL || "";
  const inProject = parent.startsWith("file:") && fileURLToPath(parent).startsWith(root);
  if (inProject && (specifier === "@/lib/supabase" || (specifier.startsWith(".") && /\/supabase$/.test(specifier)))) {
    return { url: fakeUrl, shortCircuit: true };
  }
  if (inProject && (specifier.startsWith(".") || specifier.startsWith("@/"))) {
    const base = specifier.startsWith("@/") ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(fileURLToPath(parent)), specifier);
    for (const ext of ["", ".js", ".mjs", ".jsx", ".ts"]) {
      if (isFile(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
    }
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    // "next/navigation" etc.: o Next resolve sem extensão; o Node puro não.
    if (inProject && /^(next|react)\//.test(specifier)) return nextResolve(`${specifier}.js`, context);
    throw error;
  }
}
