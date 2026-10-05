// Imagens PNG da apresentação (resumo da simulação e lista de documentos) — regras PURAS (sem next/og, sem servidor).
// Os dados vêm SEMPRE do DTO público da apresentação (allowlist): nada além dele entra na imagem.
import { formatBRL } from "./simulation-presentation-format.mjs";
import { formatInterestRateLabel } from "./interest-rate.mjs";

// 1080x1920 (9:16): vertical, pronto para celular/WhatsApp. O visual segue o PDF da simulação (degradê azul, cartão branco
// com o poder de compra, bloco azul com as parcelas, faixa de rodapé), em formato de imagem.
export const SUMMARY_IMAGE_SIZE = { width: 1080, height: 1920 };
export const DOCUMENTS_IMAGE_SIZE = { width: 1080, height: 1920 };

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
  const property = scene(dto, "imovel");
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
    propertyName: property?.name || "",
    dateLabel: next?.dateLabel || ""
  };
}
