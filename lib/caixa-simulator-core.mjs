// "Simulador Caixa" do painel (pedido do dono, 2026-10-19): simulação rápida, sem cliente e sem lead, com o MESMO motor
// da simulação automática (lib/financiamento-estimativa-core.mjs). Marília/SP fixo. Puro e testado.
import { estimateFinancing } from "./financiamento-estimativa-core.mjs";

export const INCOME_TYPES = ["registered_employment", "income_tax_declarant", "self_employed_unregistered"];

export const NOT_ELIGIBLE_TEXT = {
  has_property: "Quem já tem imóvel no nome não entra no Minha Casa Minha Vida.",
  income: "Informe a renda (a partir de R$ 1.000).",
  income_above_program: "Renda acima de R$ 13.000: fora do Minha Casa Minha Vida.",
  birth_date: "Informe a data de nascimento do mais velho.",
  age: "Pela idade do mais velho não sobra prazo mínimo de financiamento (60 meses)."
};

/** Reais a partir do texto do campo ("R$ 2.400" → 2400; vazio → 0). */
export function moneyFromInput(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

const yesNo = (value) => value === true || value === "true";

/**
 * Respostas do formulário → entrada do motor (mesmo formato do cadastro). `firstProperty` true = NÃO tem imóvel.
 * Entrada + FGTS disponíveis somam o recurso do cliente (só exibido; o motor não depende dele para a renda).
 */
export function simulatorInput(answers = {}) {
  const joint = answers.joint === true || answers.joint === "true";
  const type = (value) => (INCOME_TYPES.includes(value) ? value : "self_employed_unregistered");
  const birth = /^\d{4}-\d{2}-\d{2}$/.test(String(answers.oldestBirthDate || "")) ? answers.oldestBirthDate : "";
  return {
    simulationType: joint ? "joint" : "individual",
    primaryIncomeType: type(answers.primaryIncomeType),
    primaryMonthlyIncome: moneyFromInput(answers.primaryMonthlyIncome),
    secondaryIncomeType: joint ? type(answers.secondaryIncomeType) : null,
    secondaryMonthlyIncome: joint ? moneyFromInput(answers.secondaryMonthlyIncome) : null,
    oldestBirthDate: birth,
    hasOverThreeYearsRegisteredWork: yesNo(answers.fgtsThreeYears),
    hasChildrenUnder18: yesNo(answers.dependents),
    hasResidentialProperty: !yesNo(answers.firstProperty),
    availablePurchaseResource: moneyFromInput(answers.downPayment) + moneyFromInput(answers.fgtsAvailable),
    downPayment: moneyFromInput(answers.downPayment),
    fgtsAvailable: moneyFromInput(answers.fgtsAvailable)
  };
}

/** Resultado do simulador (o mesmo do motor) ou { eligible:false, message }. */
export function simulate(answers = {}, referenceDate) {
  const input = simulatorInput(answers);
  const estimate = estimateFinancing(input, referenceDate);
  if (!estimate.eligible) return { eligible: false, reason: estimate.reason, message: NOT_ELIGIBLE_TEXT[estimate.reason] || "Não foi possível simular com estes dados." };
  return estimate;
}

/** Valores da Caixa (opcionais, no 👎) → números ou null. */
export function caixaValuesFromInput(values = {}) {
  const pick = (key) => {
    const value = moneyFromInput(values?.[key]);
    return value > 0 ? value : null;
  };
  const result = { income: pick("income"), financing: pick("financing"), subsidy: pick("subsidy"), firstInstallment: null };
  // 1ª parcela tem centavos: aceita "632,97" / "632.97".
  const raw = String(values?.firstInstallment ?? "").trim();
  if (raw) {
    const parsed = Number(raw.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    result.firstInstallment = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
  }
  return Object.values(result).some((value) => value !== null) ? result : null;
}

/** Voto válido: "up" (bateu com a Caixa) | "down" (não bateu). */
export function parseVote(value) {
  return value === "up" || value === "down" ? value : null;
}
