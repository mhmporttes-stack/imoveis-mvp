// Gera app/admin-theme-auto.css — a parte automática do modo escuro do painel (pedido do dono, 2026-10-16).
//
//   node .claude/design/tools/gerar-tema-escuro.mjs
//
// 1. Valores escuros das variáveis --mm-* que o tailwind.config.cjs usa em TODAS as cores (tokens do sistema e
//    paletas do Tailwind). Sem html.mm-dark as variáveis não existem e vale o fallback claro de sempre.
// 2. Exceções que variável não resolve, procuradas nas classes realmente usadas em app/ e components/:
//    bg-white (vira superfície escura), fundos sólidos 600–950 (continuam sólidos: levam texto branco),
//    bg-navy/bg-brand sólidos, véus bg-navy/40+ e cores fixas `bg-[#hex]`/`text-[#hex]` (convertidas pela luz).
// Rode de novo depois de criar tela com cor fixa nova. Ajustes finos de componente ficam em app/admin-theme.css.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const require = createRequire(path.join(ROOT, "package.json"));
const twColors = require("tailwindcss/colors");

// ---------- Paleta escura ----------
// Visual novo do painel (dono, 2026-10-22, protótipo aprovado): azul-noite em camadas (fundo #07111F · superfície
// #0D1B2E · borda #1A3150), texto #E6EDF6 → #7E93AE e destaque ciano #4FC3E0 (texto de link #7FD8EC).
// Antes (2026-10-16): fundo #0C1827 · superfície #122236.
const PAGE = "#07111F"; // fundo das telas (mist)
const SURFACE = "#0D1B2E"; // cartões, cabeçalho, barras (bg-white)
const LINE = "#1A3150";

const TOKENS = {
  mist: PAGE,
  line: LINE,
  navy: "#E6EDF6", // texto principal/títulos (text-navy é o texto mais usado do painel)
  ink: "#E6EDF6",
  "ink-2": "#C9D6E6",
  muted: "#9DB0C8",
  faint: "#7E93AE",
  brand: "#7FD8EC", // link/realce sobre escuro; o fundo sólido bg-brand é tratado à parte
  success: "#3DD598", "success-soft": "#0F2E22", "success-line": "#1B4E3A", "success-strong": "#1FB37A",
  warning: "#F2C66D", "warning-soft": "#2A2312", "warning-line": "#5A4718", "warning-strong": "#D99A1E",
  danger: "#F0716A", "danger-soft": "#3A1716", "danger-line": "#6A2A28", "danger-strong": "#E0524A",
  info: "#7FD8EC", "info-soft": "#0F2A47", "info-line": "#24527A", "info-strong": "#4FC3E0",
  neutral: "#C9D6E6", "neutral-soft": "#13263F", "neutral-line": "#1F3A5C", "neutral-strong": "#E6EDF6"
};

const SOLID = { navy: "#1C5B85", brand: "#1C6E9A", ink: "#22344D" }; // fundos sólidos (com texto branco)
const OVERLAY = "2 6 13"; // véu de modal/foto
const GRAYS = ["slate", "gray", "zinc", "stone", "neutral"];
const PALETTES = ["slate", "gray", "zinc", "stone", "neutral", "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"];
const GRAY_DARK = { 50: "#0F1F35", 100: "#13263F", 200: "#1A3150", 300: "#24426A", 400: "#7E93AE", 500: "#9DB0C8", 600: "#B3C3D7", 700: "#C9D6E6", 800: "#DCE5F0", 900: "#E6EDF6", 950: "#F3F7FB" };

// ---------- cor ----------
const hexToRgb = (hex) => {
  let h = hex.replace("#", "");
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const channels = (hex) => hexToRgb(hex).join(" ");
const mix = (a, b, t) => { const x = hexToRgb(a); const y = hexToRgb(b); return rgbToHex(x.map((v, i) => v * t + y[i] * (1 - t))); };
function toHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min; const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12; const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}
const hue = (hex) => { const [h, s] = toHsl(hex); return fromHsl(h, Math.min(s, 0.75), 0.5); };

