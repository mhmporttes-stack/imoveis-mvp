// Imagens PNG da apresentação (resumo da simulação e lista de documentos) — regras PURAS (sem next/og, sem servidor).
// Os dados vêm SEMPRE do DTO público da apresentação (allowlist): nada além dele entra na imagem.
import { formatBRL } from "./simulation-presentation-format.mjs";
import { formatInterestRateLabel } from "./interest-rate.mjs";

// 1080x1920 (9:16): vertical, pronto para celular/WhatsApp. O visual segue o PDF da simulação (degradê azul, cartão branco
// com o poder de compra, bloco azul com as parcelas, faixa de rodapé), em formato de imagem.
export const SUMMARY_IMAGE_SIZE = { width: 1080, height: 1920 };
// Lista de documentos: largura fixa de 1080 px; a ALTURA acompanha a lista (termina logo após o último item, com margem
// elegante; sem faixa de rodapé). Proporção típica com 8 a 9 itens: perto de 2:3 (1080x1620).
export const DOCUMENTS_IMAGE_WIDTH = 1080;

// Medidas do layout da imagem de documentos (usadas pelo desenho e pelo cálculo da altura: uma só fonte).
export const DOCUMENTS_LAYOUT = {
  headerHeight: 410,
  padX: 64,
  padTop: 50,
  padBottom: 24,
  checkSize: 64,
  checkGap: 28,
  textOffset: 10, // o título alinha com o centro da caixa de marcar
  itemGap: 38,
  titleSize: 39,
  titleLine: 1.2,
  descSize: 29,
  descLine: 1.32,
  descGap: 8,
  bulletGap: 14,
  obsSize: 25,
  obsLine: 1.3,
  obsGap: 8,
  // largura média de uma letra MAIÚSCULA em relação ao corpo da fonte (Geist; medida na renderização, com pequena folga)
  titleFactor: 0.63,
  descFactor: 0.59
};

/** Quantas linhas um texto em maiúsculas ocupa numa largura (estimativa por palavras; nunca menos que 1). */
export function estimateLines(text, { size, width, factor = DOCUMENTS_LAYOUT.titleFactor }) {
  const perLine = Math.max(8, Math.floor(width / (size * factor)));
  let lines = 1;
  let used = 0;
  for (const word of String(text || "").split(/\s+/).filter(Boolean)) {
    const length = word.length;
    if (used === 0) used = length;
    else if (used + 1 + length <= perLine) used += 1 + length;
    else {
      lines += 1;
      used = length;
    }
  }
  return lines;
}

/** Largura do texto de um item (descontada a caixa de marcar). */
export function documentsTextWidth() {
  const l = DOCUMENTS_LAYOUT;
  return DOCUMENTS_IMAGE_WIDTH - l.padX * 2 - l.checkSize - l.checkGap;
}

/** Altura (px) de um item da lista na imagem. */
export function documentItemHeight(item) {
  const l = DOCUMENTS_LAYOUT;
  const width = documentsTextWidth();
  let height = l.textOffset + estimateLines(item.title, { size: l.titleSize, width, factor: l.titleFactor }) * l.titleSize * l.titleLine;
  if (item.description) height += l.descGap + estimateLines(item.description, { size: l.descSize, width, factor: l.descFactor }) * l.descSize * l.descLine;
  if (item.obs) height += l.obsGap + estimateLines(item.obs, { size: l.obsSize, width, factor: l.descFactor }) * l.obsSize * l.obsLine;
  for (const line of item.lines || []) {
    height += l.bulletGap + estimateLines(line, { size: l.descSize, width: width - 36, factor: l.descFactor }) * l.descSize * l.descLine;
  }
  // a caixa de marcar (maior que um título de uma linha) também ocupa altura
  return Math.ceil(Math.max(height, l.checkSize + 2));
}

