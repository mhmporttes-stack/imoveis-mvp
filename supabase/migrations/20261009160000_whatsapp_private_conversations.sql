-- Conversas PARTICULARES (regra do dono, 2026-10-09): contato pessoal do corretor (família, amigos, fornecedores) não é
-- cliente. A conversa fica numa aba própria "Particular" do Chat, com o histórico inteiro, e mensagem nova NÃO a traz de
-- volta para a lista principal nem cria/vincula cliente. Separado de "cliente arquivado" (WA-13), que some do Chat.
alter table public.whatsapp_conversations
  add column if not exists private_at timestamptz,
  add column if not exists private_by uuid;
create index if not exists whatsapp_conversations_private_idx on public.whatsapp_conversations (private_at) where private_at is not null;

-- Cadastro de cliente que era, na verdade, contato pessoal: fica fora das listas de Clientes (inclusive Arquivados).
alter table public.simulation_registrations add column if not exists private_contact_at timestamptz;

-- Mensagem recebida: conversa particular nunca é vinculada a cliente nem escondida por "cliente arquivado".
create or replace function public.whatsapp_chat_apply_inbound(
  p_conversation_id uuid, p_count integer, p_at timestamptz, p_preview text, p_name text, p_client_id uuid, p_origin jsonb
) returns void
language plpgsql
as $$
declare
  v_was_deleted boolean;
  v_phone text;
  v_client uuid;
  v_archived boolean;
  v_private boolean;
begin
  select (c.deleted_at is not null), c.contact_phone, (c.private_at is not null),
         case when c.private_at is not null then c.client_id else coalesce(c.client_id, p_client_id) end
    into v_was_deleted, v_phone, v_private, v_client
    from public.whatsapp_conversations c where c.id = p_conversation_id for update;
  v_archived := not coalesce(v_private, false) and exists (select 1 from public.simulation_registrations r where r.id = v_client and r.status = 'archived');
  update public.whatsapp_conversations c set
    unread_count = case when v_archived then 0 else c.unread_count + greatest(p_count, 0) end,
    last_message_preview = case when c.last_message_at is null or p_at >= c.last_message_at then p_preview else c.last_message_preview end,
    last_message_direction = case when c.last_message_at is null or p_at >= c.last_message_at then 'inbound' else c.last_message_direction end,
    last_message_at = case when c.last_message_at is null or p_at >= c.last_message_at then p_at else c.last_message_at end,
    last_inbound_at = greatest(coalesce(c.last_inbound_at, p_at), p_at),
    status = case when c.status = 'finished' and c.private_at is null then 'open' else c.status end,
    contact_name = coalesce(nullif(c.contact_name, ''), nullif(p_name, '')),
    client_id = case when c.private_at is not null then c.client_id else coalesce(c.client_id, p_client_id) end,
    origin = case
      when v_archived and not (c.origin ? 'archived_hidden_at') then coalesce(nullif(c.origin, '{}'::jsonb), coalesce(p_origin, '{}'::jsonb)) || jsonb_build_object('archived_hidden_at', now())
      when c.origin = '{}'::jsonb and p_origin is not null then p_origin
      else c.origin end,
    deleted_at = case when v_archived then coalesce(c.deleted_at, now()) else null end,
    deleted_by = case when v_archived then c.deleted_by else null end,
    updated_at = now()
  where c.id = p_conversation_id;
  if coalesce(v_was_deleted, false) and not v_archived then
    insert into public.whatsapp_conversation_audit (conversation_id, client_id, contact_phone, action, detail)
    values (p_conversation_id, v_client, v_phone, 'restored_by_inbound', jsonb_build_object('reason', 'mensagem nova do cliente'));
  elsif v_archived and not coalesce(v_was_deleted, false) then
    insert into public.whatsapp_conversation_audit (conversation_id, client_id, contact_phone, action, detail)
    values (p_conversation_id, v_client, v_phone, 'deleted', jsonb_build_object('reason', 'cliente arquivado', 'archived_client', true));
  end if;
end;
$$;

revoke all on function public.whatsapp_chat_apply_inbound(uuid, integer, timestamptz, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_chat_apply_inbound(uuid, integer, timestamptz, text, text, uuid, jsonb) to service_role;
