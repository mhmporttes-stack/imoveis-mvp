// Gera as lâminas de um carrossel do Instagram (PNG 1080x1350) a partir de um roteiro JSON.
// Padrão visual de Matheus Machado (pedido do dono, 2026-10-11): fundo preto, minimalista, azul da marca nos
// destaques, rodapé com a foto dele em círculo + @ do Instagram. Não publica nada; só gera arquivos locais.
//
// Uso:
//   node .claude/design/tools/renderizar-carrossel.mjs <roteiro.json> [--saida docs/posicionamento/carrosseis/<nome>]
//
// Roteiro (JSON):
// {
//   "handle": "mhm.machado",                   // opcional (padrão); "subtitulo" também
//   "foto": "docs/posicionamento/assets/matheus-perfil.png",  // opcional (é o padrão); fotoZoom/fotoPosicao ajustam o recorte do rosto
//   "laminas": [
//     { "tipo": "capa",  "chamada": "MINHA CASA MINHA VIDA", "titulo": "3 erros que **travam** sua aprovação", "texto": "Arrasta pro lado →" },
//     { "tipo": "texto", "numero": "01", "titulo": "Nome sujo", "texto": "Parágrafo curto..." },
//     { "tipo": "lista", "titulo": "Documentos", "itens": ["RG e CPF", "Comprovante de renda"] },
//     { "tipo": "citacao", "texto": "Frase de impacto", "autor": "opcional" },
//     { "tipo": "texto", "imagem": "pasta/foto.jpg", "imagemPosicao": "center 30%", "titulo": "..." },  // lâmina com foto de fundo
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
// Rodapé igual ao topo do perfil do Instagram (pedido do dono, 2026-10-11): foto no anel colorido, usuário + selo
// de verificado e a linha "Matheus Machado / Corretor de Imóveis".
const handle = String(roteiro.handle || "mhm.machado").replace(/^@/, "");
const subtitulo = roteiro.subtitulo ?? "Corretor de Imóveis";
// Recorte do rosto dentro da foto (a foto oficial é o corpo inteiro): zoom e posição do fundo, em CSS.
const fotoZoom = roteiro.fotoZoom || "340%";
const fotoPosicao = roteiro.fotoPosicao || "38% 13%";

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
// **palavra** = destaque na cor da marca; *palavra* = serifa itálica (Playfair) — contraste elegante sem gritar.
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<em>$1</em>').replace(/\*(.+?)\*/g, '<i class="serif">$1</i>').replace(/\n/g, "<br>");

const symbol = asDataUrl("public/assets/matheus-machado-symbol.png");
// Foto do Matheus SEM fundo (recorte, 2026-10-11) para lâminas em que ele aparece: "comFoto": true na lâmina.
const recorte = asDataUrl(roteiro.recorte || "docs/posicionamento/assets/matheus-recorte.png");
// Variante apontando para o texto (à esquerda): "comFoto": "apontando".
const recorteApontando = asDataUrl("docs/posicionamento/assets/matheus-apontando.png");
// Boneco 3D do Matheus (personagem estilo animação, criado a partir das fotos dele em 2026-10-11, fundo transparente):
// "boneco": "<pose>" na lâmina, com <pose> = nome do arquivo em docs/posicionamento/assets/boneco-3d/ (ex.: "pensando");
// corpo inteiro: "corpo-inteiro/<pose>" (ex.: "corpo-inteiro/andando").
const bonecoDe = (l) => l.boneco ? asDataUrl(`docs/posicionamento/assets/boneco-3d/${l.boneco}.png`) : "";
for (const l of roteiro.laminas) if (l.boneco && !l.comFoto) l.comFoto = true;
const recorteDa = (l) => bonecoDe(l) || (l.comFoto === "apontando" && recorteApontando) || recorte;
const foto = asDataUrl(roteiro.foto || "docs/posicionamento/assets/matheus-perfil.png");
const avatar = `<span class="ring"><span class="avatar" style="${foto ? `background-image:url('${foto}');background-size:${fotoZoom};background-position:${fotoPosicao}` : ""}">${foto ? "" : `<img src="${symbol}" alt="">`}</span></span>`;
const verified = `<svg class="badge" viewBox="0 0 40 40" aria-hidden="true"><path fill="#3897F0" d="M19.998 3.094 14.638 0l-2.972 5.15H5.432v6.354L0 14.64 3.094 20 0 25.359l5.432 3.137v5.905h5.975L14.638 40l5.36-3.094L25.358 40l3.232-5.6h6.162v-6.01L40 25.359 36.905 20 40 14.641l-5.248-3.03v-6.46h-6.419L25.358 0l-5.36 3.094Zm7.415 11.225 2.254 2.287-11.43 11.5-6.835-6.93 2.244-2.258 4.587 4.581 9.18-9.18Z"/></svg>`;

