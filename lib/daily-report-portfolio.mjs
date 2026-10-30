// "Carteira agora" dos cartões do Relatório diário (decisão do dono, 2026-10-30): ao lado do número
// "no período" (o que aconteceu no prazo escolhido), cada cartão mostra quantos clientes estão NESSA
// etapa hoje, no escopo de quem olha (corretor/equipe), sem depender do prazo.
//
// É o STATUS ATUAL do cliente (`simulation_registrations.status`), não o histórico — por isso pode
// divergir do painel Desempenho (funil cumulativo por coorte, docs/METRICAS_FUNIL.md MET-3/MET-4).
// Cadastros: o "agora" é "Em andamento" (MET-7 = ACTIVE_CLIENT_STATUS_VALUES), a única definição de
// carteira ativa que já existe — não há "total de cadastros agora" separado.

import { ACTIVE_CLIENT_STATUS_VALUES, CLIENT_STATUS } from "./client-status.js";

export const PORTFOLIO_STATUS_BY_METRIC = {
  newRegistrations: [...ACTIVE_CLIENT_STATUS_VALUES],
  awaitingDocumentation: [CLIENT_STATUS.DOCUMENTATION],
  documentsPending: [CLIENT_STATUS.DOCUMENTS_PENDING],
  sentForApproval: [CLIENT_STATUS.APPROVAL_PENDING],
  approved: [CLIENT_STATUS.APPROVED],
  rejected: [CLIENT_STATUS.REJECTED],
  salesCompleted: [CLIENT_STATUS.SALE_COMPLETED]
};

// Cliente "Particular" (contato pessoal do corretor, WA-19) não é cliente: fica fora da carteira.
export const PORTFOLIO_EXCLUDES_PRIVATE_COLUMN = "private_contact_at";
