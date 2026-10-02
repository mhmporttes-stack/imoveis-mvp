import { calculateFamilyIncome, parseCurrencyNumber } from "@/lib/simulation-registration-format";
import { getRenderableSimulationModels, normalizeSimulationModels } from "@/lib/simulation-models";
import { montarClienteEntrada } from "./presentation-model.mjs";

/**
 * Monta o `cliente` enviado ao motor a partir de uma simulação salva.
 * Usado pela tela de apresentação e pela rota do PDF "Proposta de Valores" (mesma fonte).
 */
export function clienteEntradaFromSimulation(simulation) {
  const models = normalizeSimulationModels(simulation.simulationModels, simulation);
  const totals = getRenderableSimulationModels({ ...simulation, simulationModels: models })[0]?.totals || {};
  return montarClienteEntrada({
    rendaTotal: calculateFamilyIncome(simulation.registration || {}),
    financiamentoAprovado: totals.financing,
    subsidioMcmv: totals.subsidy,
    parcelaFinanciamento: parseCurrencyNumber(simulation.firstInstallment),
    fgtsDisponivel: parseCurrencyNumber(simulation.downPaymentValue) + parseCurrencyNumber(simulation.fgtsValue),
    temDependente: simulation.registration?.hasChildrenUnder18,
    fgtsMaisDe3Anos: simulation.registration?.hasOverThreeYearsRegisteredWork,
    tipoRenda: simulation.registration?.primaryIncomeType || ""
  });
}

export function parcelasFinanciamentoFromSimulation(simulation) {
  const models = normalizeSimulationModels(simulation.simulationModels, simulation);
  const primary = getRenderableSimulationModels({ ...simulation, simulationModels: models })[0]?.values || {};
  return {
    first: parseCurrencyNumber(primary.firstInstallment || simulation.firstInstallment),
    last: parseCurrencyNumber(primary.lastInstallment || simulation.lastInstallment)
  };
}