// Ícones de linha (Lucide, licença ISC) por nome — ex.: "house", "car", "calendar-clock", "file-check", "landmark".
// Baixados pelo Node e embutidos; sem rede, a lâmina sai sem ícone (nunca quebra).
const LUCIDE = "https://cdn.jsdelivr.net/npm/lucide-static@0.469.0/icons/";
const iconCache = new Map();
async function loadIcon(name) {
  if (!name || iconCache.has(name)) return;
  try {
    const res = await fetch(`${LUCIDE}${encodeURIComponent(name)}.svg`);
    iconCache.set(name, res.ok ? (await res.text()).replace(/<!--.*?-->/gs, "").replace(/class="[^"]*"/, 'class="ico"') : "");
  } catch { iconCache.set(name, ""); }
}
const icon = (name) => iconCache.get(name) || "";

// Fonte Inter embutida (latin) — mesma fonte em qualquer máquina.
async function fontCss() {
  try {
    const css = await (await fetch("https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;700;800;900&family=Anton&family=Playfair+Display:ital,wght@1,500;1,700&display=swap", { headers: { "user-agent": "Mozilla/5.0 Chrome/120" } })).text();
    // Sem subconjuntos (um arquivo por peso) — evita baixar dezenas de faixas de caracteres.
    const blocks = css.split("@font-face").slice(1);
    const out = [];
    for (const block of blocks) {
      const url = /url\((https:[^)]+)\)/.exec(block)?.[1];
      if (!url) continue;
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      const mime = url.endsWith(".woff2") ? "font/woff2" : "font/ttf";
      out.push("@font-face" + block.replace(url, `data:${mime};base64,${buf.toString("base64")}`).replace(/\/\*[^*]*\*\/\s*$/, ""));
    }
    return out.join("\n");
  } catch { return ""; }
}

// Item de lista: "texto" ou { "texto": "...", "icone": "house" }.
const itemHtml = (i) => {
  const item = typeof i === "string" ? { texto: i } : i;
  return item.icone ? `<li class="com-icone"><span class="li-ico">${icon(item.icone)}</span><span>${rich(item.texto)}</span></li>` : `<li>${rich(item.texto)}</li>`;
};
const tituloHtml = (l, tag = "h2", cls = "") => l.titulo ? `<${tag} class="${cls}${l.tituloLeve ? " leve" : ""}">${rich(l.titulo)}</${tag}>${l.sublinhado ? '<span class="bar"></span>' : ""}` : "";
const notaHtml = (l) => l.nota ? `<p class="nota">${rich(l.nota)}</p>` : "";
// Blocos tipográficos do modelo "mitos" (2026-10-11): frase em letra condensada (Anton, caixa alta), selo em serifa itálica
// (Playfair) — ex.: "Mito", "Será mesmo?" —, fecho condensado na cor da marca e linha de fonte pequena.
const fraseHtml = (l) => l.frase ? `<p class="frase">${rich(l.frase)}</p>` : "";
const seloHtml = (l) => l.selo ? `<p class="selo${l.seloBranco ? " branco" : ""}">${rich(l.selo)}</p>` : "";
const fechoHtml = (l) => l.fecho ? `<p class="fecho">${rich(l.fecho)}</p>` : "";
const fonteHtml = (l) => l.fonte ? `<p class="fonte">${esc(l.fonte)}</p>` : "";
const iconeTopo = (l) => l.icone ? `<span class="top-ico">${icon(l.icone)}</span>` : "";

