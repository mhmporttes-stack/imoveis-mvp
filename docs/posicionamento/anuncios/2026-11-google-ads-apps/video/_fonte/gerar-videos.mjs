// Gera vídeos do Google Ads (apps) nas versões A/B/C/D x formatos 1x1, 9x16, 16x9 + PNG do último quadro.
// Só ffmpeg + ImageMagick + Node. Imóvel: fotos reais do COD4354 (Palmital), interiores, sem número. Pessoa: só fotos reais do Matheus (recortes do repositório).
// Uso (da raiz do repo): node .../video/_fonte/gerar-videos.mjs <A|B|C|D> [1x1,9x16,16x9]
//   A = só imóvel · B = Matheus de braços cruzados entra na abertura (fundo da marca) · C = Matheus aponta para "Descubra seu poder de compra" · D = abertura de 2 s com ele, depois imóveis
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const VERSAO = (process.argv[2] || "A").toUpperCase();
const SO = (process.argv[3] || "1x1,9x16,16x9").split(",");
const AQUI = dirname(fileURLToPath(import.meta.url));
const SAIDA = join(AQUI, "..");
const RAIZ = join(AQUI, "../../../../../..");
const TMP = join(process.env.TMPDIR || "/tmp", `gads-video-${VERSAO}`);
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
const TN = join(RAIZ, "docs/posicionamento/carrosseis/2026-10-15-palmital-casa-nova/tn");
const SIMB = join(RAIZ, "public/assets/matheus-machado-symbol.png");
const PESSOAS = {
  cruzados: join(RAIZ, "docs/posicionamento/assets/boneco-3d/realista-hd/bracos-cruzados.png"),
  aponta: join(RAIZ, "docs/posicionamento/assets/boneco-3d/realista-hd/apontando.png"),
};
const FB = "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf";
const FS = "/usr/share/fonts/opentype/inter/Inter-Bold.otf";
const NAVY = "#031D3A", AZUL = "#3B8BFF";
const TRANS = 0.5, FPS = 30;
const run = (c, a) => execFileSync(c, a, { stdio: ["ignore", "ignore", "pipe"] });
const ident = (arg, f) => execFileSync("identify", ["-format", f, arg]).toString();
const measure = (font, size, txt) => Number(execFileSync("convert", ["-font", font, "-pointsize", String(size), `label:${txt}`, "-format", "%w", "info:"]).toString());

const FORMATOS = [
  { id: "1x1", W: 1080, H: 1080, u: 1080, maxFs: 120 },
  { id: "9x16", W: 1080, H: 1920, u: 1400, maxFs: 124 },
  { id: "16x9", W: 1920, H: 1080, u: 1080, maxFs: 118 },
].filter((f) => SO.includes(f.id));

// Geometria do texto e da pessoa por formato (margem de segurança >= 10%).
function layout(f, tipo) {
  const land = f.W > f.H, port = f.H > f.W;
  if (land) return { txt: { cx: f.W * 0.3, safeW: f.W * 0.46, cy: f.H * 0.5, maxFs: 100 }, pes: { h: Math.round(f.H * 0.9), xc: f.W * 0.74 } };
  if (tipo === "aponta") {
    const h = Math.round(f.H * (port ? 0.56 : 0.62));
    return { txt: { cx: f.W / 2, safeW: f.W * 0.78, cy: f.H * (port ? 0.3 : 0.23), maxFs: port ? 120 : 92 }, pes: { h, xr: f.W * 0.92 } };
  }
  return { txt: { cx: f.W / 2, safeW: f.W * 0.78, cy: f.H * (port ? 0.22 : 0.22), maxFs: port ? 120 : 92 }, pes: { h: Math.round(f.H * (port ? 0.6 : 0.66)), xc: f.W / 2 } };
}

