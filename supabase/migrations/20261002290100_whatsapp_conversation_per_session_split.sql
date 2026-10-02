-- PARTE 2 do isolamento do Chat por sessão (ver 20261002290000). Aplicar
-- DEPOIS do deploy do código que usa (contact_phone, session_key):
--   1) troca o UNIQUE(contact_phone) por (contact_phone, session_key) — já
--      existe o índice novo; o antigo só precisa sair;
--   2) o dedupe de mensagem do WhatsApp pessoal passa a ser POR SESSÃO: a
--      mesma mensagem entre dois colegas tem o mesmo wa_message_id nas duas
--      pontas, e o índice antigo (channel + wa_message_id global) descartava a
--      segunda ponta;
--   3) reclassifica o que o código antigo criou no intervalo e SEPARA as
--      conversas que misturavam mensagens de sessões diferentes. Cada
--      mensagem tem session_user_id (a sessão que realmente a recebeu/enviou)
--      = a prova do vínculo. Nada é apagado: as mensagens mudam de conversa e
--      cada movimento fica em whatsapp_conversation_split_log (reversível).

alter table public.whatsapp_conversations drop constraint if exists whatsapp_conversations_contact_phone_key;

drop index if exists public.whatsapp_messages_individual_wa_id_uidx;
create unique index if not exists whatsapp_messages_individual_wa_id_uidx
  on public.whatsapp_messages (session_user_id, ((metadata ->> 'wa_message_id')))
  where channel = 'whatsapp_individual' and (metadata ->> 'wa_message_id') is not null;

create table if not exists public.whatsapp_conversation_split_log (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null,
  from_conversation_id uuid not null,
  to_conversation_id uuid not null,
  session_user_id uuid not null,
  reason text not null default 'session_split',
  created_at timestamptz not null default now()
);
alter table public.whatsapp_conversation_split_log enable row level security;
create index if not exists whatsapp_conversation_split_log_message_idx on public.whatsapp_conversation_split_log (message_id);

select public.whatsapp_classify_conversation_sessions();

do $$
declare
  r record;
  v_new uuid;
  v_affected uuid[] := '{}';
begin
  for r in
    select m.conversation_id, m.session_user_id, c.contact_phone, c.contact_name, c.profile_photo_url, c.client_id, c.status
      from public.whatsapp_messages m
      join public.whatsapp_conversations c on c.id = m.conversation_id
     where m.session_user_id is not null
       and m.session_user_id <> c.session_key
     group by m.conversation_id, m.session_user_id, c.contact_phone, c.contact_name, c.profile_photo_url, c.client_id, c.status
  loop
    insert into public.whatsapp_conversations (contact_phone, contact_name, profile_photo_url, client_id, status, session_key, assigned_user_id)
    values (r.contact_phone, r.contact_name, r.profile_photo_url, r.client_id, r.status, r.session_user_id, r.session_user_id)
    on conflict (contact_phone, session_key) do update set updated_at = now()
    returning id into v_new;

    with moved as (
      update public.whatsapp_messages
         set conversation_id = v_new
       where conversation_id = r.conversation_id
         and session_user_id = r.session_user_id
      returning id
    )
    insert into public.whatsapp_conversation_split_log (message_id, from_conversation_id, to_conversation_id, session_user_id)
    select id, r.conversation_id, v_new, r.session_user_id from moved;

    v_affected := v_affected || r.conversation_id || v_new;
  end loop;

  if cardinality(v_affected) > 0 then
    -- Resumo (última mensagem/entrada) recalculado a partir das mensagens que
    -- ficaram em cada conversa.
    update public.whatsapp_conversations c
       set last_message_at = s.message_at,
           last_message_direction = s.direction,
           last_message_preview = left(regexp_replace(coalesce(nullif(s.body, ''), '[Mensagem]'), '\s+', ' ', 'g'), 140),
           last_inbound_at = (select max(i.message_at) from public.whatsapp_messages i where i.conversation_id = c.id and i.direction = 'inbound'),
           updated_at = now()
      from (
        select distinct on (conversation_id) conversation_id, message_at, direction, body
          from public.whatsapp_messages
         where conversation_id = any(v_affected)
           and direction in ('inbound', 'outbound')
           and message_type <> 'reaction'
         order by conversation_id, message_at desc
      ) s
     where c.id = s.conversation_id;

    -- Não lidas: conversa nova começa zerada; a antiga nunca fica com mais
    -- entradas pendentes do que realmente restaram nela.
    update public.whatsapp_conversations c
       set unread_count = least(c.unread_count, (
         select count(*) from public.whatsapp_messages i
          where i.conversation_id = c.id and i.direction = 'inbound' and i.message_type <> 'reaction'
            and (c.last_read_at is null or i.message_at > c.last_read_at)
       ))
     where c.id = any(v_affected)
       and c.unread_count > 0;
  end if;
end;
$$;

drop function if exists public.whatsapp_classify_conversation_sessions();
