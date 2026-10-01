/** @type {import('tailwindcss').Config} */
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
        ink: "#1F2937",
        muted: "#667085",
        navy: "#0D3B66",
        brand: "#1769D1",
        mist: "#F5F7FA",
        line: "#E5EAF1",
        // Rampa de texto em 4 níveis: ink (primário) · ink-2 (secundário) ·
        // muted (terciário) · faint (desabilitado/placeholder).
        "ink-2": "#475467",
        faint: "#98A2B3",
        // Cores semânticas de status — nunca usar vermelho/verde/âmbar cru.
        success: { DEFAULT: "#067647", soft: "#ECFDF3", line: "#ABEFC6", strong: "#079455" },
        warning: { DEFAULT: "#B54708", soft: "#FFFAEB", line: "#FEDF89", strong: "#DC6803" },
        danger: { DEFAULT: "#B42318", soft: "#FEF3F2", line: "#FECDCA", strong: "#D92D20" },
        info: { DEFAULT: "#175CD3", soft: "#EFF8FF", line: "#B2DDFF", strong: "#1769D1" },
        neutral: { DEFAULT: "#475467", soft: "#F2F4F7", line: "#E4E7EC", strong: "#344054" }
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
