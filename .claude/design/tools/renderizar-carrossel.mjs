// Gera as lâminas de um carrossel do Instagram (PNG 1080x1350) a partir de um roteiro JSON.
// Padrão visual de Matheus Machado (pedido do dono, 2026-10-11): fundo preto, minimalista, azul da marca nos
// destaques, rodapé com a foto dele em círculo + @ do Instagram. Não publica nada; só gera arquivos locais.
//
// Uso:
//   node .claude/design/tools/renderizar-carrossel.mjs <roteiro.json> [--saida docs/posicionamento/carrosseis/<nome>]
//
// Roteiro (JSON):
// {
//   "handle": "@mhm.machado",                  // opcional (padrão)
//   "foto": "docs/posicionamento/assets/matheus-perfil.jpg",  // opcional; sem foto usa o símbolo "M" oficial
//   "laminas": [
//     { "tipo": "capa",  "chamada": "MINHA CASA MINHA VIDA", "titulo": "3 erros que **travam** sua aprovação", "texto": "Arrasta pro lado →" },
//     { "tipo": "texto", "numero": "01", "titulo": "Nome sujo", "texto": "Parágrafo curto..." },
//     { "tipo": "lista", "titulo": "Documentos", "itens": ["RG e CPF", "Comprovante de renda"] },
//     { "tipo": "citacao", "texto": "Frase de impacto", "autor": "opcional" },
//     { "tipo": "cta",   "titulo": "Quer saber quanto você consegue?", "texto": "Faça sua simulação gratuita", "botao": "Link na bio" }
//   ]
// }
// **palavra** = destaque em azul. Requer Playwright (global no ambiente web; local: `npx playwright` com Chromium).

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const roteiroPath = args.find((a) => !a.startsWith("--"));
if (!roteiroPath) { console.error("Uso: node renderizar-carrossel.mjs <roteiro.json> [--saida pasta]"); process.exit(1); }
const saidaIdx = args.indexOf("--saida");
const saida = saidaIdx >= 0 ? args[saidaIdx + 1] : path.join("scratch", "carrossel");
const roteiro = JSON.parse(readFileSync(roteiroPath, "utf8"));
const handle = roteiro.handle || "@mhm.machado";

function loadPlaywright() {
  const require = createRequire(path.join(process.cwd(), "noop.js"));
  const bases = [process.cwd(), "/opt/node22/lib", "/opt/node-tools", ...String(process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean)];
  for (const base of bases) {
    try { return require(require.resolve("playwright", { paths: [base, path.join(base, "node_modules")] })); } catch {}
  }
  throw new Error("Playwright não encontrado (instale fora do projeto ou ajuste NODE_PATH).");
}

const asDataUrl = (file) => {
  if (!file || !existsSync(file)) return "";
  const ext = path.extname(file).slice(1).toLowerCase().replace("jpg", "jpeg");
  return `data:image/${ext};base64,${readFileSync(file).toString("base64")}`;
};
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<em>$1</em>').replace(/\n/g, "<br>");

const symbol = asDataUrl("public/assets/matheus-machado-symbol.png");
const foto = asDataUrl(roteiro.foto);
const avatar = foto ? `<img class="avatar" src="${foto}" alt="">` : `<span class="avatar avatar-symbol"><img src="${symbol}" alt=""></span>`;

function slideBody(l) {
  switch (l.tipo) {
    case "capa": return `${l.chamada ? `<p class="kicker">${esc(l.chamada)}</p>` : ""}<h1 class="cover">${rich(l.titulo)}</h1>${l.texto ? `<p class="hint">${rich(l.texto)}</p>` : ""}`;
    case "lista": return `${l.titulo ? `<h2>${rich(l.titulo)}</h2>` : ""}<ul>${(l.itens || []).map((i) => `<li>${rich(i)}</li>`).join("")}</ul>`;
    case "citacao": return `<p class="quote">“${rich(l.texto)}”</p>${l.autor ? `<p class="author">— ${esc(l.autor)}</p>` : ""}`;
    case "cta": return `<h2 class="cta">${rich(l.titulo)}</h2>${l.texto ? `<p class="body">${rich(l.texto)}</p>` : ""}${l.botao ? `<span class="button">${esc(l.botao)}</span>` : ""}`;
    default: return `${l.numero ? `<p class="number">${esc(l.numero)}</p>` : ""}${l.titulo ? `<h2>${rich(l.titulo)}</h2>` : ""}${l.texto ? `<p class="body">${rich(l.texto)}</p>` : ""}`;
  }
}

