/**
 * TOKENS DE DESIGN do PDF "Proposta de Valores" (v4).
 *
 * É AQUI que se muda o visual: cores, gradiente, tipografia, espaçamentos, cartões, sombra,
 * marca d'água, foto e links. O gerador (`proposta-pdf.mjs`) só lê estes valores — não há
 * número "mágico" de estilo espalhado pelo código. Unidades: pontos PDF (1pt = 1/72 pol.),
 * A4 = 595,28 × 841,89. Cores em hexadecimal (#RRGGBB).
 *
 * Âncoras de identidade (não alterar sem decisão do dono): símbolo oficial da marca
 * (`public/assets/matheus-machado-symbol.png`) e a paleta azul medida nele
 * (azul #3673C2 / azul-marinho profundo #031D3A).
 */

const hex = (value) => {
  const n = Number.parseInt(String(value).replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const colors = {
  /** Fundo da página: do topo (azul-marinho) até o branco, em transição contínua (posição 0..1 da altura). */
  gradient: [
    [0, "#031D3A"],
    [0.09, "#06285A"],
    [0.2, "#0F3A74"],
    [0.3, "#2C63AB"],
    [0.38, "#7FA9DA"],
    [0.46, "#C9DCF3"],
    [0.56, "#E9F1FB"],
    [0.72, "#F7FAFE"],
    [1, "#FFFFFF"]
  ],
  /** Cabeçalho compacto das páginas de continuação: azul-marinho que some em branco em `continuationHeight`. */
  gradientContinuation: [
    [0, "#031D3A"],
    [0.3, "#0F3A74"],
    [0.62, "#7FA9DA"],
    [0.86, "#E3EDF9"],
    [1, "#FFFFFF"]
  ],
  brand: "#3673C2",
  brandDeep: "#031D3A",
  ink: "#0B1F35",
  muted: "#566679",
  line: "#DCE5F0",
  card: "#FFFFFF",
  cardBorder: "#D3E0F0",
  pill: "#E8F0FA",
  onDark: "#FFFFFF",
  onDarkSoft: "#D4E3F6",
  onDarkEyebrow: "#9CC3F0",
  icon: "#3673C2",
  shadow: "#0B2A55"
};

export const palette = (name) => hex(colors[name]);
export const rgbOf = hex;

/**
 * Fontes padrão do PDF (sem dependência extra). `spacing` = espaçamento entre letras (pt); o gerador limita a 8% do
 * tamanho — acima disso alguns leitores extraem o texto como "M A T H E U S" (busca/cópia quebradas).
 * Troca por fonte própria exigiria `@pdf-lib/fontkit`. */
export const typography = {
  eyebrow: { size: 7.8, spacing: 0.6 },
  heroName: { size: 27, max: 27, min: 17, leading: 1.12, maxLines: 3 },
  heroProject: { size: 14, leading: 1.2 },
  heroBuilder: { size: 11 },
  heroZone: { size: 10.5 },
  headerBrand: { size: 12.5, spacing: 1.0 },
  headerRole: { size: 7.2, spacing: 0.55 },
  headerDoc: { size: 7.6, spacing: 0.6 },
  headerDate: { size: 8.4 },
  cardLabel: { size: 7.8, spacing: 0.55 },
  cardValue: { size: 15.5, min: 10.5 },
  cardValueFirst: { size: 17, min: 11 },
  cardNote: { size: 8.4, leading: 10.2 },
  blockTitle: { size: 8.6, spacing: 0.68 },
  continued: { size: 8.4 },
  row: { size: 10.5, rowHeight: 22 },
  rowValue: { size: 10.5 },
  bigValue: { size: 15, min: 11 },
  bigLabel: { size: 10 },
  bigNote: { size: 9 },
  total: { size: 10.5 },
  list: { size: 10.5, leading: 13 },
  footerNote: { size: 8 },
  footerLink: { size: 8.6 },
  pageNumber: { size: 8.2 }
};

export const layout = {
  /** Margem lateral dos cartões (borda do conteúdo). */
  margin: 30,
  bottom: 82,
  footerTop: 782,
  hero: {
    /** Altura mínima da área azul/hero na página 1. */
    minHeight: 266,
    paddingBottom: 22,
    logoTop: 18,
    logoHeight: 30,
    wordmarkGap: 7,
    textTop: 100,
    textColumn: 0.66,
    /** Sem foto, o texto ocupa mais largura. */
    textColumnNoPhoto: 0.7,
    photoLeft: 0.4
  },
  continuationHeight: 118,
  continuationLogoTop: 14,
  continuationLogoHeight: 24,
  gap: 14,
  cards: { top: 10, height: 100, gap: 8, padding: 10, radius: 11, iconSize: 15 },
  block: { padding: 14, radius: 11, titleGap: 9, ruleWidth: 26, minTwoColumnList: 6 },
  /** Com mais vantagens que isto, "Descontos" e "Vantagens" empilham (largura total, vantagens em 2 colunas). */
  stackAbove: 8,
  /** Lado a lado, os cartões só têm a mesma altura se a menor for ao menos esta fração da maior. */
  equalHeightRatio: 0.6,
  /** Proporção da largura entre "Descontos e benefícios" e "Vantagens". */
  benefitsShare: 0.56
};

/** Sombra do cartão feita em vetor: camadas concêntricas de baixa opacidade (sem rasterizar). */
export const shadow = {
  layers: 6,
  spread: 6,
  offsetY: 2.6,
  peakOpacity: 0.075
};

export const watermark = {
  /** Cor da silhueta (o símbolo oficial tem uma parte quase branca que sumiria no fundo claro). */
  color: "#3673C2",
  /** Sem foto no hero: símbolo discreto no lado direito, claro sobre o azul. */
  hero: { color: "#FFFFFF", opacity: 0.075, width: 128 },
  /** Símbolo oficial como marca d'água editorial no canto inferior direito. */
  opacity: 0.07,
  width: 250,
  /** Quanto do símbolo sai da página (frações da largura/altura do símbolo). */
  bleedX: 0.1,
  bleedY: 0.0
};

/** Páginas curtas respiram: se sobrar muito espaço, os espaçamentos crescem de forma proporcional. */
export const balance = { minLeftover: 120, keep: 40, weight: 4.5, maxSpread: 26 };

export const photo = {
  /** Máscara de transição: fração da foto que desvanece à esquerda e embaixo. */
  fadeLeft: 0.5,
  fadeBottom: 0.45,
  /** Véu azul-marinho sobre a foto (legibilidade do texto e unidade com a marca). */
  tint: { color: "#031D3A", opacity: 0.2 },
  /** Escurecimento extra no topo da foto (onde ficam logo/data), em fração da altura da caixa. */
  topScrim: { opacity: 0.85, height: 0.4 },
  maxBytes: 4_000_000
};

export const links = {
  site: { text: "www.matheusmachadoimoveis.com.br", url: "https://www.matheusmachadoimoveis.com.br" },
  instagram: { text: "@mhm.machado", url: "https://www.instagram.com/mhm.machado/" }
};

export const copy = {
  disclaimer: "Simulação estimada. Os valores finais dependem da análise de crédito do banco e da confirmação da incorporadora.",
  city: "Marília/SP"
};
