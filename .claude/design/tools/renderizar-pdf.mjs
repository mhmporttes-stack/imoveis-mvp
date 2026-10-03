// Renderiza TODAS as páginas de um PDF em PNG para revisão visual (Visual QA de PDF).
// Não altera o PDF, não envia nada para fora, não adiciona dependência ao projeto.
//
// Uso:
//   node .claude/design/tools/renderizar-pdf.mjs <arquivo.pdf> [--saida scratch/pdf] [--escala 1.5] [--recorte x,y,largura,altura]
//   --sonda x,y;x,y: imprime a cor RGB (0-255) dos pontos (em pt, origem no topo esquerdo) — mede emendas e contraste.
//   --recorte: renderiza só uma região (em pt, origem no topo esquerdo) para inspecionar detalhes em zoom.
//
// Saída: <saida>/<nome>-p01.png, -p02.png … e uma linha por página com o tamanho.
// Abra os PNG com a ferramenta Read para ver a composição real (não leia só o código do gerador).
//
// Requer: `pdfjs-dist` (já é dependência do projeto) e `@napi-rs/canvas`
// (NÃO está no package.json; instale fora do projeto — ex.: `npm i -g @napi-rs/canvas` —
// ou aponte NODE_PATH para uma pasta node_modules que o contenha).
// Dado de cliente: use PDF gerado com dados fictícios; apague scratch/ ao terminar.

import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(path.join(process.cwd(), "noop.js"));

function resolveFrom(name, extra = []) {
  const bases = [process.cwd(), ...String(process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean), ...extra];
  for (const base of bases) {
    try {
      return require.resolve(name, { paths: [base, path.join(base, "node_modules")] });
    } catch {}
  }
  return null;
}

function globalRoot() {
  try {
    return execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

const input = process.argv[2];
if (!input || input.startsWith("--")) {
  console.error("Uso: node .claude/design/tools/renderizar-pdf.mjs <arquivo.pdf> [--saida scratch/pdf] [--escala 1.5]");
  process.exit(1);
}
const outDir = arg("saida", "scratch/pdf");
const scale = Number(arg("escala", "1.5")) || 1.5;
const crop = arg("recorte", "").split(",").map(Number);
const probes = arg("sonda", "").split(";").map((s) => s.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
const hasCrop = crop.length === 4 && crop.every(Number.isFinite);

const extra = globalRoot() ? [globalRoot()] : [];
const pdfjsPath = resolveFrom("pdfjs-dist/legacy/build/pdf.mjs", extra);
const canvasPath = resolveFrom("@napi-rs/canvas", extra);
if (!pdfjsPath) {
  console.error("pdfjs-dist não encontrado (rode `pnpm install` no projeto).");
  process.exit(1);
}
if (!canvasPath) {
  console.error("@napi-rs/canvas não encontrado. Instale-o FORA do projeto (npm i -g @napi-rs/canvas) ou aponte NODE_PATH; não adicione ao package.json sem aprovação do dono.");
  process.exit(1);
}

const canvasLib = require(canvasPath);
const { createCanvas } = canvasLib;
// O pdfjs precisa que Path2D/DOMMatrix/ImageData venham da MESMA cópia do canvas usada para desenhar.
for (const key of ["Path2D", "DOMMatrix", "ImageData"]) if (canvasLib[key]) globalThis[key] = canvasLib[key];
const pdfjs = await import(pathToFileURL(pdfjsPath).href);

const data = new Uint8Array(readFileSync(input));
// Fábrica de canvas própria: sem ela o pdfjs carrega OUTRA cópia do módulo nativo e desenhar imagens
// (ex.: a logo PNG com transparência) derruba o processo (segfault). Mesma cópia para tudo = estável.
class CanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(pair, width, height) {
    pair.canvas.width = width;
    pair.canvas.height = height;
  }
  destroy(pair) {
    pair.canvas.width = 0;
    pair.canvas.height = 0;
    pair.canvas = null;
    pair.context = null;
  }
}
// Fontes padrão do PDF (Helvetica etc.) renderizadas com as métricas Liberation Sans/Foxit do próprio pdfjs,
// para o Visual QA enxergar sans-serif como o leitor de PDF do cliente (sem isso cai numa serifa do sistema).
const fontsDir = path.join(path.dirname(path.dirname(path.dirname(pdfjsPath))), "standard_fonts") + path.sep;
// O canvas nativo não acha "sans-serif" por conta própria e cai numa serifa: registre a Liberation Sans (métrica da Helvetica).
if (canvasLib.GlobalFonts) {
  for (const file of ["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf", "LiberationSans-Italic.ttf", "LiberationSans-BoldItalic.ttf"]) {
    try { canvasLib.GlobalFonts.registerFromPath(path.join(fontsDir, file), "sans-serif"); } catch {}
  }
  // Times-Roman do PDF: usa a Times New Roman do sistema (mesmas métricas) quando existir; sem ela cai numa fonte genérica.
  for (const dir of ["C:/Windows/Fonts", "/usr/share/fonts/truetype/msttcorefonts", "/Library/Fonts"]) {
    for (const file of ["times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf", "Times New Roman.ttf", "Times New Roman Bold.ttf", "Times New Roman Italic.ttf"]) {
      const full = path.join(dir, file);
      if (existsSync(full)) { try { canvasLib.GlobalFonts.registerFromPath(full, "serif"); } catch {} }
    }
  }
}
const doc = await pdfjs.getDocument({ data, useSystemFonts: false, standardFontDataUrl: pathToFileURL(fontsDir).href, isEvalSupported: false, verbosity: 0, CanvasFactory }).promise;
mkdirSync(outDir, { recursive: true });
const base = path.basename(input).replace(/\.pdf$/i, "");

for (let n = 1; n <= doc.numPages; n += 1) {
  const page = await doc.getPage(n);
  const viewport = hasCrop ? page.getViewport({ scale, offsetX: -crop[0] * scale, offsetY: -crop[1] * scale }) : page.getViewport({ scale });
  const canvas = hasCrop ? createCanvas(Math.ceil(crop[2] * scale), Math.ceil(crop[3] * scale)) : createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  for (const [px, py] of probes) {
    const d = context.getImageData(Math.round((px - (hasCrop ? crop[0] : 0)) * scale), Math.round((py - (hasCrop ? crop[1] : 0)) * scale), 1, 1).data;
    console.log(`sonda (${px},${py}) pág ${n}: rgb(${d[0]}, ${d[1]}, ${d[2]})`);
  }
  const file = path.join(outDir, `${base}-p${String(n).padStart(2, "0")}${hasCrop ? "-recorte" : ""}.png`);
  writeFileSync(file, canvas.toBuffer("image/png"));
  const pt = page.getViewport({ scale: 1 });
  console.log(`${file}  ${Math.round(pt.width)}x${Math.round(pt.height)} pt  (${canvas.width}x${canvas.height}px)`);
  page.cleanup();
}
console.log(`${doc.numPages} página(s) renderizada(s). Apague ${outDir}/ ao terminar.`);