function paletteDark(name) {
  const p = twColors[name];
  if (GRAYS.includes(name)) return GRAY_DARK;
  return {
    50: mix(p[500], SURFACE, 0.13), 100: mix(p[500], SURFACE, 0.2), 200: mix(p[500], SURFACE, 0.32), 300: mix(p[500], SURFACE, 0.48),
    400: p[400], 500: p[500], 600: p[400], 700: p[300], 800: p[200], 900: p[100], 950: p[50]
  };
}

// Cor fixa (`bg-[#hex]` etc.) → equivalente escuro pela luminosidade, mantendo o matiz.
function darkArbitrary(role, hex) {
  const [h, s, l] = toHsl(hex);
  if (role === "text") return l < 0.55 ? fromHsl(h, Math.min(s, 0.55), Math.min(0.9, 1 - l * 0.55)) : null;
  if (role === "border") return l > 0.6 ? mix(hue(hex), SURFACE, 0.28) : null;
  // fundos/gradientes: claro vira superfície tingida; escuro/saturado continua (botão, faixa de marca)
  if (l > 0.6 && !(s > 0.7 && l < 0.75)) return s < 0.08 ? mix("#ffffff", SURFACE, 0.03 + (1 - l) * 0.5) : mix(hue(hex), SURFACE, 0.06 + (1 - l) * 0.55);
  return null;
}