/** Tamanho da imagem: cabeçalho + itens + margem inferior. Nunca menor que 1080x1350. */
export function documentsImageSize(items = []) {
  const l = DOCUMENTS_LAYOUT;
  const list = items.reduce((total, item) => total + documentItemHeight(item), 0) + Math.max(0, items.length - 1) * l.itemGap;
  const height = l.headerHeight + l.padTop + list + l.padBottom;
  return { width: DOCUMENTS_IMAGE_WIDTH, height: Math.max(1350, Math.ceil(height)) };
}

/** Itens FINAIS da lista (títulos e descrições já resolvidos no servidor) a partir do DTO público. */
export function getDocumentItems(dto) {
  return ((dto?.scenes || []).find((item) => item.id === "documentos")?.items || []).map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description || "",
    lines: item.lines || [],
    obs: item.obs || ""
  }));
}

/** "Mariana" → "simulacao-mariana.png" (sem acento/espaço; vazio → "cliente"). */
export function slugFirstName(firstName) {
  return String(firstName || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

export function summaryFileName(firstName) {
  return `simulacao-${slugFirstName(firstName) || "cliente"}.png`;
}

export function documentsFileName(firstName) {
  return `lista-de-documentos-${slugFirstName(firstName) || "cliente"}.png`;
}

/** Cabeçalhos da resposta de imagem: nunca em cache, nunca indexada; `attachment` só com ?baixar=1. */
export function imageResponseHeaders({ fileName, download }) {
  return {
    "Cache-Control": "no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Referrer-Policy": "no-referrer",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`
  };
}

export function wantsDownload(searchParams) {
  const value = searchParams?.get?.("baixar");
  return value === "1" || value === "true";
}

function scene(dto, id) {
  return (dto?.scenes || []).find((item) => item.id === id) || null;
}

/**
 * Tudo que a imagem-resumo mostra, já em texto. Mesmos números das cenas (que são os do PDF); a taxa de juros só
 * aparece se cadastrada. Sem diferença de subsídio, nenhuma palavra "novo"/"usado".
 */
export function buildSummaryImageModel(dto) {
  const opening = scene(dto, "abertura");
  const power = scene(dto, "poder");
  const formation = scene(dto, "formacao");
  const installments = scene(dto, "parcelas");
  const difference = scene(dto, "diferenca");
  const properties = (dto?.branch || []).map((item) => item.name).filter(Boolean);
  const next = scene(dto, "proximo");
  const firstName = opening?.firstName || next?.firstName || "";

  return {
    firstName,
    subtitle: firstName ? `Simulação de ${firstName}` : "",
    power: power ? { label: "PODER TOTAL DE COMPRA:", value: formatBRL(power.value) } : null,
    formation: formation
      ? {
          mode: formation.mode,
          caption: formation.mode === "soma" ? "Soma do financiamento + subsídio" : formation.mode === "subsidio" ? "Poder de compra vindo do subsídio" : "Poder de compra vindo do financiamento",
          financing: formatBRL(formation.financing),
          subsidy: formatBRL(formation.subsidy)
        }
      : null,
    installments: installments
      ? {
          first: installments.first > 0 ? formatBRL(installments.first) : "",
          last: installments.last > 0 ? formatBRL(installments.last) : "",
          interest: formatInterestRateLabel(installments.interestRate)
        }
      : null,
    // única diferença entre imóvel novo e usado: o subsídio (a cena só existe quando os valores são diferentes)
    difference: difference
      ? { novo: formatBRL(difference.novo), usado: formatBRL(difference.usado), difference: formatBRL(difference.difference) }
      : null,
    // imóveis sugeridos (ramo opcional da apresentação): rótulo no singular/plural e até 3 nomes
    propertyLabel: properties.length > 1 ? "IMÓVEIS SUGERIDOS" : properties.length === 1 ? "IMÓVEL SUGERIDO" : "",
    propertyNames: properties.slice(0, 3),
    propertyMore: Math.max(0, properties.length - 3),
    dateLabel: next?.dateLabel || ""
  };
}
