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
