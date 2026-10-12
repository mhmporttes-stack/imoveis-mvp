// Renderiza lâminas de carrossel escritas à mão em HTML (layout livre, para recriar referências que o
// renderizar-carrossel.mjs não cobre). Cada <section class="lamina"> vira um PNG 1080x1350.
// Fontes do Google: <meta name="fontes" content="family=Anton&family=Plus+Jakarta+Sans:wght@400;700;800"> (embutidas).
// Imagens: caminhos relativos ao arquivo HTML.
//
// Uso: node .claude/design/tools/renderizar-laminas-html.mjs <laminas.html> [--saida pasta]

import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const htmlPath = path.resolve(args.find((a) => !a.startsWith("--")));
const saidaIdx = args.indexOf("--saida");
const saida = saidaIdx >= 0 ? args[saidaIdx + 1] : path.dirname(htmlPath);
let html = readFileSync(htmlPath, "utf8");

async function fontCss(query) {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?${query}&display=swap`, { headers: { "user-agent": "Mozilla/5.0 Chrome/120" } })).text();
    const out = [];
    for (const block of css.split("@font-face").slice(1)) {
      const url = /url\((https:[^)]+)\)/.exec(block)?.[1];
      if (!url) continue;
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      out.push("@font-face" + block.replace(url, `data:font/woff2;base64,${buf.toString("base64")}`).replace(/\/\*[^*]*\*\/\s*$/, ""));
    }
    return out.join("\n");
  } catch { return ""; }
}

const fontes = /<meta name="fontes" content="([^"]+)"/.exec(html)?.[1];
if (fontes) html = html.replace("</head>", `<style>${await fontCss(fontes)}</style></head>`);

function loadPlaywright() {
  const require = createRequire(path.join(process.cwd(), "noop.js"));
  for (const base of [process.cwd(), "/opt/node22/lib", ...String(process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean)]) {
    try { return require(require.resolve("playwright", { paths: [base, path.join(base, "node_modules")] })); } catch {}
  }
  throw new Error("Playwright não encontrado (ajuste NODE_PATH).");
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
// Imagens relativas embutidas como data URL (setContent não lê file://).
html = html.replace(/src="([^"]+)"/g, (m, src) => {
  if (/^(data:|https?:)/.test(src)) return m;
  const file = path.resolve(path.dirname(htmlPath), src);
  const ext = path.extname(file).slice(1).toLowerCase().replace("jpg", "jpeg");
  return `src="data:image/${ext};base64,${readFileSync(file).toString("base64")}"`;
});
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
mkdirSync(saida, { recursive: true });
const n = await page.locator("section.lamina").count();
for (let i = 0; i < n; i++) {
  const file = path.join(saida, `lamina-${String(i + 1).padStart(2, "0")}.png`);
  await page.locator("section.lamina").nth(i).screenshot({ path: file });
  console.log(file);
}
await browser.close();
