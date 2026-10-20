-- Desempenho (2026-10-20, Fase 1): findKnownPhoneForLid (lib/whatsapp-individual-inbound.js) procura o telefone de um
-- LID filtrando whatsapp_messages por session_user_id + session_slot + metadata->>'remote_jid' sem índice — base da
-- rotina "Número não identificado", a mais cara do banco. Índice parcial só nas mensagens que têm remote_jid.
--
-- APLICAÇÃO: CREATE INDEX CONCURRENTLY não pode rodar dentro de transação. Aplique este arquivo SOZINHO, como um único
-- comando (client `pg`, `await client.query(<este arquivo>)` sem BEGIN; nada de apply_migration do MCP, que embrulha
-- em transação). Se precisar aplicar dentro de transação, remova CONCURRENTLY (trava escrita na tabela durante a criação).
-- Se a criação concorrente falhar no meio, o índice fica INVALID: `drop index concurrently whatsapp_messages_session_remote_jid_idx;` e rode de novo.
create index concurrently if not exists whatsapp_messages_session_remote_jid_idx
  on public.whatsapp_messages (session_user_id, session_slot, (metadata->>'remote_jid'))
  where metadata ? 'remote_jid';
