-- [REGRA OFICIAL — dono, 2026-10-02] Cliente ARQUIVADO sai do Chat: as
-- conversas dele ficam ocultas (exclusão lógica, deleted_at — o mesmo
-- mecanismo do "Excluir conversa"; nada é apagado) e, mesmo que o cliente
-- mande mensagem de novo, a conversa NÃO volta para a caixa nem é
-- atribuída a ninguém. Desarquivar o cliente traz de volta só as conversas
-- escondidas por esta regra (marca origin.archived_hidden_at).

-- 1) Mensagem nova não restaura conversa de cliente arquivado.
create or replace function public.whatsapp_chat_apply_inbound(p_conversation_id uuid, p_count integer, p_at timestamp with time zone, p_preview text, p_name text, p_client_id uuid, p_origin jsonb)
 returns void
 language plpgsql
as $function$
declare
  v_was_deleted boolean;
  v_phone text;
  v_client uuid;
  v_archived boolean;
begin
  select (c.deleted_at is not null), c.contact_phone, coalesce(c.client_id, p_client_id) into v_was_deleted, v_phone, v_client
    from public.whatsapp_conversations c where c.id = p_conversation_id for update;
  v_archived := exists (select 1 from public.simulation_registrations r where r.id = v_client and r.status = 'archived');
  update public.whatsapp_conversations c set
    unread_count = case when v_archived then 0 else c.unread_count + greatest(p_count, 0) end,
    last_message_preview = case when c.last_message_at is null or p_at >= c.last_message_at then p_preview else c.last_message_preview end,
    last_message_direction = case when c.last_message_at is null or p_at >= c.last_message_at then 'inbound' else c.last_message_direction end,
    last_message_at = case when c.last_message_at is null or p_at >= c.last_message_at then p_at else c.last_message_at end,
    last_inbound_at = greatest(coalesce(c.last_inbound_at, p_at), p_at),
    status = case when c.status = 'finished' then 'open' else c.status end,
    contact_name = coalesce(nullif(c.contact_name, ''), nullif(p_name, '')),
    client_id = coalesce(c.client_id, p_client_id),
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
$function$;

-- 2) Arquivar esconde; desarquivar traz de volta (só o que esta regra escondeu).
create or replace function public.whatsapp_sync_archived_client_conversations()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.status = 'archived' and old.status is distinct from 'archived' then
    with hidden as (
      update public.whatsapp_conversations c set
        deleted_at = now(), deleted_by = null, unread_count = 0,
        origin = coalesce(c.origin, '{}'::jsonb) || jsonb_build_object('archived_hidden_at', now()),
        updated_at = now()
      where c.client_id = new.id and c.deleted_at is null
      returning c.id, c.contact_phone
    )
    insert into public.whatsapp_conversation_audit (conversation_id, client_id, contact_phone, action, detail)
    select id, new.id, contact_phone, 'deleted', jsonb_build_object('reason', 'cliente arquivado', 'archived_client', true) from hidden;
  elsif old.status = 'archived' and new.status is distinct from 'archived' then
    with restored as (
      update public.whatsapp_conversations c set
        deleted_at = null, deleted_by = null,
        origin = c.origin - 'archived_hidden_at',
        updated_at = now()
      where c.client_id = new.id and c.deleted_at is not null and c.origin ? 'archived_hidden_at'
      returning c.id, c.contact_phone
    )
    insert into public.whatsapp_conversation_audit (conversation_id, client_id, contact_phone, action, detail)
    select id, new.id, contact_phone, 'restored_by_open', jsonb_build_object('reason', 'cliente desarquivado') from restored;
  end if;
  return new;
end;
$function$;

drop trigger if exists whatsapp_sync_archived_client_conversations on public.simulation_registrations;
create trigger whatsapp_sync_archived_client_conversations
  after update of status on public.simulation_registrations
  for each row execute function public.whatsapp_sync_archived_client_conversations();

revoke all on function public.whatsapp_sync_archived_client_conversations() from public, anon, authenticated;

-- 3) Clientes JÁ arquivados: esconde as conversas ainda visíveis.
with hidden as (
  update public.whatsapp_conversations c set
    deleted_at = now(), deleted_by = null, unread_count = 0,
    origin = coalesce(c.origin, '{}'::jsonb) || jsonb_build_object('archived_hidden_at', now()),
    updated_at = now()
  from public.simulation_registrations r
  where r.id = c.client_id and r.status = 'archived' and c.deleted_at is null
  returning c.id, c.client_id, c.contact_phone
)
insert into public.whatsapp_conversation_audit (conversation_id, client_id, contact_phone, action, detail)
select id, client_id, contact_phone, 'deleted', jsonb_build_object('reason', 'cliente arquivado', 'archived_client', true, 'backfill', true) from hidden;