function montarFundo(f, foto, nome, alpha, modo, objY) {
  const [fw, fh] = ident(foto, "%w %h").split(" ").map(Number);
  const ar = f.W / f.H; let cw = fw, ch = Math.round(fw / ar); if (ch > fh) { ch = fh; cw = Math.round(fh * ar); }
  const oy = Math.round((fh - ch) * objY), ox = Math.round((fw - cw) / 2);
  const W2 = f.W * 2, H2 = f.H * 2, out = join(TMP, `${nome}.png`), base = join(TMP, `${nome}-b.png`);
  run("convert", [foto, "-crop", `${cw}x${ch}+${ox}+${oy}`, "+repage", "-filter", "Lanczos", "-resize", `${W2}x${H2}!`, base]);
  if (modo === "escuro") {
    run("convert", [base, "(", "-size", `${W2}x${H2}`, `xc:rgba(3,29,58,${alpha})`, ")", "-composite", out]);
  } else { // claro em cima, escurece embaixo (onde entra o texto)
    const g = join(TMP, `${nome}-g.png`);
    run("convert", ["-size", `${W2}x${H2}`, "gradient:black-white", "-sigmoidal-contrast", "5,50%", g]);
    run("convert", [base, "(", "-size", `${W2}x${H2}`, `xc:${NAVY}`, g, "-compose", "CopyOpacity", "-composite", "-channel", "A", "-evaluate", "multiply", "0.93", "+channel", ")", "-compose", "over", "-composite", out]);
  }
  return out;
}

function bloco(f, linhas, tIn, tOut, o) {
  const space = (fs) => measure(FB, fs, "a a") - measure(FB, fs, "aa");
  const larg1 = (l, fs) => l.reduce((s, w) => s + measure(FB, fs, w.t), 0) + space(fs) * (l.length - 1);
  let fs = Math.min(f.maxFs, o.maxFs || 999);
  while (Math.max(...linhas.map((l) => larg1(l, fs))) > o.safeW) fs -= 2;
  const lh = Math.round(fs * 1.18), y0 = Math.round(o.cy - (lh * linhas.length) / 2);
  const filtros = []; let k = 0;
  linhas.forEach((l, li) => {
    let x = Math.round(o.cx - larg1(l, fs) / 2);
    const base = y0 + li * lh + Math.round(fs * 0.92); // linha de base fixa (alinha palavras com alturas diferentes)
    l.forEach((w) => {
      const ti = tIn + (o.stagger || 0.2) * k++;
      const p = `clip((t-${ti.toFixed(2)})/0.4,0,1)`;
      filtros.push(`drawtext=fontfile=${FB}:text='${w.t}':fontsize=${fs}:fontcolor=${w.c || "white"}:x=${x}:y='${base}-max_glyph_a+55*pow(1-${p},2)':shadowcolor=black@0.5:shadowx=0:shadowy=5:alpha='${p}*clip((${tOut.toFixed(2)}-t)/0.3,0,1)':enable='between(t,${ti.toFixed(2)},${tOut.toFixed(2)})'`);
      x += measure(FB, fs, w.t) + Math.round(space(fs));
    });
  });
  return filtros;
}

function cartao(f) {
  const { W, H, u } = f, out = join(TMP, `card-${f.id}.png`), bg = join(TMP, `bg4-${f.id}.png`), fim = join(SAIDA, `ultimo-quadro-${f.id}.png`);
  run("convert", ["-size", `${W}x${H}`, `radial-gradient:#0B3566-${NAVY}`, bg]);
  const btnW = Math.min(Math.round(u * 0.64), Math.round(W * 0.74));
  const sh = Math.round(u * 0.17), nameFs = Math.round(u * 0.056), btnH = Math.round(u * 0.118), btnFs = Math.round(u * 0.054), subFs = Math.round(u * 0.036), g = Math.round(u * 0.04);
  const total = sh + g * 0.6 + nameFs * 2.3 + g * 1.6 + btnH + g * 1.2 + subFs;
  let y = Math.round((H - total) / 2);
  const a = ["-size", `${W}x${H}`, "xc:none"];
  const simb = join(TMP, "s.png"); run("convert", [SIMB, "-resize", `x${sh}`, simb]);
  const sw = Number(ident(simb, "%w"));
  a.push(simb, "-geometry", `+${Math.round((W - sw) / 2)}+${y}`, "-composite"); y += sh + Math.round(g * 0.6);
  a.push("-gravity", "NorthWest", "-font", FB, "-fill", "white", "-pointsize", String(nameFs));
  for (const t of ["Matheus Machado", "Corretor de Imóveis"]) {
    const w = measure(FB, nameFs, t); a.push("-annotate", `+${Math.round((W - w) / 2)}+${y}`, t); y += Math.round(nameFs * 1.15);
  }
  y += Math.round(g * 1.6);
  a.push("-fill", AZUL, "-draw", `roundrectangle ${Math.round((W - btnW) / 2)},${y} ${Math.round((W + btnW) / 2)},${y + btnH} ${btnH / 2},${btnH / 2}`);
  const bt = "Simular Agora", bw = measure(FB, btnFs, bt);
  a.push("-fill", "white", "-pointsize", String(btnFs), "-annotate", `+${Math.round((W - bw) / 2)}+${y + Math.round((btnH - btnFs) / 2) - 2}`, bt);
  y += btnH + Math.round(g * 1.2);
  const st = "Simulação grátis e sem compromisso", stw = measure(FS, subFs, st);
  a.push("-font", FS, "-pointsize", String(subFs), "-fill", "#DCE8F7", "-annotate", `+${Math.round((W - stw) / 2)}+${y}`, st);
  a.push(out); run("convert", a);
  run("convert", [bg, out, "-composite", fim]);
  return { out, bg };
}

