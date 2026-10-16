/** @type {import('tailwindcss').Config} */
const defaultColors = require("tailwindcss/colors");

// Modo escuro do painel (pedido do dono, 2026-10-16): toda cor do sistema e
// das paletas usadas pelo painel passa por uma variável CSS com o valor CLARO
// de fallback — sem a classe `mm-dark` no <html> o resultado é idêntico ao de
// antes (site público e modo claro não mudam). Os valores escuros moram em
// app/admin-theme.css (html.mm-dark). Opacidade (`bg-brand/10`) continua
// funcionando via <alpha-value>.
function hexToChannels(hex) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).join(" ");
}
const themed = (name, hex) => `rgb(var(--mm-${name}, ${hexToChannels(hex)}) / <alpha-value>)`;
const themedScale = (name, scale) =>
  Object.fromEntries(Object.entries(scale).map(([shade, hex]) => [shade, themed(`${name}-${shade}`, hex)]));
const themedTone = (name, tone) =>
  Object.fromEntries(Object.entries(tone).map(([key, hex]) => [key, themed(key === "DEFAULT" ? name : `${name}-${key}`, hex)]));
const PALETTES = ["slate", "gray", "zinc", "stone", "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"];
const themedPalettes = Object.fromEntries(PALETTES.map((name) => [name, themedScale(name, defaultColors[name])]));

// Tokens do sistema visual — fonte de verdade das decisões:
// .claude/skills/design-crm/references/sistema-visual.md. Tudo aqui é
// aditivo: os tokens antigos (ink, muted, navy, brand, mist, line, soft,
// premium) continuam valendo até cada tela ser redesenhada.
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
    "./lib/**/*.{js,jsx}"
  ],
  theme: {
    extend: {
      colors: {
        ...themedPalettes,
        ink: themed("ink", "#1F2937"),
        muted: themed("muted", "#667085"),
        navy: themed("navy", "#0D3B66"),
        brand: themed("brand", "#1769D1"),
        mist: themed("mist", "#F5F7FA"),
        line: themed("line", "#E5EAF1"),
        // Rampa de texto em 4 níveis: ink (primário) · ink-2 (secundário) ·
        // muted (terciário) · faint (desabilitado/placeholder).
        "ink-2": themed("ink-2", "#475467"),
        faint: themed("faint", "#98A2B3"),
        // Cores semânticas de status — nunca usar vermelho/verde/âmbar cru.
        success: themedTone("success", { DEFAULT: "#067647", soft: "#ECFDF3", line: "#ABEFC6", strong: "#079455" }),
        warning: themedTone("warning", { DEFAULT: "#B54708", soft: "#FFFAEB", line: "#FEDF89", strong: "#DC6803" }),
        danger: themedTone("danger", { DEFAULT: "#B42318", soft: "#FEF3F2", line: "#FECDCA", strong: "#D92D20" }),
        info: themedTone("info", { DEFAULT: "#175CD3", soft: "#EFF8FF", line: "#B2DDFF", strong: "#1769D1" }),
        neutral: { ...themedScale("neutral", defaultColors.neutral), ...themedTone("neutral", { DEFAULT: "#475467", soft: "#F2F4F7", line: "#E4E7EC", strong: "#344054" }) }
      },
      borderRadius: {
        chip: "6px",
        control: "10px",
        card: "14px",
        panel: "20px"
      },
      boxShadow: {
        premium: "0 24px 80px rgba(13, 59, 102, 0.10)",
        soft: "0 14px 40px rgba(13, 59, 102, 0.08)",
        // Única sombra do sistema novo: só para o que flutua (menu, sheet,
        // barra fixa, toast). Card comum não leva sombra.
        float: "0 12px 32px -8px rgba(13, 59, 102, 0.20), 0 2px 6px rgba(13, 59, 102, 0.06)"
      },
      fontFamily: {
        // Família definida em app/globals.css (--font-ui).
        sans: ["var(--font-ui)"]
      },
      fontSize: {
        "2xs": ["11px", { lineHeight: "16px", letterSpacing: "0.02em" }]
      },
      transitionTimingFunction: {
        "out-ui": "cubic-bezier(0.2, 0, 0, 1)"
      },
      spacing: {
        touch: "44px"
      },
      minHeight: {
        touch: "44px"
      },
      minWidth: {
        touch: "44px"
      }
    }
  },
  plugins: []
};