// Layout "editorial" (2026-10-11, pedido do dono: mais leve, elegante e moderno): alinhado à esquerda, um destaque
// por lâmina. "mito": rótulo pequeno, objeção em serifa itálica, divisor fino, a verdade como NÚMERO grande + legenda.
function editorialBody(l) {
  return [
    l.rotulo ? `<p class="rotulo">${esc(l.rotulo)}</p>` : "",
    l.objecao ? `<p class="objecao">${rich(l.objecao)}</p>` : "",
    l.objecao && (l.numeroGrande || l.titulo || l.texto) ? '<span class="divisor"></span>' : "",
    l.verdade ? `<p class="verdade">${esc(l.verdade)}</p>` : "",
    l.titulo ? `<h2 class="ed-titulo">${rich(l.titulo)}</h2>` : "",
    l.numeroGrande ? `<p class="numero-grande">${rich(l.numeroGrande)}</p>` : "",
    l.numeroLegenda ? `<p class="numero-legenda">${rich(l.numeroLegenda)}</p>` : "",
    l.texto ? `<p class="ed-texto">${rich(l.texto)}</p>` : "",
    l.botao ? `<span class="pill">${rich(l.botao)}</span>` : "",
    l.fonte ? `<p class="fonte">${esc(l.fonte)}</p>` : ""
  ].join("");
}

function slideBody(l) {
  if (l.tipo === "mito" || l.tipo === "editorial") return editorialBody(l);
  switch (l.tipo) {
    case "capa": return `${iconeTopo(l)}${l.chamada ? `<p class="kicker">${esc(l.chamada)}</p>` : ""}${l.tituloCondensado ? `<h1 class="cover condensada">${rich(l.titulo)}</h1>` : tituloHtml(l, "h1", "cover")}${l.texto ? `<p class="hint">${rich(l.texto)}</p>` : ""}${notaHtml(l)}`;
    case "lista": return `${iconeTopo(l)}${l.numero ? `<p class="number">${esc(l.numero)}</p>` : ""}${tituloHtml(l)}${l.subtitulo ? `<p class="subtitle">${rich(l.subtitulo)}</p>` : ""}<ul>${(l.itens || []).map(itemHtml).join("")}</ul>${notaHtml(l)}`;
    // Aspas grandes na cor da marca (modelo do dono): "texto" é a frase; "titulo" opcional abaixo dela.
    case "citacao": return `<span class="aspas">“</span><p class="quote${l.tituloLeve ? " leve" : ""}">${rich(l.texto)}</p>${l.subtitulo ? `<p class="subtitle">${rich(l.subtitulo)}</p>` : ""}${l.autor ? `<p class="author">— ${esc(l.autor)}</p>` : ""}${notaHtml(l)}`;
    case "cta": return `${iconeTopo(l)}${fraseHtml(l)}${l.titulo ? tituloHtml(l, "h2", "cta") : ""}${l.subtitulo ? `<p class="sub-linha">${rich(l.subtitulo)}</p>` : ""}${seloHtml(l)}${fechoHtml(l)}${l.texto ? `<p class="body">${rich(l.texto)}</p>` : ""}${l.botao ? `<span class="button">${esc(l.botao)}</span>` : ""}${notaHtml(l)}`;
    default: return `${iconeTopo(l)}${l.numero ? `<p class="number">${esc(l.numero)}</p>` : ""}${fraseHtml(l)}${seloHtml(l)}${tituloHtml(l)}${l.texto ? `<p class="body">${rich(l.texto)}</p>` : ""}${l.texto2 ? `<p class="body">${rich(l.texto2)}</p>` : ""}${fechoHtml(l)}${notaHtml(l)}${fonteHtml(l)}`;
  }
}