function pessoaPng(f, tipo, h) {
  const out = join(TMP, `pessoa-${tipo}-${f.id}.png`);
  run("convert", [PESSOAS[tipo], "-trim", "+repage", "-filter", "Lanczos", "-resize", `x${h}`, out]);
  return { out, w: Number(ident(out, "%w")) };
}

const ZP = [
  { z: "1+0.14*on/N", x: "(iw-iw/zoom)*(0.15+0.7*on/N)", y: "(ih-ih/zoom)/2" },
  { z: "1.16-0.14*on/N", x: "(iw-iw/zoom)/2", y: "(ih-ih/zoom)*(0.7-0.5*on/N)" },
  { z: "1+0.14*on/N", x: "(iw-iw/zoom)*(0.85-0.7*on/N)", y: "(ih-ih/zoom)/2" },
];
const L = (...ls) => ls;
const azul = (t) => ({ t, c: AZUL });
const b = (t) => ({ t });

for (const f of FORMATOS) {
  const { out: card, bg } = cartao(f);
  const bgMarca = bg; // fundo radial da marca
  const lyCruz = layout(f, "cruzados"), lyAp = layout(f, "aponta");
  // Cenas por versão
  const cenaHook = { tipo: "foto", foto: "f5.jpg", alpha: 0.5, modo: "escuro", objY: 0.55, zp: 0, len: 3.5, linhas: L(L(b("Quer"), b("sair")), L(b("do"), azul("aluguel?"))), cy: 0.5 };
  const cenaPoder = (extra = {}) => ({ tipo: "foto", foto: "f3.jpg", alpha: 0.5, modo: "claro", objY: 0.35, zp: 1, len: 3.5, linhas: L(L(b("Descubra"), b("seu")), L(azul("poder"), azul("de"), azul("compra"))), cy: f.H * (f.H > f.W ? 0.74 : 0.7) / f.H, ...extra });
  const cenaMin = { tipo: "foto", foto: "f4.jpg", alpha: 0.5, modo: "escuro", objY: 0.45, zp: 2, len: 3.5, linhas: L(L(b("em"), b("menos"), b("de")), L(azul("2"), azul("minutos"))), cy: 0.5 };
  const fecho = { tipo: "fecho", len: 4.5 };
  let cenas;
  if (VERSAO === "A") cenas = [cenaHook, cenaPoder(), cenaMin, fecho];
  else if (VERSAO === "B") cenas = [{ tipo: "marca", pessoa: "cruzados", len: 3.5, linhas: cenaHook.linhas, ly: lyCruz, tIn: 0.45 }, cenaPoder(), cenaMin, fecho];
  else if (VERSAO === "C") cenas = [cenaHook, cenaPoder({ modo: "escuro", alpha: 0.58, pessoa: "aponta", ly: lyAp, zp: 1 }), cenaMin, fecho];
  else cenas = [{ tipo: "marca", pessoa: "cruzados", len: 2.4, linhas: L(L(b("Matheus"), b("Machado")), L(azul("Corretor"), azul("de"), azul("Imóveis"))), ly: lyCruz, tIn: 0.3, stagger: 0.1 }, { ...cenaHook, len: 3.4 }, cenaPoder({ len: 3.4 }), { ...cenaMin, len: 3.4 }, { ...fecho, len: 4.4 }];

  const off = []; let acc = 0; cenas.forEach((c, i) => { acc += c.len; off.push(acc - TRANS * (i + 1)); });
  const total = off[off.length - 2] + cenas[cenas.length - 1].len;
  const inputs = [], fc = [], T = []; let idx = 0;
  cenas.forEach((c, i) => {
    const start = i === 0 ? 0 : off[i - 1];
    if (c.tipo === "fecho") {
      inputs.push("-loop", "1", "-framerate", String(FPS), "-t", String(c.len), "-i", bgMarca, "-loop", "1", "-framerate", String(FPS), "-t", String(c.len), "-i", card);
      fc.push(`[${idx}:v]format=yuv420p,setsar=1[bb${i}]`, `[${idx + 1}:v]format=rgba,fade=t=in:st=0.55:d=0.6:alpha=1[cc${i}]`, `[bb${i}][cc${i}]overlay=format=auto,format=yuv420p[v${i}]`);
      idx += 2; return;
    }
    let ly = c.ly;
    if (c.tipo === "foto") {
      const img = montarFundo(f, join(TN, c.foto), `${f.id}-s${i}`, c.alpha, c.modo, c.objY);
      const N = Math.round(c.len * FPS), r = (s) => s.replaceAll("N", N), z = ZP[c.zp];
      inputs.push("-loop", "1", "-framerate", String(FPS), "-t", String(c.len), "-i", img);
      fc.push(`[${idx}:v]zoompan=z='${r(z.z)}':x='${r(z.x)}':y='${r(z.y)}':d=1:s=${f.W}x${f.H}:fps=${FPS},setsar=1,format=yuv420p[${c.pessoa ? "pb" + i : "v" + i}]`);
      idx++;
    } else {
      inputs.push("-loop", "1", "-framerate", String(FPS), "-t", String(c.len), "-i", bgMarca);
      fc.push(`[${idx}:v]format=yuv420p,setsar=1[pb${i}]`); idx++;
    }
    if (c.pessoa) {
      const p = pessoaPng(f, c.pessoa, ly.pes.h);
      const x = ly.pes.xr != null ? Math.round(ly.pes.xr - p.w) : Math.round(ly.pes.xc - p.w / 2), y = f.H - ly.pes.h + (c.pessoa === "aponta" ? 0 : 0);
      inputs.push("-loop", "1", "-framerate", String(FPS), "-t", String(c.len), "-i", p.out);
      fc.push(`[${idx}:v]format=rgba,fade=t=in:st=0.15:d=0.5:alpha=1[pp${i}]`,
        `[pb${i}][pp${i}]overlay=x='${x}+${Math.round(f.W * 0.4)}*pow(1-clip((t-0.15)/0.85,0,1),2)-8*t':y='${y}+10*t':format=auto,format=yuv420p[v${i}]`);
      idx++;
    }
    const o = c.ly ? { ...c.ly.txt, stagger: c.stagger } : { cx: f.W / 2, safeW: f.W * 0.78, cy: c.cy * f.H, maxFs: f.maxFs };
    T.push(...bloco(f, c.linhas, c.tIn ?? start + (i === 0 ? 0.25 : 0.7), off[i] - 0.2, o));
  });
  let cur = "v0";
  for (let i = 1; i < cenas.length; i++) { fc.push(`[${cur}][v${i}]xfade=transition=slideleft:duration=${TRANS}:offset=${off[i - 1].toFixed(2)}[x${i}]`); cur = `x${i}`; }
  fc.push(`[${cur}]${T.join(",")},format=yuv420p[out]`);
  const script = join(TMP, `fc-${f.id}.txt`); writeFileSync(script, fc.join(";\n"));
  const dest = join(SAIDA, `video-${f.id}-${VERSAO}.mp4`);
  run("ffmpeg", ["-y", ...inputs, "-filter_complex_script", script, "-map", "[out]", "-t", total.toFixed(2), "-r", String(FPS), "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", "20", "-maxrate", "6M", "-bufsize", "12M", "-movflags", "+faststart", "-an",
    "-metadata", "title=Matheus Machado Corretor de Imóveis - Simulação de financiamento", "-metadata", "artist=Matheus Machado Corretor de Imóveis", dest]);
  console.log("ok", dest, total.toFixed(1) + "s");
}
