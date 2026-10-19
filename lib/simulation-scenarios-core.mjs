// "Comparar simulações" (pedido do dono, 2026-10-19 — SIM-AUTO): cenários de simulação do cliente lado a lado. Puro.
import { modelValues } from "./simulation-auto-review-core.mjs";

export const SCENARIO_ORIGIN_LABELS = {
  site: "Automática (site)",
  refazer: "Automática (refazer)",
  corretor: "Corretor",
  correcao_caixa: "Corrigida pela Caixa",
  atual: "Simulação atual"
};

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

function typeValues(model = {}) {
  const price = modelValues(model);
  const sac = modelValues(model?.sac);
  return { price, sac, power: round2(price.financing + price.subsidy) || round2(sac.financing + sac.subsidy) };
}

/**
 * Dados de um cenário a partir da simulação gravada (formato do Gerador) + entradas do cadastro. `estimate` (opcional, só
 * nas automáticas) traz a renda usada no novo e no usado; `caixaIncome` (correção) a renda digitada da Caixa.
 */
export function scenarioDataFromSimulation(simulation = {}, { registration = {}, estimate = null, caixaIncome = null } = {}) {
  const models = simulation.simulationModels || {};
  return {
    inputs: {
      primaryIncomeDeclared: round2(registration.primaryMonthlyIncome),
      secondaryIncomeDeclared: round2(registration.secondaryMonthlyIncome),
      primaryIncomeType: registration.primaryIncomeType || "",
      secondaryIncomeType: registration.secondaryIncomeType || "",
      oldestBirthDate: registration.oldestBirthDate || "",
      hasChildrenUnder18: registration.hasChildrenUnder18 === true,
      hasOverThreeYearsRegisteredWork: registration.hasOverThreeYearsRegisteredWork === true,
      incomeNovo: estimate ? round2(estimate.income) : caixaIncome !== null && caixaIncome !== undefined ? round2(caixaIncome) : null,
      incomeUsado: estimate ? round2(estimate.used?.income ?? estimate.income) : caixaIncome !== null && caixaIncome !== undefined ? round2(caixaIncome) : null
    },
    annualRate: Number(simulation.interestRateAnnual) || 0,
    novo: typeValues(models.novo),
    usado: typeValues(models.usado)
  };
}

/** Chave dos VALORES (sem datas/autor): dois cenários com a mesma chave são o mesmo cenário. */
export function scenarioValuesKey(data = {}) {
  const pick = (type) => ({ price: data[type]?.price || {}, sac: data[type]?.sac || {} });
  return JSON.stringify({ rate: Number(data.annualRate) || 0, novo: pick("novo"), usado: pick("usado") });
}

/** Maior poder de compra e menor 1ª parcela (Price), por tipo de imóvel, entre os cenários com valor. */
export function scenarioHighlights(scenarios = []) {
  const result = {};
  for (const type of ["novo", "usado"]) {
    const filled = scenarios.filter((item) => item?.data?.[type]?.power > 0);
    const bestPower = filled.reduce((best, item) => (!best || item.data[type].power > best.data[type].power ? item : best), null);
    const withInstallment = filled.filter((item) => item.data[type].price.firstInstallment > 0);
    const lowest = withInstallment.reduce((best, item) => (!best || item.data[type].price.firstInstallment < best.data[type].price.firstInstallment ? item : best), null);
    result[type] = { bestPowerId: bestPower?.id || null, lowestInstallmentId: lowest?.id || null };
  }
  return result;
}

/** Diferença de poder de compra e 1ª parcela (Price) em relação à simulação atual, por tipo. */
export function scenarioDiff(data = {}, current = {}) {
  const diff = {};
  for (const type of ["novo", "usado"]) {
    diff[type] = {
      power: round2((data[type]?.power || 0) - (current[type]?.power || 0)),
      firstInstallment: round2((data[type]?.price?.firstInstallment || 0) - (current[type]?.price?.firstInstallment || 0))
    };
  }
  return diff;
}

/** Valores do cenário no formato do Gerador (strings "R$ 1.234,56"), para virar a simulação atual. */
export function scenarioModelsForForm(data = {}) {
  const money = (value) => (Number(value) > 0 ? `R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "");
  const system = (values = {}) => ({
    financingValue: money(values.financing),
    subsidyValue: money(values.subsidy),
    firstInstallment: money(values.firstInstallment),
    lastInstallment: money(values.lastInstallment),
    termMonths: values.termMonths ? String(values.termMonths) : ""
  });
  const type = (key) => ({ ...system(data[key]?.price), sac: system(data[key]?.sac) });
  return { novo: type("novo"), usado: type("usado") };
}
