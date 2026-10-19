// Conferência da simulação automática do site pelo corretor (pedido do dono, 2026-10-19 — SIM-AUTO, "botões
// TEMPORÁRIOS"): depois de refazer no simulador da Caixa, o corretor marca "Simulação OK" ou "Corrigir simulação".
// Tudo vai para `simulation_auto_reviews` (análise diária de aprendizado; SQL em docs/analytics/). Puro e testado.

// Liga/desliga os botões (tela e API). TEMPORÁRIO: mude para false para desligar.
export const AUTO_SIMULATION_REVIEW_ENABLED = true;

export const AUTO_REVIEW_STATUS = { PENDING: "pending", CORRECTING: "correcting", OK: "ok", CORRECTED: "corrected" };

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** Retrato do que o site calculou: entradas usadas + saídas (novo e usado). Nunca é sobrescrito depois de conferido. */
export function buildAutoSnapshot(registration = {}, estimate = {}, referenceDate = "") {
  return {
    version: estimate.version || "",
    referenceDate,
    inputs: {
      primaryIncomeDeclared: money(registration.primaryMonthlyIncome),
      secondaryIncomeDeclared: money(registration.secondaryMonthlyIncome),
      primaryIncomeType: registration.primaryIncomeType || "",
      secondaryIncomeType: registration.secondaryIncomeType || "",
      primaryIncomeConsidered: money(estimate.primaryIncomeConsidered),
      secondaryIncomeConsidered: money(estimate.secondaryIncomeConsidered),
      incomeConsidered: money(estimate.income),
      incomeRule: estimate.incomeRule || "",
      oldestBirthDate: registration.oldestBirthDate || "",
      hasChildrenUnder18: registration.hasChildrenUnder18 === true,
      hasOverThreeYearsRegisteredWork: registration.hasOverThreeYearsRegisteredWork === true,
      availablePurchaseResource: money(registration.availablePurchaseResource)
    },
    outputs: {
      faixa: estimate.faixa || "",
      annualRate: Number(estimate.annualRate) || 0,
      termMonths: Number(estimate.termMonths) || 0,
      financing: money(estimate.financing),
      priceFirstInstallment: money(estimate.priceFirstInstallment),
      priceLastInstallment: money(estimate.priceLastInstallment),
      sacFirstInstallment: money(estimate.sacFirstInstallment),
      sacLastInstallment: money(estimate.sacLastInstallment),
      novo: { subsidy: money(estimate.subsidy), downPayment: money(estimate.downPayment), purchasePower: money(estimate.purchasePower) },
      usado: { subsidy: money(estimate.used?.subsidy), downPayment: money(estimate.used?.downPayment), purchasePower: money(estimate.used?.purchasePower) }
    }
  };
}

function parseMoney(value) {
  if (typeof value === "number") return money(value);
  const normalized = String(value || "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return money(normalized);
}

function modelValues(model = {}) {
  return {
    financing: parseMoney(model.financingValue),
    subsidy: parseMoney(model.subsidyValue),
    firstInstallment: parseMoney(model.firstInstallment),
    lastInstallment: parseMoney(model.lastInstallment),
    termMonths: Number(String(model.termMonths || "").replace(/\D/g, "")) || 0
  };
}

/** Valores que o corretor lançou da Caixa (simulação salva no Gerador), por tipo de imóvel e sistema. */
export function buildCorrectedSnapshot(simulation = {}, { caixaIncome = null } = {}) {
  const models = simulation.simulationModels || {};
  const build = (key) => ({ price: modelValues(models[key]), sac: modelValues(models[key]?.sac) });
  return {
    caixaIncome: caixaIncome === null || caixaIncome === undefined ? null : money(caixaIncome),
    annualRate: Number(simulation.interestRateAnnual) || 0,
    novo: build("novo"),
    usado: build("usado")
  };
}

/** Renda digitada na janela "Corrigir simulação" (R$ 1.000 a R$ 100.000) ou null. */
export function parseCaixaIncome(raw) {
  const value = typeof raw === "number" ? raw : parseMoney(raw);
  return value >= 1000 && value <= 100000 ? money(value) : null;
}
