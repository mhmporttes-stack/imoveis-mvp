// Roda antes de cada build (npm "prebuild") para garantir que public/sw.js
// sempre muda de bytes a cada deploy — é isso que faz o navegador detectar
// uma atualização do service worker e o aviso "Nova versão do painel
// disponível" (components/PwaLifecycle.jsx) aparecer de verdade. Idempotente:
// pode rodar em qualquer build local sem acumular timestamps velhos, porque o
// regex sempre substitui o sufixo inteiro (placeholder OU um build anterior).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const swPath = join(here, "..", "public", "sw.js");

const buildId = Date.now().toString(36);
const original = readFileSync(swPath, "utf8");
const stamped = original.replace(/(CACHE_VERSION = "painel-matheus-v4-)[^"]*(";)/, `$1${buildId}$2`);

if (stamped === original) {
  console.warn("stamp-service-worker: marcador CACHE_VERSION não encontrado em public/sw.js — nada foi alterado.");
} else {
  writeFileSync(swPath, stamped);
  console.log(`stamp-service-worker: public/sw.js atualizado (build ${buildId}).`);
}
