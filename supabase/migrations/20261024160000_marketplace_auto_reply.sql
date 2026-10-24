-- Resposta automática de disponibilidade no Chat do Marketplace (MKT-2l, REGRA OFICIAL — dono, 2026-10-24):
-- "Bom dia/boa tarde/boa noite, o nome do cliente. Sim, esse item ainda está disponível." Sai pela MESMA fila da extensão
-- (marketplace_messages outbound `queued`, sem autor). Só ACRESCENTA colunas e um índice; nenhuma linha existente muda.
--   auto_kind  — tipo da resposta automática ('availability'); null = mensagem normal (corretor, cliente, Facebook).
--   send_after — não sai antes disto (atraso humano de 30 s a 2 min); null = sai assim que der.
-- Uma resposta automática de cada tipo por conversa (idempotência): índice único parcial. Cancelada continua contando
-- (status 'failed' + motivo em `error`), então nunca é agendada de novo. Idempotente.

alter table public.marketplace_messages add column if not exists auto_kind text;
alter table public.marketplace_messages add column if not exists send_after timestamptz;

create unique index if not exists marketplace_messages_auto_kind_uidx
  on public.marketplace_messages (conversation_id, auto_kind)
  where auto_kind is not null;
