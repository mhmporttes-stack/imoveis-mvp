-- Chat do Marketplace (MKT-2): o upsert de mensagens (lib/marketplace-chat.js, onConflict "conversation_id,external_id")
-- falhava com "there is no unique or exclusion constraint matching the ON CONFLICT specification" porque o único índice
-- único era PARCIAL (where external_id is not null) — o Postgres só aceita índice parcial no ON CONFLICT com o mesmo
-- predicado, que o PostgREST não envia. Índice único completo nas mesmas colunas: NULLs continuam distintos, então o
-- comportamento é o mesmo. Aditivo, sem DROP (o índice parcial antigo fica, redundante e inofensivo).
create unique index if not exists marketplace_messages_conversation_external_key
  on public.marketplace_messages (conversation_id, external_id);
