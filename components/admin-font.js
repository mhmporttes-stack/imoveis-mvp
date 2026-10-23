import { Manrope } from "next/font/google";

// Tipografia oficial do painel (escolha do dono em 2026-10-01, depois do
// comparativo Manrope × Inter). Carregada só nas rotas /admin (app/admin/layout.jsx) e nas telas de entrada do painel
// (app/painel-acesso/layout.jsx: login e redefinir senha) — o site público continua com a pilha padrão de --font-ui
// (app/globals.css). A regra fica no :root (e não num wrapper) para valer também em modais renderizados por portal
// direto no <body>.
const manrope = Manrope({ subsets: ["latin"], display: "swap" });
export const ADMIN_FONT_CSS = `:root{--font-ui:${manrope.style.fontFamily}, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;}`;
