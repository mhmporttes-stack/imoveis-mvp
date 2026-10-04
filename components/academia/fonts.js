// Fontes da Academia hospedadas no app (arquivos em ./fonts, licença SIL OFL em
// ./fonts/OFL-LICENSE.txt). Sem Google Fonts em runtime. Variáveis escopadas: só valem
// onde a classe é aplicada (o wrapper da Academia).
import localFont from "next/font/local";

export const academiaSerif = localFont({
  src: [{ path: "./fonts/Fraunces-latin-var.woff2", style: "normal", weight: "300 600" }],
  variable: "--font-academia-serif",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
  adjustFontFallback: "Times New Roman"
});

export const academiaSans = localFont({
  src: [{ path: "./fonts/Manrope-latin-var.woff2", style: "normal", weight: "400 800" }],
  variable: "--font-academia-sans",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
  adjustFontFallback: "Arial"
});
