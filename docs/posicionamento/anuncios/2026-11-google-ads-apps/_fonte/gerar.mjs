// Gera as artes do Google Ads (display em apps) a partir de HTML + Chrome headless + ImageMagick.
// Uso (da raiz do repo): node docs/posicionamento/anuncios/2026-11-google-ads-apps/_fonte/gerar.mjs [pastaTemporaria]
// Só usa assets oficiais: matheus-machado-symbol.png e uma foto real de imóvel publicado (COD4354, interior, sem número).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const RAIZ = resolve(process.cwd());
const TMP = resolve(process.argv[2] || "/tmp/google-ads-apps-tmp");
mkdirSync(TMP, { recursive: true });

const SIMBOLO = join(RAIZ, "public/assets/matheus-machado-symbol.png");
const FOTO = join(RAIZ, "docs/posicionamento/carrosseis/2026-10-15-palmital-casa-nova/tn/f3.jpg");

const NAVY = "#031D3A";
const AZUL = "#3B8BFF"; // azul da marca para destaque sobre fundo escuro (ESTILO-CARROSSEL.md)

// Formatos. box = área de conteúdo (margens de segurança >= 10% de cada lado); painel = polígono azul-marinho (variação foto).
const FORMATOS = {
  quadrado: { w: 1200, h: 1200, nome: "quadrado",
    box: { l: 120, r: 120, t: 120, b: 120 }, boxInst: { l: 120, r: 120, t: 120, b: 120 },
    h1: 98, cta: { h: 94, fs: 40, px: 48 }, sym: 62, sigFs: 34, sigFs2: 26, gap1: 46,
    scrim: "to top, rgba(3,29,58,.95) 0, rgba(3,29,58,.84) 13%, rgba(3,29,58,0) 30%", painel: "polygon(0 0,100% 0,100% 74%,0 60%)", fotoH: 600, objPos: "50% 34%", casa: { s: 560, r: -4, b: -5 } },
  paisagem: { w: 1200, h: 628, nome: "paisagem",
    box: { l: 120, r: 120, t: 64, b: 64 }, boxInst: { l: 120, r: 120, t: 64, b: 64 },
    h1: 64, cta: { h: 70, fs: 32, px: 38 }, sym: 46, sigFs: 25, sigFs2: 19, gap1: 26,
    painel: "polygon(0 0,60% 0,72% 100%,0 100%)", fotoH: 628, objPos: "50% 26%", casa: { s: 470, r: -3, b: -6 } },
  vertical45: { w: 1080, h: 1350, nome: "vertical-4x5",
    box: { l: 108, r: 108, t: 135, b: 135 }, boxInst: { l: 108, r: 108, t: 135, b: 135 },
    h1: 96, cta: { h: 92, fs: 40, px: 48 }, sym: 62, sigFs: 33, sigFs2: 25, gap1: 46,
    scrim: "to top, rgba(3,29,58,.95) 0, rgba(3,29,58,.84) 12%, rgba(3,29,58,0) 28%", painel: "polygon(0 0,100% 0,100% 66%,0 55%)", fotoH: 760, objPos: "50% 34%", casa: { s: 560, r: -4, b: -4 } },
  vertical916: { w: 1080, h: 1920, nome: "vertical-9x16",
    box: { l: 108, r: 108, t: 340, b: 830 }, boxInst: { l: 108, r: 108, t: 440, b: 480 },
    h1: 108, cta: { h: 104, fs: 46, px: 54 }, sym: 66, sigFs: 36, sigFs2: 27, gap1: 56,
    painel: "polygon(0 0,100% 0,100% 66%,0 60%)", fotoH: 900, objPos: "50% 34%", casa: { s: 640, r: -12, b: 4 } }
};

const CTAS = { principal: "Simular Agora", alternativo: "Quero Simular" };

const CASA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
const SETA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>`;

function html(f, variacao, cta) {
  const foto = variacao === "foto";
  const box = foto ? f.box : f.boxInst;
  const c = f.cta;
  const fundo = foto
    ? `<img class="foto" src="file://${FOTO}" style="height:${f.fotoH}px;object-position:${f.objPos}">
              ${f.scrim ? `<div class="scrim" style="background:linear-gradient(${f.scrim})"></div>` : ""}
