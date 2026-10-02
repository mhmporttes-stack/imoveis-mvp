export function normalizeFinancialNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "").trim().replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function roundFinancial(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((normalizeFinancialNumber(value) + Number.EPSILON) * factor) / factor;
}

// ---------- Nota fiscal por venda ----------
// A nota é uma DESPESA VARIÁVEL da venda: percentual PRÓPRIO de cada venda (financial_sales.invoice_percentage),
// aplicado sobre a COMISSÃO BRUTA (base atual da regra — nunca sobre o VGV) e deduzido ANTES da divisão
// gestor/corretor/imobiliária (uma única vez). Não existe percentual global.
// LEGACY: vendas anteriores à coluna só tinham o interruptor invoice_issued, que aplicava 15% — a migration
// converte (com nota → 15, sem nota → 0) e este fallback faz o mesmo se a coluna ainda não existir.
export const LEGACY_INVOICE_PERCENTAGE = 15;

export function resolveInvoicePercentage({ invoicePercentage, invoiceIssued } = {}) {
  // undefined/null = valor ausente (legado); "" (campo limpo na tela) = 0%
  if (invoicePercentage !== undefined && invoicePercentage !== null) {
    const n = normalizeFinancialNumber(invoicePercentage);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, roundFinancial(n, 4))) : 0;
  }
  return invoiceIssued ? LEGACY_INVOICE_PERCENTAGE : 0;
}

// Valida a entrada do usuário (0–100). Lança erro em português.
export function parseInvoicePercentage(value) {
  const text = String(value ?? "").trim().replace("%", "");
  if (text === "") return 0;
  if (!/\d/.test(text)) throw new Error("Informe um percentual de nota fiscal entre 0% e 100%.");
  const n = normalizeFinancialNumber(text);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error("Informe um percentual de nota fiscal entre 0% e 100%.");
  return roundFinancial(n, 4);
}

export function calculateInvoiceDeduction(grossCommission, invoicePercentage) {
  const grossCents = toCents(grossCommission);
  const pct = resolveInvoicePercentage({ invoicePercentage });
  return fromCents(Math.round((grossCents * pct) / 100));
}

// Comissão bruta → nota → despesas da venda → comissão livre (base da distribuição).
export function calculateSaleBase({ grossCommission = 0, invoicePercentage = 0, expenseTotal = 0 } = {}) {
  const invoiceDeduction = calculateInvoiceDeduction(grossCommission, invoicePercentage);
  const freeCents = Math.max(0, toCents(grossCommission) - toCents(invoiceDeduction) - toCents(expenseTotal));
  return { invoiceDeduction, freeCommission: fromCents(freeCents) };
}

export function calculateCommissionDistribution({
  freeCommission = 0,
  hasManagerCommission = false,
  managerPercentage = 0,
  brokerPercentage = 50,
  agencyPercentage = 50
} = {}) {
  const freeCents = toCents(freeCommission);
  const managerPercent = hasManagerCommission ? validPercentage(managerPercentage, "gestor") : 0;
  const brokerPercent = validPercentage(brokerPercentage, "corretor");
  const agencyPercent = validPercentage(agencyPercentage, "imobiliária");

  if (roundFinancial(brokerPercent + agencyPercent, 4) !== 100) {
    throw new Error("Os percentuais do corretor e da imobiliária devem totalizar 100%.");
  }
  if (hasManagerCommission && managerPercent <= 0) throw new Error("Informe um percentual de gestor maior que 0%.");

  const managerCents = hasManagerCommission ? Math.round(freeCents * managerPercent / 100) : 0;
  const distributionCents = freeCents - managerCents;
  const brokerCents = Math.round(distributionCents * brokerPercent / 100);
  const agencyCents = distributionCents - brokerCents;

  return {
    freeCommission: fromCents(freeCents),
    hasManagerCommission: Boolean(hasManagerCommission),
    managerPercentage: managerPercent,
    managerCommission: fromCents(managerCents),
    distributionBase: fromCents(distributionCents),
    brokerPercentage: brokerPercent,
    brokerCommission: fromCents(brokerCents),
    agencyPercentage: agencyPercent,
    agencyCommission: fromCents(agencyCents)
  };
}

function validPercentage(value, label) {
  const percentage = roundFinancial(value, 4);
  if (percentage < 0 || percentage > 100) throw new Error(`Percentual de ${label} inválido.`);
  return percentage;
}

function toCents(value) {
  const amount = normalizeFinancialNumber(value);
  if (amount < 0) throw new Error("Valores financeiros não podem ser negativos.");
  return Math.round(amount * 100);
}

function fromCents(value) {
  return value / 100;
}