const total = roteiro.laminas.length;
const page = (l, i) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800;900&display=swap" rel="stylesheet">
<style>
  :root { --bg:#000; --fg:#fff; --muted:#9AA4B2; --brand:#3B8BFF; --line:#1F2937; }
  * { box-sizing:border-box; margin:0; }
  body { width:1080px; height:1350px; background:var(--bg); color:var(--fg); font-family:Inter, system-ui, sans-serif; }
  .frame { position:relative; width:100%; height:100%; padding:120px 96px 220px; display:flex; flex-direction:column; justify-content:center; }
  .count { position:absolute; top:64px; right:96px; font-size:26px; font-weight:500; color:var(--muted); letter-spacing:.04em; }
  .mark { position:absolute; top:56px; left:96px; height:52px; opacity:.9; }
  .kicker { font-size:28px; font-weight:700; letter-spacing:.22em; color:var(--brand); text-transform:uppercase; margin-bottom:36px; }
  h1.cover { font-size:104px; line-height:1.02; font-weight:900; letter-spacing:-.02em; }
  h2 { font-size:72px; line-height:1.08; font-weight:800; letter-spacing:-.015em; margin-bottom:36px; }
  h2.cta { font-size:84px; }
  em { font-style:normal; color:var(--brand); }
  .number { font-size:30px; font-weight:800; color:var(--brand); margin-bottom:24px; letter-spacing:.1em; }
  .body { font-size:40px; line-height:1.4; color:#D7DCE3; font-weight:400; }
  .hint { margin-top:56px; font-size:32px; color:var(--muted); }
  ul { list-style:none; padding:0; display:grid; gap:28px; }
  li { font-size:42px; line-height:1.3; padding-left:56px; position:relative; color:#E5E9EF; }
  li::before { content:""; position:absolute; left:0; top:20px; width:24px; height:4px; background:var(--brand); }
  .quote { font-size:68px; line-height:1.18; font-weight:700; }
  .author { margin-top:32px; font-size:32px; color:var(--muted); }
  .button { margin-top:56px; align-self:flex-start; border:2px solid var(--brand); color:var(--fg); border-radius:999px; padding:22px 44px; font-size:34px; font-weight:700; }
  .footer { position:absolute; left:96px; right:96px; bottom:72px; display:flex; align-items:center; gap:22px; padding-top:32px; border-top:1px solid var(--line); }
  .avatar { width:84px; height:84px; border-radius:50%; object-fit:cover; border:2px solid var(--brand); display:grid; place-items:center; background:#0D3B66; overflow:hidden; }
  .avatar-symbol img { width:60%; }
  .who { display:flex; flex-direction:column; gap:4px; }
  .name { font-size:30px; font-weight:700; }
  .handle { font-size:28px; color:var(--muted); }
</style></head><body><div class="frame">
  ${symbol ? `<img class="mark" src="${symbol}" alt="">` : ""}
  ${total > 1 ? `<span class="count">${i + 1}/${total}</span>` : ""}
  ${slideBody(l)}
  <div class="footer">${avatar}<div class="who"><span class="name">Matheus Machado</span><span class="handle">${esc(handle)}</span></div></div>
</div></body></html>`;

const { chromium } = loadPlaywright();
const executablePath = existsSync("/opt/pw-browsers/chromium") ? undefined : undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
mkdirSync(saida, { recursive: true });
for (const [i, l] of roteiro.laminas.entries()) {
  const tab = await ctx.newPage();
  await tab.setContent(page(l, i), { waitUntil: "networkidle" }).catch(() => tab.setContent(page(l, i)));
  await tab.evaluate(() => document.fonts.ready);
  const file = path.join(saida, `lamina-${String(i + 1).padStart(2, "0")}.png`);
  await tab.screenshot({ path: file });
  console.log(file);
  await tab.close();
}
await browser.close();
