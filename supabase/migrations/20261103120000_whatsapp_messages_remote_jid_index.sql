-- Desempenho (2026-11-03): a busca do telefone de um LID filtra whatsapp_messages por
--   channel = 'whatsapp_individual' AND session_user_id = ? AND session_slot = ? AND metadata->>'remote_jid' = ?
-- O índice parcial existente (whatsapp_messages_session_remote_jid_idx, WHERE metadata ? 'remote_jid') só é usado quando a consulta
-- repete esse predicado — e o PostgREST não consegue gerar `metadata ? 'remote_jid'`. Resultado: cada busca varre as mensagens da
-- sessão (≈900 blocos por consulta; com o índice completo: 8). Este índice NÃO é parcial, então a mesma consulta o usa.
-- Aditiva e idempotente. Em produção criar fora do horário de pico (bloqueia gravações em whatsapp_messages por alguns segundos);
-- alternativa sem bloqueio: rodar o mesmo comando com CREATE INDEX CONCURRENTLY, fora de transação (SQL Editor).
create index if not exists whatsapp_messages_session_remote_jid_all_idx
  on public.whatsapp_messages (session_user_id, session_slot, ((metadata ->> 'remote_jid')), message_at desc);
