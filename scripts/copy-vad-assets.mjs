// Roda antes de cada build (prebuild): copia o detector de voz local do Henry (Silero VAD, @ricky0123/vad-web, ISC) e o
// motor onnxruntime-web (MIT) de node_modules para public/vendor/vad/, para o navegador carregar do PRÓPRIO site (nunca
// de CDN de terceiro). A pasta é gerada (está no .gitignore): os ~16 MB não entram no git. Idempotente. Sem o pacote
// instalado só avisa — o Henry continua funcionando sem o VAD (cai no medidor do microfone).
// Dono, 2026-10-23 (HENRY-1, interrupção): docs/BUSINESS_RULES.md HENRY-1.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "public", "vendor", "vad");
const require = createRequire(import.meta.url);

function packageDir(name, from) {
  try {
    const resolver = from ? createRequire(join(from, "package.json")) : require;
    if (name === "onnxruntime-web") return join(dirname(resolver.resolve("onnxruntime-web/ort-wasm-simd-threaded.wasm")), "..");
    return dirname(resolver.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
}

const vadDir = packageDir("@ricky0123/vad-web");
const ortDir = vadDir ? packageDir("onnxruntime-web", vadDir) : null;
if (!vadDir || !ortDir) {
  console.warn("copy-vad-assets: @ricky0123/vad-web/onnxruntime-web não encontrados — o Henry fica sem o detector de voz local.");
  process.exit(0);
}

const files = [
  [join(vadDir, "dist", "bundle.min.js"), "bundle.min.js"],
  [join(vadDir, "dist", "vad.worklet.bundle.min.js"), "vad.worklet.bundle.min.js"],
  [join(vadDir, "dist", "silero_vad_v5.onnx"), "silero_vad_v5.onnx"],
  [join(ortDir, "dist", "ort.wasm.min.js"), "ort.wasm.min.js"],
  [join(ortDir, "dist", "ort-wasm-simd-threaded.mjs"), "ort-wasm-simd-threaded.mjs"],
  [join(ortDir, "dist", "ort-wasm-simd-threaded.wasm"), "ort-wasm-simd-threaded.wasm"]
];
const missing = files.filter(([source]) => !existsSync(source));
if (missing.length) {
  console.warn(`copy-vad-assets: arquivos ausentes (${missing.map(([, name]) => name).join(", ")}) — o Henry fica sem o detector de voz local.`);
  process.exit(0);
}
mkdirSync(target, { recursive: true });
for (const [source, name] of files) copyFileSync(source, join(target, name));
const vadVersion = require(join(vadDir, "package.json")).version;
const ortVersion = require(join(ortDir, "package.json")).version;
writeFileSync(
  join(target, "NOTICE.txt"),
  `@ricky0123/vad-web ${vadVersion} — ISC License (https://github.com/ricky0123/vad), inclui o modelo Silero VAD (MIT).\n` +
    `onnxruntime-web ${ortVersion} — MIT License, Copyright (c) Microsoft Corporation.\n`
);
console.log(`copy-vad-assets: public/vendor/vad atualizado (vad-web ${vadVersion}, onnxruntime-web ${ortVersion}).`);
