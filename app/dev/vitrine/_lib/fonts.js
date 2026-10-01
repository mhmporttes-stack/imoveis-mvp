import { Inter, Manrope } from "next/font/google";

// Fontes candidatas do comparativo (somente vitrine). A escolhida pelo dono
// passa a ser carregada em app/layout.jsx e definida em --font-ui.
export const manrope = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-manrope" });
export const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const FONTES = {
  atual: { label: "Atual (sistema)", className: "", stack: "" },
  manrope: { label: "Manrope", className: manrope.variable, stack: "var(--font-manrope), ui-sans-serif, system-ui, sans-serif" },
  inter: { label: "Inter", className: inter.variable, stack: "var(--font-inter), ui-sans-serif, system-ui, sans-serif" }
};