<div class="painel" style="clip-path:${f.painel}"></div>`
    : `<div class="glow"></div><div class="casa" style="--s:${f.casa.s}px;right:${f.casa.r}%;bottom:${f.casa.b}%">${CASA}</div>`;
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${f.w}px;height:${f.h}px;overflow:hidden;background:${NAVY}}
body{position:relative;font-family:Inter,sans-serif;color:#fff;-webkit-font-smoothing:antialiased}
.foto{position:absolute;left:0;bottom:0;width:100%;object-fit:cover}
.scrim{position:absolute;inset:0}
.painel{position:absolute;inset:0;background:linear-gradient(160deg,#0A2B57 0%,${NAVY} 70%)}
.glow{position:absolute;inset:0;background:radial-gradient(${f.w * 0.95}px ${f.h * 0.85}px at 30% 28%,#12418F 0%,#0A2A5E 42%,${NAVY} 100%)}
.casa{position:absolute;width:var(--s);height:var(--s);color:${AZUL};opacity:.14}
.casa svg{width:100%;height:100%}
.conteudo{position:absolute;left:${box.l}px;right:${box.r}px;top:${box.t}px;bottom:${box.b}px;display:flex;flex-direction:column;align-items:flex-start}
h1{font-weight:800;font-size:${f.h1}px;line-height:1.06;letter-spacing:-.025em;color:#fff}
h1 em{font-style:normal;color:${AZUL}}
.cta{margin-top:${f.gap1}px;display:inline-flex;align-items:center;gap:${Math.round(c.fs * 0.5)}px;height:${c.h}px;padding:0 ${c.px}px 0 ${c.px}px;border-radius:999px;background:#fff;color:${NAVY};font-weight:800;font-size:${c.fs}px;letter-spacing:-.01em;white-space:nowrap}
.cta svg{width:${Math.round(c.fs * 0.95)}px;height:${Math.round(c.fs * 0.95)}px;color:#3673C2}
.assin{margin-top:auto;display:flex;align-items:center;gap:${Math.round(f.sym * 0.38)}px}
.assin img{height:${f.sym}px;width:auto;display:block}
.assin .tr{width:3px;align-self:stretch;background:#3673C2}
.assin b{display:block;font-weight:800;font-size:${f.sigFs}px;line-height:1.1;color:#EFEFEF;letter-spacing:-.005em}
.assin span{display:block;font-weight:500;font-size:${f.sigFs2}px;line-height:1.2;color:#D5DEEB;margin-top:4px}
</style><body>
${fundo}
<div class="conteudo">
<h1>Descubra seu<br><em>poder de compra</em><br>em menos de<br>2 minutos</h1>
<div class="cta">${cta}${SETA}</div>
<div class="assin"><img src="file://${SIMBOLO}" alt=""><div class="tr"></div><div><b>Matheus Machado</b><span>Corretor de Imóveis</span></div></div>
</div></body></html>`;
}

const saidas = [];
for (const f of Object.values(FORMATOS)) {
  for (const variacao of ["foto", "institucional"]) {
    for (const [ctaId, ctaTxt] of Object.entries(CTAS)) {
      const base = `google-ads-apps-${f.nome}-${variacao}${ctaId === "alternativo" ? "-quero-simular" : ""}`;
      const htmlPath = join(TMP, `${base}.html`);
      const pngTmp = join(TMP, `${base}.png`);
      writeFileSync(htmlPath, html(f, variacao, ctaTxt));
      execFileSync("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
        `--window-size=${f.w},${f.h}`, "--virtual-time-budget=4000", `--screenshot=${pngTmp}`, `file://${htmlPath}`], { stdio: "ignore" });
      saidas.push({ base, pngTmp, foto: variacao === "foto" });
    }
  }
}
// Exporta em JPG (PNG de foto/degradê passa de 150 KB): reduz a qualidade até ficar <= 145 KB.
const SAIDA = join(RAIZ, "docs/posicionamento/anuncios/2026-11-google-ads-apps");
const LIMITE = 145 * 1024;
for (const s of saidas) {
  const destino = join(SAIDA, `${s.base}.jpg`);
  for (let q = 92; q >= 60; q -= 2) {
    execFileSync("convert", [s.pngTmp, "-strip", "-sampling-factor", q >= 80 ? "4:4:4" : "4:2:0", "-quality", String(q), destino]);
    if (statSync(destino).size <= LIMITE) break;
  }
  console.log(s.base, Math.round(statSync(destino).size / 1024) + " KB");
}
