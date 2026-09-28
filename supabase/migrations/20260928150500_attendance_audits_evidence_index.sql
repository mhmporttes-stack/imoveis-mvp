-- Guarda o mapa conversationId -> {clientId, clientName} usado pelos links
-- "Ver conversa" da auditoria, para continuar funcionando ao reabrir uma
-- auditoria do histórico (não só logo após gerá-la).
alter table attendance_audits add column if not exists evidence_index jsonb;