// ---------- varredura das classes ----------
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(jsx?|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}
const files = [...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "app"))];
const classes = new Set();
const TOKEN_RE = /(?<![\w-])((?:[a-z0-9-]+:)*)(bg|text|border|from|to|via|ring|divide|outline|decoration|fill|stroke|placeholder)-(\[#[0-9A-Fa-f]{3,8}\]|white|navy|brand|ink|[a-z]+-(?:600|700|800|900|950))(\/(?:\[[0-9.]+\]|\d+))?(?![\w\[-])/g;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(TOKEN_RE)) classes.add(m[0]);
}

const esc = (cls) => cls.replace(/([:/\[\]#.%])/g, "\\$1");
const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 };
const PSEUDO = { hover: ":hover", focus: ":focus", "focus-visible": ":focus-visible", "focus-within": ":focus-within", active: ":active", disabled: ":disabled", checked: ":checked" };

function selectorFor(cls) {
  const parts = cls.split(":");
  const variants = parts.slice(0, -1);
  let media = null; let pseudo = ""; let before = "";
  for (const v of variants) {
    if (BREAKPOINTS[v]) media = BREAKPOINTS[v];
    else if (PSEUDO[v]) pseudo += PSEUDO[v];
    else if (v === "group-hover") before = ".group:hover ";
    else if (v === "peer-checked") before = ".peer:checked ~ ";
    else if (v === "placeholder") pseudo += "::placeholder";
    else if (v === "after" || v === "before") pseudo += `::${v}`;
    else return null; // variante rara: fica de fora (cai no tratamento por variável)
  }
  return { sel: `:where(html.mm-dark) ${before}.${esc(cls)}${pseudo}`, media };
}

function alphaOf(raw) {
  if (!raw) return 1;
  const v = raw.slice(1).replace(/[\[\]]/g, "");
  return Number(v) > 1 ? Number(v) / 100 : Number(v);
}
const rgba = (hex, a) => `rgb(${channels(hex)} / ${+a.toFixed(3)})`;

function declFor(prop, color, cls) {
  switch (prop) {
    case "bg": return `background-color: ${color};`;
    case "text": return `color: ${color};`;
    case "border": return `border-color: ${color};`;
    case "divide": return null;
    case "ring": return `--tw-ring-color: ${color};`;
    case "outline": return `outline-color: ${color};`;
    case "decoration": return `text-decoration-color: ${color};`;
    case "fill": return `fill: ${color};`;
    case "stroke": return `stroke: ${color};`;
    case "placeholder": return `color: ${color};`;
    case "from": return `--tw-gradient-from: ${color} var(--tw-gradient-from-position); --tw-gradient-to: transparent var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to);`;
    case "via": return `--tw-gradient-to: transparent var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), ${color} var(--tw-gradient-via-position), var(--tw-gradient-to);`;
    case "to": return `--tw-gradient-to: ${color} var(--tw-gradient-to-position);`;
    default: return null;
  }
}

function overrideFor(cls) {
  const m = cls.match(/^((?:[a-z0-9-]+:)*)(bg|text|border|from|to|via|ring|divide|outline|decoration|fill|stroke|placeholder)-(\[#[0-9A-Fa-f]{3,8}\]|white|navy|brand|ink|([a-z]+)-(600|700|800|900|950))(\/(?:\[[0-9.]+\]|\d+))?$/);
  if (!m) return null;
  const [, variants, prop, colorKey, palette, shade, alphaRaw] = m;
  const a = alphaOf(alphaRaw);
  const isHover = /(^|:)(hover|group-hover|focus|active):/.test(variants);
  let color = null;
  if (colorKey.startsWith("[#")) {
    const hex = colorKey.slice(2, -1);
    const role = ["text", "placeholder", "decoration", "fill", "stroke"].includes(prop) ? "text" : ["border", "ring", "divide", "outline"].includes(prop) ? "border" : "bg";
    const dark = darkArbitrary(role, hex);
    if (!dark) return null;
    color = rgba(dark, a);
  } else if (colorKey === "white") {
    if (!["bg", "from", "via", "to", "border", "ring"].includes(prop)) return null; // texto branco continua branco
    if (prop === "border" || prop === "ring") { if (a < 1) return null; color = SURFACE; }
    else if (a < 0.5) return null; // véu branco translúcido sobre foto/faixa escura continua
    else color = rgba(SURFACE, a);
  } else if (["navy", "brand", "ink"].includes(colorKey)) {
    if (!["bg", "from", "via", "to"].includes(prop)) return null; // texto/borda já resolvidos pela variável
    if (a < 0.4) return null; // tinta leve: a variável clara a 5–30% já funciona sobre o escuro
    color = !isHover && a < 1 && prop === "bg" && colorKey !== "brand" ? `rgb(${OVERLAY} / ${a})` : rgba(SOLID[colorKey], a);
  } else if (palette && PALETTES.includes(palette)) {
    if (!["bg", "from", "via", "to"].includes(prop)) return null; // texto 600–950 clareia pela variável
    if (a < 0.4) return null;
    const hex = GRAYS.includes(palette) ? ({ 600: "#475569", 700: "#334155", 800: "#2A3B52", 900: "#22334A", 950: "#1B2A3E" })[shade] : twColors[palette][shade];
    color = rgba(hex, a);
  } else return null;
  const decl = declFor(prop, color, cls);
  if (!decl) return null;
  const s = selectorFor(cls);
  if (!s) return null;
  return { ...s, decl };
}

// ---------- saída ----------
const lines = [];
lines.push("/* GERADO por .claude/design/tools/gerar-tema-escuro.mjs — não editar à mão (ajustes: app/admin-theme.css). */");
lines.push("/* Modo escuro do painel (dono, 2026-10-16). Só vale com html.mm-dark (components/admin-theme.js). */");
lines.push("html.mm-dark {");
for (const [name, hex] of Object.entries(TOKENS)) lines.push(`  --mm-${name}: ${channels(hex)};`);
for (const name of PALETTES) {
  for (const [shade, hex] of Object.entries(paletteDark(name))) lines.push(`  --mm-${name}-${shade}: ${channels(hex)};`);
}
lines.push(`  --mm-surface: ${SURFACE};`);
lines.push(`  --mm-surface-raised: ${mix("#ffffff", SURFACE, 0.035)};`);
lines.push(`  --mm-page: ${PAGE};`);
lines.push("}");
lines.push("");

const plain = []; const byMedia = {};
for (const cls of [...classes].sort()) {
  const o = overrideFor(cls);
  if (!o) continue;
  const rule = `${o.sel} { ${o.decl} }`;
  if (o.media) (byMedia[o.media] ||= []).push(rule); else plain.push(rule);
}
// hover/foco depois do estado base (mesma especificidade, vence pela ordem)
plain.sort((x, y) => Number(/:(hover|focus|active)/.test(x)) - Number(/:(hover|focus|active)/.test(y)));
lines.push(...plain);
for (const bp of Object.keys(byMedia).map(Number).sort((a, b) => a - b)) {
  lines.push(`@media (min-width: ${bp}px) {`);
  for (const rule of byMedia[bp]) lines.push(`  ${rule}`);
  lines.push("}");
}
const out = path.join(ROOT, "app/admin-theme-auto.css");
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(`${out}: ${plain.length + Object.values(byMedia).flat().length} exceções de classe, ${classes.size} classes analisadas`);
