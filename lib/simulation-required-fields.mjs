// Campos obrigatórios do Gerador de simulação (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-18, PRES-24 / SIM-REQ):
// "PRAZO (meses) e TAXA DE JUROS passam a ser obrigatórios ao salvar". PURO: usado pela tela (SimulationGenerator) e pelo
// servidor (lib/simulations.js), para as duas checarem a MESMA regra.
//  - Só vale quando a simulação tem valores (rascunho vazio — criado pela lista de clientes ou pelo cadastro do site — passa).
//  - Prazo: do modelo DESTACADO (o primeiro preenchido: o que a apresentação e a Estratégia com amortização usam). O Gerador
//    copia financiamento e parcelas de um tipo para o outro, mas não o prazo; exigir o prazo de todos obrigaria a digitar o
//    prazo de um tipo que o corretor nem usou.
//  - Taxa: a da simulação (vale para a simulação toda), maior que zero.
//  - O autosave NÃO passa por esta checagem (a edição em andamento e as simulações antigas continuam salvando); ela vale
//    no "Salvar" e no "Enviar" (salvamento manual).
import { getRenderableSimulationModels, simulationModelHasValues } from "./simulation-models.js";
import { readStoredInterestRate } from "./interest-rate.mjs";

export const REQUIRED_TERM_MAX = 600;
export const RATE_REQUIRED_ERROR = "Informe a taxa de juros (% ao ano) da simulação (ex.: 5,4). Ela é obrigatória para salvar.";

export function termRequiredError(model) {
  const where = model ? `do ${String(model.label).toLowerCase()}${model.system === "sac" ? " (SAC)" : ""}` : "da simulação";
  return `Informe o prazo em meses ${where} (de 1 a ${REQUIRED_TERM_MAX}, ex.: 420). Ele é obrigatório para salvar.`;
}

/** Mensagem do primeiro campo obrigatório que falta, ou "" quando está tudo certo. */
export function simulationRequiredFieldsError(simulation = {}) {
  const filled = getRenderableSimulationModels(simulation).filter((model) => simulationModelHasValues(model.values));
  if (!filled.length) return "";
  const primary = filled[0];
  const term = Number(primary.values?.termMonths);
  if (!Number.isInteger(term) || term < 1 || term > REQUIRED_TERM_MAX) return termRequiredError(primary);
  if (!readStoredInterestRate(simulation.interestRateAnnual)) return RATE_REQUIRED_ERROR;
  return "";
}
