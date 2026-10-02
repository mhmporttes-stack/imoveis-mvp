-- Correção pontual autorizada pelo dono (2026-10-02): conversa 39647f9f… (Lorgna Zapata) criada pelo código
-- antigo com chave de número oficial. As 2 mensagens RECEBIDAS pela sessão da ketlin (canal
-- whatsapp_individual, session_user_id = ketlin, remote_jid @lid) vão para a conversa (telefone + sessão
-- ketlin); o envio de 12:22 (canal whatsapp_cloud_api, sem sessão, status failed) fica na conversa do
-- número oficial. Backup em p_backup_20261002_lorgna_split e movimento em whatsapp_conversation_split_log
-- (reason = session_split_lorgna_20261002) — reversível. JÁ APLICADA em produção (Supabase MCP).
do $$
declare
  v_old uuid := '39647f9f-e4be-41f1-93bf-97c130ed2ccd';
  v_ses uuid := 'f67fa793-330e-4951-8128-401d56e9ecf5';
  v_new uuid;
  v_moved integer;
  r record;
begin
  create table if not exists public.p_backup_20261002_lorgna_split (
    id uuid primary key default gen_random_uuid(),
    kind text not null,
    payload jsonb not null,
    created_at timestamptz not null default now()
  );
  alter table public.p_backup_20261002_lorgna_split enable row level security;

  insert into public.p_backup_20261002_lorgna_split (kind, payload)
    select 'conversation', to_jsonb(c) from public.whatsapp_conversations c where c.id = v_old;
  insert into public.p_backup_20261002_lorgna_split (kind, payload)
    select 'message', to_jsonb(m) from public.whatsapp_messages m where m.conversation_id = v_old;
  insert into public.p_backup_20261002_lorgna_split (kind, payload)
    select 'reply_alert', to_jsonb(a) from public.whatsapp_reply_alerts a where a.conversation_id = v_old;

  select * into r from public.whatsapp_conversations where id = v_old;
  if r.session_key <> '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Conversa % já tem chave de sessão; nada a fazer', v_old;
  end if;

  insert into public.whatsapp_conversations (contact_phone, contact_name, profile_photo_url, client_id, status, session_key, assigned_user_id, source)
  values (r.contact_phone, r.contact_name, r.profile_photo_url, r.client_id, r.status, v_ses, null, r.source)
  on conflict (contact_phone, session_key) do update set updated_at = now()
  returning id into v_new;

  with moved as (
    update public.whatsapp_messages
       set conversation_id = v_new
     where conversation_id = v_old
       and channel = 'whatsapp_individual'
       and session_user_id = v_ses
       and direction = 'inbound'
       and id in ('2212763a-2aa8-4d73-8c5d-0cd709665c99'::uuid, '2c9ac177-16ec-4781-a6b5-f0f97f2e8d6c'::uuid)
    returning id
  )
  insert into public.whatsapp_conversation_split_log (message_id, from_conversation_id, to_conversation_id, session_user_id, reason)
  select id, v_old, v_new, v_ses, 'session_split_lorgna_20261002' from moved;

  select count(*) into v_moved from public.whatsapp_conversation_split_log where reason = 'session_split_lorgna_20261002';
  if v_moved <> 2 then
    raise exception 'Abortado: esperado 2 mensagens movidas, encontrado %', v_moved;
  end if;

  update public.whatsapp_reply_alerts set conversation_id = v_new where conversation_id = v_old;

  update public.whatsapp_conversations c
     set last_message_at = s.message_at,
         last_message_direction = s.direction,
         last_message_preview = left(regexp_replace(coalesce(nullif(s.body, ''), '[Mensagem]'), '\s+', ' ', 'g'), 140),
         last_inbound_at = (select max(i.message_at) from public.whatsapp_messages i where i.conversation_id = c.id and i.direction = 'inbound'),
         updated_at = now()
    from (
      select distinct on (conversation_id) conversation_id, message_at, direction, body
        from public.whatsapp_messages
       where conversation_id in (v_old, v_new) and direction in ('inbound', 'outbound') and message_type <> 'reaction'
       order by conversation_id, message_at desc
    ) s
   where c.id = s.conversation_id;
end;
$$;
