-- "Não lida" só quando a última mensagem é do cliente (pedido do dono, 2026-10-09): resposta HUMANA (Chat do CRM ou o
-- próprio corretor pelo celular — p_mark_in_service = true) zera o contador. Mensagem automática não zera (o cliente
-- continua esperando uma pessoa).
create or replace function public.whatsapp_chat_apply_outbound(
  p_conversation_id uuid,
  p_at timestamptz,
  p_preview text,
  p_mark_in_service boolean
) returns void
language sql
as $$
  update public.whatsapp_conversations c set
    last_message_preview = case when c.last_message_at is null or p_at >= c.last_message_at then p_preview else c.last_message_preview end,
    last_message_direction = case when c.last_message_at is null or p_at >= c.last_message_at then 'outbound' else c.last_message_direction end,
    last_message_at = case when c.last_message_at is null or p_at >= c.last_message_at then p_at else c.last_message_at end,
    status = case when p_mark_in_service and c.status = 'open' then 'in_service' else c.status end,
    unread_count = case when p_mark_in_service and (c.last_message_at is null or p_at >= c.last_message_at) then 0 else c.unread_count end,
    last_read_at = case when p_mark_in_service and (c.last_message_at is null or p_at >= c.last_message_at) and c.unread_count > 0 then now() else c.last_read_at end,
    updated_at = now()
  where c.id = p_conversation_id;
$$;

revoke all on function public.whatsapp_chat_apply_outbound(uuid, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_chat_apply_outbound(uuid, timestamptz, text, boolean) to service_role;
