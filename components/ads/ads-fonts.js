import { Anton } from "next/font/google";

// Fonte do número-destaque dos cards de Anúncios — a mesma do padrão dos
// carrosséis do Matheus (docs/posicionamento/ESTILO-CARROSSEL.md). Carregada
// só por esta área; o resto do painel continua em Manrope.
export const anton = Anton({ subsets: ["latin"], weight: "400", display: "swap" });
