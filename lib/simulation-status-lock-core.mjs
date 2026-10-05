// Trava "Simulação realizada" (regra do dono, 2026-10-05): o status só vale
// quando o cliente TEM uma simulação de verdade — valor de financiamento ou
// de subsídio maior que zero. Cadastro com renda/recurso preenchidos (formulário
// ou digitado), simulação vazia criada automaticamente ou autosave NÃO contam.
// Mesmo critério de lib/performance-overview.js (pontuação) e de
// getSimulationListSummary (card). Puro e testado (tests/simulation-status-lock.test.mjs).

export const SIMULATION_REQUIRED_MESSAGE = "Para marcar como Simulação realizada, o cliente precisa ter uma simulação com valor de financiamento ou subsídio. Gere a simulação primeiro.";

// Status que só podem existir com simulação real.
export function statusRequiresRealSimulation(status) {
  return status === "completed";
}

// Linhas de `simulations` (financing_value/subsidy_value, números ou texto).
export function hasRealSimulationValues(rows) {
  return (rows || []).some((row) => Number(row?.financing_value || 0) > 0 || Number(row?.subsidy_value || 0) > 0);
}

// Decisão da tela: a opção "Simulação realizada" fica bloqueada quando o
// cliente não tem simulação real (a menos que ele já esteja nesse status).
export function isSimulationDoneOptionBlocked({ currentStatus, hasRealSimulation }) {
  return currentStatus !== "completed" && !hasRealSimulation;
}
