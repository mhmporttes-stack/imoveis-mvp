import { Inter, Manrope } from "next/font/google";

// Fontes do comparativo (somente vitrine). Manrope foi escolhida pelo dono
// (2026-10-01) e é carregada no painel por app/admin/layout.jsx; aqui é o
// padrão da vitrine. Inter fica para comparação.
export const manrope = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-manrope" });
export const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const FONTES = {
  atual: { label: "Atual (sistema)", className: "", stack: "" },
  manrope: { label: "Manrope", className: manrope.variable, stack: "var(--font-manrope), ui-sans-serif, system-ui, sans-serif" },
  inter: { label: "Inter", className: inter.variable, stack: "var(--font-inter), ui-sans-serif, system-ui, sans-serif" }
};
