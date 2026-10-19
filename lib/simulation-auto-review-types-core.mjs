// Conferência POR TIPO de imóvel da simulação automática (REGRA OFICIAL — dono, 2026-10-19; substitui o bloco amarelo
// "Simulação OK / Corrigir simulação"): 👍 (bateu) e 👎 (corrigir) logo abaixo do imóvel NOVO e do USADO, só para os
// tipos marcados (com valores). O link/imagem só libera quando TODOS os tipos marcados estiverem conferidos (👍 ou
// correção salva) — a conferência obrigatória continua. Puro e testado (tests/simulation-auto-review-types.test.mjs).
// Gravação: `simulation_auto_reviews.corrected_snapshot.typeReviews` (sem coluna nova) — enquanto a conferência está
// aberta guarda só as marcas; ao fechar, os valores da Caixa (buildCorrectedSnapshot) + as marcas por tipo.
import { modelValues, parseCaixaIncome, parseMoney } from "./simulation-auto-review-core.mjs";

export const REVIEW_TYPES = ["novo", "usado"];
export const TYPE_REVIEW_STATUS = { OK: "ok", CORRECTED: "corrected" };

const hasValues = (model = {}) => {
  const price = modelValues(model);
  const sac = modelValues(model?.sac);
  return [price, sac].some((values) => values.financing > 0 || values.subsidy > 0 || values.firstInstallment > 0 || values.lastInstallment > 0);
};

/** Tipos marcados na simulação (com algum valor), na ordem novo → usado. */
export function markedTypes(models = {}) {
  return REVIEW_TYPES.filter((type) => hasValues(models?.[type]));
}

export function isReviewType(type) {
  return REVIEW_TYPES.includes(type);
}

/** Marcas por tipo gravadas na conferência aberta (`corrected_snapshot.typeReviews`). */
export function typeReviewsFromRow(row = null) {
  const stored = row?.corrected_snapshot?.typeReviews;
  if (!stored || typeof stored !== "object") return {};
  return Object.fromEntries(REVIEW_TYPES.filter((type) => stored[type]?.status).map((type) => [type, stored[type]]));
}

export function withTypeMark(typeReviews = {}, type, mark) {
  return { ...typeReviews, [type]: mark };
}

/** Tipos marcados ainda sem 👍 nem correção salva. */
export function pendingTypes(models = {}, typeReviews = {}) {
  return markedTypes(models).filter((type) => !typeReviews?.[type]?.status);
}

/** Status final da conferência: alguma correção → "corrected"; só 👍 → "ok". */
export function finalReviewStatus(typeReviews = {}) {
  return Object.values(typeReviews).some((mark) => mark?.status === TYPE_REVIEW_STATUS.CORRECTED) ? "corrected" : "ok";
}

/** Renda da Caixa para a coluna `caixa_income`: a do NOVO corrigido, senão a do usado. */
export function caixaIncomeFromTypeReviews(typeReviews = {}) {
  for (const type of REVIEW_TYPES) {
    const mark = typeReviews?.[type];
    if (mark?.status === TYPE_REVIEW_STATUS.CORRECTED && Number(mark.caixaIncome) > 0) return Number(mark.caixaIncome);
  }
  return null;
}

const formatMoney = (value) => `R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Correção (👎) de UM tipo: renda usada na Caixa + valores Price da Caixa. Devolve { error } ou { caixaIncome, values }
 * com os valores já no formato do Gerador ("R$ 1.234,56"; prazo só dígitos).
 */
export function parseTypeCorrection(input = {}) {
  const caixaIncome = parseCaixaIncome(input.caixaIncome);
  if (caixaIncome === null) return { error: "Informe a renda usada no simulador da Caixa (ex.: 2.550,00)." };
  const financing = parseMoney(input.financingValue);
  const first = parseMoney(input.firstInstallment);
  if (!(financing > 0)) return { error: "Informe o valor financiado pela Caixa." };
  if (!(first > 0)) return { error: "Informe a 1ª parcela da Caixa." };
  const subsidy = parseMoney(input.subsidyValue);
  const last = parseMoney(input.lastInstallment);
  const termMonths = String(input.termMonths ?? "").replace(/\D/g, "").replace(/^0+/, "").slice(0, 3);
  if (!termMonths) return { error: "Informe o prazo (meses) da Caixa." };
  return {
    caixaIncome,
    values: {
      financingValue: formatMoney(financing),
      subsidyValue: subsidy > 0 ? formatMoney(subsidy) : "",
      firstInstallment: formatMoney(first),
      lastInstallment: last > 0 ? formatMoney(last) : "",
      termMonths
    }
  };
}

/** Modelos com os valores corrigidos de UM tipo (só o Price; o SAC e o valor do imóvel do tipo são mantidos). */
export function modelsWithCorrection(models = {}, type, values = {}) {
  const current = models?.[type] || {};
  return { ...models, [type]: { ...current, ...values } };
}
