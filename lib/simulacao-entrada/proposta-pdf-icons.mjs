/**
 * Ícones do PDF: uma única família "outline" (traço fino, pontas arredondadas) em grade 24×24,
 * desenhados como vetor (SVG path) — nada de fonte de ícones nem imagem. Geometria adaptada do
 * conjunto Lucide (licença ISC), escolhida para ser legível em tamanho pequeno.
 */

const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const ICONS = {
  /** Carteira — ato inicial. */
  coins: ["M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1", "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"],
  /** Casa — valor do imóvel. */
  home: ["M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 22V12h6v10"],
  /** Banco — financiamento. */
  bank: ["M3 22h18", "M6 18v-7", "M10 18v-7", "M14 18v-7", "M18 18v-7", "M12 2L3 7h18z"],
  /** Presente — descontos e benefícios. */
  gift: ["M20 12v10H4V12", "M2 7h20v5H2z", "M12 22V7", "M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z", "M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"],
  /** Pin — localização. */
  pin: ["M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z", circle(12, 10, 3)],
  /** Documento — documentação. */
  doc: ["M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z", "M14 2v6h6", "M16 13H8", "M16 17H8", "M10 9H8"],
  /** Casa com visto — subsídio habitacional. */
  homeCheck: ["M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 15l2 2 4-4"],
  /** Bandeira — programa estadual (Casa Paulista). */
  flag: ["M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z", "M4 22v-7"],
  /** Etiqueta — desconto cadastrado (sem ícone de porcentagem). */
  tag: ["M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.41l8.7 8.71a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z", circle(7.5, 7.5, 0.6)],
  /** Calendário com visto — entrada parcelada. */
  calendar: ["M8 2v4", "M16 2v4", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M3 10h18", "M9 16l2 2 4-4"],
  /** Cédula — parcelas do financiamento. */
  bars: ["M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z", circle(12, 12, 2.5), "M6 12h.01", "M18 12h.01"],
  /** Círculo com visto — vantagem genérica. */
  check: [circle(12, 12, 10), "M8 12l3 3 5-6"],
  /** Escudo com visto — isenções e segurança. */
  shield: ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z", "M9 12l2 2 4-4"],
  /** Ondas — lazer e piscina. */
  waves: ["M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1", "M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1", "M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"],
  /** Globo — site. */
  globe: [circle(12, 12, 10), "M2 12h20", "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"],
  /** Instagram. */
  instagram: ["M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5z", circle(12, 12, 4), "M17.5 6.5h.01"]
};

/**
 * Ícone da vantagem pelo SENTIDO do texto cadastrado (nunca altera o texto): só troca o desenho
 * quando a palavra-chave é inequívoca; caso contrário usa o visto genérico.
 */
export function iconForFeature(text = "") {
  const t = String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/isen|iptu|taxa|seguranc|portaria|monitor|camera/.test(t)) return "shield";
  if (/piscina|aqua|agua/.test(t)) return "waves";
  if (/bairro|proxim|escola|comercio|mercado|transporte|onibus|avenida|localiz/.test(t)) return "pin";
  return "check";
}
