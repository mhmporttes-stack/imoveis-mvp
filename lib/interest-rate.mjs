// Taxa de juros ANUAL da simulação (campo OPCIONAL do CRM: public.simulations.interest_rate_annual numeric(5,2)).
// PURO (sem servidor): usado pelo formulário do CRM, pelo mapper/gravação e pela apresentação interativa.
// A taxa NÃO entra no PDF da simulação (REGRA PRES-10: só a apresentação interativa e as imagens dela).

export const INTEREST_RATE_MIN = 0;
export const INTEREST_RATE_MAX = 30;
export const INTEREST_RATE_ERROR = "Taxa de juros inválida. Informe um valor de 0 a 30, com até 2 casas decimais (ex.: 5,4).";

/**
 * Lê o que o usuário digitou. Aceita vírgula ou ponto, até 2 casas, 0 a 30. Vazio = sem taxa (valor null, válido).
 * @returns {{ok: true, value: number|null} | {ok: false, error: string}}
 */
export function parseInterestRateInput(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { ok: false, error: INTEREST_RATE_ERROR };
    return Math.abs(raw * 100 - Math.round(raw * 100)) < 1e-6 ? validateNumber(raw) : { ok: false, error: INTEREST_RATE_ERROR };
  }
  const text = String(raw).trim();
  if (text === "") return { ok: true, value: null };
  if (!/^\d{1,2}(?:[.,]\d{1,2})?$/.test(text)) return { ok: false, error: INTEREST_RATE_ERROR };
  return validateNumber(Number(text.replace(",", ".")));
}

function validateNumber(number) {
  if (!Number.isFinite(number) || number < INTEREST_RATE_MIN || number > INTEREST_RATE_MAX) {
    return { ok: false, error: INTEREST_RATE_ERROR };
  }
  // Até 2 casas (numeric(5,2)); arredonda só o ruído de ponto flutuante.
  return { ok: true, value: Math.round(number * 100) / 100 };
}

/** Número → texto do campo ("5,4"). null/inválido → "". */
export function formatInterestRateInput(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return String(Math.round(number * 100) / 100).replace(".", ",");
}

/** Taxa a mostrar ao cliente: só quando for maior que zero ("5,4% ao ano"); caso contrário "". */
export function formatInterestRateLabel(value) {
  const number = value === null || value === undefined || value === "" ? NaN : Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return `${formatInterestRateInput(number)}% ao ano`;
}

/** Valor numérico válido (> 0) lido de um dado já gravado; senão null. Nunca lança. */
export function readStoredInterestRate(value) {
  const parsed = parseInterestRateInput(value === null || value === undefined ? null : typeof value === "number" ? value : String(value));
  return parsed.ok && parsed.value !== null && parsed.value > 0 ? parsed.value : null;
}

export const INTEREST_COLUMN_MISSING_WARNING =
  "A taxa de juros não foi salva porque o recurso ainda não está ativado no banco. Os demais valores da simulação foram salvos normalmente.";

/** Erro de "coluna interest_rate_annual inexistente" (migration ainda não aplicada): Postgres 42703 ou PostgREST PGRST204. */
export function isInterestColumnMissingError(error) {
  if (!error) return false;
  const message = String(error.message || "").toLowerCase();
  if (!message.includes("interest_rate_annual")) return false;
  const code = String(error.code || "");
  return code === "42703" || code === "PGRST204" || message.includes("does not exist") || message.includes("schema cache");
}
