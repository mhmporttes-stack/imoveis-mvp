-- Mensagem interna no Chat do Marketplace (MKT-2i, REGRA OFICIAL — dono, 2026-10-22): "Como a mensagem interna do chat
-- do WhatsApp. Apenas eu, o corretor e a gerente visualizam." A nota fica em marketplace_messages com direction =
-- 'internal' (status 'sent', sem external_id): a fila da extensão só pega saída 'queued' e a sincronização só grava
-- inbound/outbound com external_id, então nada a apaga nem duplica.
-- Só AMPLIA o check de direção (nenhuma linha existente muda). O check original foi criado inline em
-- 20261020180000_marketplace_chat.sql, com o nome padrão do Postgres.
alter table public.marketplace_messages drop constraint if exists marketplace_messages_direction_check;
alter table public.marketplace_messages
  add constraint marketplace_messages_direction_check check (direction in ('inbound', 'outbound', 'internal'));
