// Cliente TRANSFERIDO no card "Novos atendimentos" (REGRA OFICIAL — dono, 2026-10-23, CLI-7b). Parte pura (testável);
// a leitura no banco e a união com os clientes novos ficam em getUnattendedClientIds (lib/simulation-list-query.js).
//
// "Transferido" = troca REAL de responsável já gravada por todos os caminhos de transferência (manual/CLI-7a, roleta,
// fila de espera, fila de reativação do FUN-15l, redistribuição): previous_responsible_user_id + responsible_changed_at,
// com o anterior diferente do atual. Quem está na fila de espera (pending_distribution_at) ainda não foi recebido.
// "Atendido" = o MESMO critério que tira o cliente novo do card (resposta humana no Chat, last_human_reply_at, ou
// "Assumir atendimento", assumed_at), contado só a partir do recebimento: o que o corretor anterior fez não vale para
// quem recebeu (listClientIdsWithHumanAttendance sem `ever` → pickProtectedClientIds, mesma regra da REDISTRIBUIÇÃO DE LEADS).
import { ALL_TAB_NEGATIVE_STATUSES, AWAITING_SIMULATION_STATUS_VALUES, CLIENT_STATUS } from "./client-status.js";

// Fora do card: situação negativa (mesma lista da aba Todos, CLI-12a), "Pago" (some da lista de Clientes) e
// "Aguardando simulação", que já tem item próprio nas pendências (não conta duas vezes).
export const TRANSFERRED_AWAITING_EXCLUDED_STATUSES = Object.freeze([
  ...ALL_TAB_NEGATIVE_STATUSES,
  CLIENT_STATUS.SALE_PAID,
  ...AWAITING_SIMULATION_STATUS_VALUES
]);

export function isTransferredCandidate(client) {
  return Boolean(
    client?.id
    && client.responsible_user_id
    && client.previous_responsible_user_id
    && client.previous_responsible_user_id !== client.responsible_user_id
    && client.responsible_changed_at
    && !client.pending_distribution_at
    && !client.private_contact_at
    && !TRANSFERRED_AWAITING_EXCLUDED_STATUSES.includes(client.status)
  );
}

