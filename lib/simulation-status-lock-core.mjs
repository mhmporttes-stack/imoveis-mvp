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

// Simulação automática do site (SIM-AUTO, dono 2026-10-19): gravada em `simulations` com `created_by` = esta marca,
// com valores e link da apresentação prontos, mas NÃO é simulação real da Caixa — não vale como "simulação feita"
// (trava "Simulação realizada", prazo da roleta, pontuação, card). Quando o corretor salva a simulação no Gerador, o
// `created_by` vira o e-mail dele e ela passa a ser real. Fonte única desta regra.
export const AUTOMATIC_SIMULATION_SOURCE = "Simulação automática do site";

// Linha da nota interna com a renda usada na simulação automática (o corretor usa a mesma no simulador da Caixa).
// Desde 2026-10-19 (novo e usado com rendas próprias): "Renda para usar na Caixa — novo: R$ X / usado: R$ Y".
export const AUTOMATIC_INCOME_NOTE_PREFIX = "Renda para usar na Caixa —";
const LEGACY_INCOME_NOTE_PREFIX = "Renda considerada na simulação:";

export function automaticIncomeFromNote(note = "") {
  for (const prefix of [AUTOMATIC_INCOME_NOTE_PREFIX, LEGACY_INCOME_NOTE_PREFIX]) {
    const line = String(note || "").split(/\r?\n/).find((item) => item.trim().startsWith(prefix));
    if (line) return line.trim().slice(prefix.length).trim();
  }
  return "";
}

export const AUTO_PRESENTATION_LOCKED_MESSAGE = "Confira 👍/👎 em cada imóvel para liberar o link."; // dono, 2026-10-19 (conferência por tipo)

export function isAutomaticSimulationSource(createdBy) {
  return String(createdBy || "").trim() === AUTOMATIC_SIMULATION_SOURCE;
}

// Linhas de `simulations` (financing_value/subsidy_value, números ou texto; `created_by` quando vier na consulta).
export function hasRealSimulationValues(rows) {
  return (rows || []).some((row) => !isAutomaticSimulationSource(row?.created_by)
    && (Number(row?.financing_value || 0) > 0 || Number(row?.subsidy_value || 0) > 0));
}

// Decisão da tela: a opção "Simulação realizada" fica bloqueada quando o
// cliente não tem simulação real (a menos que ele já esteja nesse status).
export function isSimulationDoneOptionBlocked({ currentStatus, hasRealSimulation }) {
  return currentStatus !== "completed" && !hasRealSimulation;
}