// Fundo (pedido do dono, 2026-10-11): referência de cor única → preto (padrão). Referência com FOTO de fundo → a lâmina
// também leva foto ("imagem": caminho do arquivo), com escurecimento por baixo para o texto continuar legível.
// "fundo" (cor) pode ser definido no roteiro inteiro ou por lâmina.
const fundoPadrao = roteiro.fundo || "#000";
function fundoDa(l) {
  const cor = l.fundo || fundoPadrao;
  const img = asDataUrl(l.imagem);
  if (!img) return `background:${cor};`;
  const pos = l.imagemPosicao || "center";
  // "textoTopo": ilustração com o espaço livre em cima (estilo das ilustrações 3D) — escurece o topo, não a base.
  const grad = l.textoTopo
    ? "linear-gradient(180deg, rgba(0,0,0,.92) 0%, rgba(0,0,0,.70) 30%, rgba(0,0,0,.10) 55%, rgba(0,0,0,0) 70%, rgba(0,0,0,.55) 100%)"
    : "linear-gradient(180deg, rgba(0,0,0,.05) 0%, rgba(0,0,0,.25) 35%, rgba(0,0,0,.82) 62%, rgba(0,0,0,.95) 100%)";
  return `background:${grad}, url('${img}') ${pos}/cover no-repeat, ${cor};`;
}
const page = (l, i) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<style>${FONT_CSS}
  :root { --bg:#000; --fg:#fff; --muted:#9AA4B2; --brand:#3B8BFF; --line:#1F2937; }
  * { box-sizing:border-box; margin:0; }
  body { width:1080px; height:1350px; background:var(--bg); color:var(--fg); font-family:Inter, system-ui, sans-serif; }
  .frame { position:relative; width:100%; height:100%; padding:110px 88px 170px; display:flex; flex-direction:column; justify-content:center; }
  .count { position:absolute; top:64px; right:88px; font-size:30px; font-weight:500; color:var(--muted); letter-spacing:.04em; }
  .mark { position:absolute; top:56px; left:96px; height:52px; opacity:.9; }
  .kicker { font-size:36px; font-weight:700; letter-spacing:.22em; color:var(--brand); text-transform:uppercase; margin-bottom:40px; }
  h1.cover { font-size:140px; line-height:1.02; font-weight:900; letter-spacing:-.02em; }
  h2 { font-size:96px; line-height:1.06; font-weight:800; letter-spacing:-.015em; margin-bottom:36px; }
  h2.cta { font-size:110px; }
  em { font-style:normal; color:var(--brand); }
  .number { font-size:40px; font-weight:800; color:var(--brand); margin-bottom:24px; letter-spacing:.1em; }
  .body { font-size:52px; line-height:1.35; color:#D7DCE3; font-weight:400; }
  .hint { margin-top:64px; font-size:40px; color:var(--muted); }
  ul { list-style:none; padding:0; display:grid; gap:36px; }
  li { font-size:56px; line-height:1.25; padding-left:72px; position:relative; color:#E5E9EF; }
  li::before { content:""; position:absolute; left:0; top:30px; width:36px; height:6px; background:var(--brand); }
  .quote { font-size:88px; line-height:1.18; font-weight:700; }
  .author { margin-top:40px; font-size:40px; color:var(--muted); }
  .button { margin-top:64px; align-self:flex-start; border:2px solid var(--brand); color:var(--fg); border-radius:999px; padding:26px 52px; font-size:42px; font-weight:700; }
  h2.leve, h1.leve, .quote.leve { font-weight:300; text-transform:uppercase; letter-spacing:.02em; }
  .bar { display:block; width:200px; height:8px; background:var(--brand); border-radius:4px; margin:-8px 0 44px; }
  .subtitle { font-size:40px; font-weight:700; color:var(--brand); margin:-8px 0 44px; text-transform:uppercase; letter-spacing:.04em; }
  .top-ico .ico, .top-ico svg { width:120px; height:120px; color:var(--brand); stroke-width:1.6; margin-bottom:36px; }
  li.com-icone { display:flex; align-items:center; gap:36px; padding-left:0; }
  li.com-icone::before { display:none; }
  .li-ico svg { width:84px; height:84px; color:var(--brand); stroke-width:1.6; flex-shrink:0; display:block; }
  .aspas { font-size:340px; line-height:.75; font-weight:900; color:var(--brand); height:190px; display:block; margin-bottom:40px; font-family:Georgia, serif; }
  .nota { margin-top:56px; font-size:40px; line-height:1.35; color:#E5E9EF; border-left:8px solid var(--brand); padding-left:32px; }
  .nota em { color:var(--brand); }
  .frame.foto { justify-content:flex-end; padding-bottom:250px; }
  .frame.foto h1.cover { font-size:112px; }
  .frame.foto.topo { justify-content:flex-start; padding-top:120px; padding-bottom:170px; }
  .frame.foto.topo .ed-titulo { font-size:84px; }
  .frame.foto.topo .ed-texto { color:#D7DEE8; }
  .frame.foto h2 { font-size:84px; }
  .frame.foto .body, .frame.foto li { color:#F1F4F8; }
  .recorte { position:absolute; right:-40px; bottom:0; height:78%; z-index:0; filter:drop-shadow(0 0 60px rgba(59,139,255,.25)); }
  .frame.com-recorte > *:not(.recorte):not(.footer) { position:relative; z-index:1; max-width:62%; }
  .recorte.apontando { right:-20px; height:72%; }
  .recorte.boneco { right:-200px; height:74%; filter:drop-shadow(0 0 50px rgba(59,139,255,.22)); }
  .recorte.boneco.inteiro { right:-150px; height:94%; bottom:20px; }
  .frame.com-recorte h1.cover { font-size:104px; }
  .frame.com-recorte h2 { font-size:80px; }
  .frame.com-recorte .quote { font-size:64px; }
  .frame.com-recorte .aspas { font-size:240px; height:130px; }
  .frame.com-recorte.citacao .recorte { height:58%; right:-30px; }
  .frame.com-recorte .footer { justify-content:flex-start; }
  .frame.com-recorte .footer .who { text-shadow:0 2px 12px rgba(0,0,0,.9); }
  .frase { font-family:Anton, Inter, sans-serif; text-transform:uppercase; font-size:78px; line-height:1.08; letter-spacing:.005em; color:#fff; }
  .frase em { color:var(--brand); }
  .selo { font-family:"Playfair Display", Georgia, serif; font-style:italic; font-weight:500; font-size:190px; line-height:1; color:var(--brand); margin:20px 0 28px; letter-spacing:-.02em; }
  .selo.branco { color:#fff; font-size:150px; }
  .fecho { font-family:Anton, Inter, sans-serif; text-transform:uppercase; font-size:96px; line-height:1.04; color:var(--brand); margin-top:44px; }
  .fecho em { color:#fff; }
  .fonte { margin-top:36px; font-size:22px; color:var(--muted); }
  .sub-linha { font-size:44px; color:var(--brand); border-bottom:3px solid var(--brand); padding-bottom:6px; align-self:flex-start; margin:8px 0 20px; }
  h1.condensada { font-family:Anton, Inter, sans-serif; font-weight:400; text-transform:uppercase; font-size:132px; line-height:1.0; letter-spacing:.005em; }
  .frame.centro { text-align:center; align-items:center; }
  .frame.centro .body { font-size:44px; line-height:1.32; }
  .body + .body { margin-top:22px; }
  .frame.com-recorte .fecho { font-size:110px; }
  .frame.centro .sub-linha { align-self:center; }
  .frame.centro .nota { text-align:left; }
  .recorte-central { position:absolute; left:50%; transform:translateX(-50%); bottom:0; height:92%; z-index:0; }
  .degrade { position:absolute; inset:0; background:linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,.75) 62%, rgba(0,0,0,.96) 82%); z-index:0; }
  .frame.foto-central > *:not(.recorte-central):not(.degrade):not(.footer) { position:relative; z-index:1; }
  i.serif { font-family:"Playfair Display", Georgia, serif; font-style:italic; font-weight:500; letter-spacing:-.01em; }
  em i.serif, i.serif em { color:var(--brand); }
  h1.cover i.serif, .ed-titulo i.serif { color:var(--brand); font-weight:500; }
  .frame.editorial { justify-content:center; }
  .rotulo { font-size:26px; font-weight:700; letter-spacing:.26em; text-transform:uppercase; color:var(--brand); margin-bottom:40px; }
  .objecao { font-family:"Playfair Display", Georgia, serif; font-style:italic; font-weight:500; font-size:68px; line-height:1.15; color:#fff; letter-spacing:-.01em; }
  .divisor { display:block; width:72px; height:3px; background:var(--brand); margin:56px 0 48px; }
  .verdade { font-size:24px; font-weight:600; letter-spacing:.22em; text-transform:uppercase; color:var(--muted); margin-bottom:12px; }
  .ed-titulo { font-size:92px; line-height:1.04; font-weight:800; letter-spacing:-.03em; margin:0 0 28px; }
  .numero-grande { font-size:176px; line-height:.95; font-weight:800; letter-spacing:-.045em; color:var(--brand); }
  .numero-legenda { font-size:36px; color:#E6EAF0; margin-top:18px; font-weight:500; }
  .ed-texto { font-size:38px; line-height:1.42; color:#AEB8C5; margin-top:40px; max-width:860px; }
  .ed-texto em { color:#fff; font-weight:600; }
  .pill { display:inline-block; align-self:flex-start; margin-top:48px; background:var(--brand); color:#fff; border-radius:999px; padding:22px 48px; font-size:36px; font-weight:700; }
  .frame.editorial .fonte { margin-top:48px; }
  .frame.com-recorte.editorial > *:not(.recorte):not(.footer) { max-width:58%; }
  .footer { z-index:2; position:absolute; left:88px; right:88px; bottom:56px; display:flex; align-items:center; justify-content:center; gap:16px; }
  .ring { width:76px; height:76px; border-radius:50%; padding:3px; background:conic-gradient(from 200deg, #FEDA75, #FA7E1E, #D62976, #962FBF, #4F5BD5, #FEDA75); flex-shrink:0; }
  .avatar { width:100%; height:100%; border-radius:50%; border:3px solid var(--bg); background-color:#0D3B66; background-repeat:no-repeat; display:grid; place-items:center; overflow:hidden; }
  .avatar img { width:60%; }
  .who { display:flex; flex-direction:column; gap:2px; }
  .user { display:flex; align-items:center; gap:8px; font-size:30px; font-weight:700; }
  .badge { width:26px; height:26px; }
  .sub { font-size:22px; color:var(--muted); }
</style></head><body style="${fundoDa(l)}"><div class="frame ${esc(l.tipo === "mito" ? "editorial" : (l.tipo || "texto"))}${l.imagem || (l.fotoCentral && recorte) ? " foto" : ""}${l.textoTopo ? " topo" : ""}${l.comFoto && recorte ? " com-recorte" : ""}${l.fotoCentral && recorte ? " foto-central" : ""}${l.centro ? " centro" : ""}">
  ${l.comFoto && recorte ? `<img class="recorte${l.boneco ? ` boneco${String(l.boneco).startsWith("corpo-inteiro/") ? " inteiro" : ""}` : l.comFoto === "apontando" ? " apontando" : ""}" src="${recorteDa(l)}" alt="">` : ""}
  ${l.fotoCentral && recorte ? `<img class="recorte-central" src="${recorte}" alt=""><span class="degrade"></span>` : ""}
  ${slideBody(l)}
  <div class="footer">${avatar}<div class="who"><span class="user">${esc(handle)}${verified}</span>${subtitulo ? `<span class="sub">${esc(subtitulo)}</span>` : ""}</div></div>
</div></body></html>`;

const FONT_CSS = await fontCss();
for (const l of roteiro.laminas) {
  await loadIcon(l.icone);
  for (const i of l.itens || []) if (typeof i === "object") await loadIcon(i.icone);
}
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
