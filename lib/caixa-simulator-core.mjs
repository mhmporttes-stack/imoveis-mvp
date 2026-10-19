// "Simulador Caixa" do painel (pedido do dono, 2026-10-19): simulação rápida, sem cliente e sem lead, com o MESMO motor
// da simulação automática (lib/financiamento-estimativa-core.mjs). Marília/SP fixo. Puro e testado.
import { estimateFinancing } from "./financiamento-estimativa-core.mjs";

// Renda (dono, 2026-10-19): sem "Regime". O corretor decide a renda pelo tato, conversando com o cliente, e o simulador
// usa a RENDA DIGITADA exatamente — sem teto de informal e sem otimização/renda sugerida, como renda fixa. Para isso a
// entrada vai ao motor como renda registrada (regra "declared"); `incomeSource` registra a origem no voto.
export const BROKER_INCOME_SOURCE = "informada_pelo_corretor";
const FIXED_INCOME_TYPE = "registered_employment";

export const NOT_ELIGIBLE_TEXT = {
  has_property: "Quem já tem imóvel no nome não entra no Minha Casa Minha Vida.",
  income: "Informe a renda (a partir de R$ 1.000).",
  income_above_program: "Renda acima de R$ 13.000: fora do Minha Casa Minha Vida.",
  birth_date: "Informe a data de nascimento do mais velho.",
  age: "Pela idade do mais velho não sobra prazo mínimo de financiamento (60 meses).",
  property_above_cap: "Valor do imóvel acima do teto da faixa desta renda: fora do Minha Casa Minha Vida."
};

const brl = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

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
  const birth = /^\d{4}-\d{2}-\d{2}$/.test(String(answers.oldestBirthDate || "")) ? answers.oldestBirthDate : "";
  return {
    simulationType: joint ? "joint" : "individual",
    incomeSource: BROKER_INCOME_SOURCE,
    primaryIncomeType: FIXED_INCOME_TYPE,
    primaryMonthlyIncome: moneyFromInput(answers.primaryMonthlyIncome),
    secondaryIncomeType: joint ? FIXED_INCOME_TYPE : null,
    secondaryMonthlyIncome: joint ? moneyFromInput(answers.secondaryMonthlyIncome) : null,
    oldestBirthDate: birth,
    hasOverThreeYearsRegisteredWork: yesNo(answers.fgtsThreeYears),
    hasChildrenUnder18: yesNo(answers.dependents),
    hasResidentialProperty: !yesNo(answers.firstProperty),
    // Valor do imóvel (dono, 2026-10-19): vazio = automático (teto da faixa da renda); digitado = respeitado pelo motor.
    propertyValue: moneyFromInput(answers.propertyValue) || null,
    availablePurchaseResource: moneyFromInput(answers.downPayment) + moneyFromInput(answers.fgtsAvailable),
    downPayment: moneyFromInput(answers.downPayment),
    fgtsAvailable: moneyFromInput(answers.fgtsAvailable)
  };
}

/** Entradas gravadas no voto: sem os regimes (que só existem para o motor tratar a renda como fixa). */
export function feedbackInputs(answers = {}) {
  const { primaryIncomeType, secondaryIncomeType, ...inputs } = simulatorInput(answers);
  return inputs;
}

/** Resultado do simulador (o mesmo do motor) ou { eligible:false, message }. */
export function simulate(answers = {}, referenceDate) {
  const input = simulatorInput(answers);
  const estimate = estimateFinancing(input, referenceDate);
  if (!estimate.eligible) {
    const message = estimate.reason === "property_above_cap"
      ? `Valor do imóvel acima do teto da ${estimate.faixa} (${brl(estimate.propertyCap)}) para esta renda: fora do Minha Casa Minha Vida.`
      : NOT_ELIGIBLE_TEXT[estimate.reason] || "Não foi possível simular com estes dados.";
    return { eligible: false, reason: estimate.reason, faixa: estimate.faixa, propertyCap: estimate.propertyCap, message };
  }
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
