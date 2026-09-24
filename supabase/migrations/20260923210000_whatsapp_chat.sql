-- WhatsApp Master > CHAT (Etapa 1): caixa de entrada de conversas do número
-- oficial (WhatsApp Cloud API). Reaproveita whatsapp_master_events (registro
-- bruto de tudo que a Meta manda no webhook, mantido como está) e adiciona a
-- camada de CONVERSA + MENSAGEM já pronta para exibir/responder.
--
-- Estados que NÃO se misturam:
--   * whatsapp_messages.status  = ciclo de entrega na Meta (enviada/entregue/
--     lida PELO CLIENTE no WhatsApp/falhou) — vem dos webhooks de status.
--   * whatsapp_conversations.unread_count / last_read_at = "lida pelo usuário
--     do CRM" (estado interno do CRM), nunca vem da Meta.
--
-- Preparada para automações futuras: sender_type ('customer'|'user'|
-- 'automation') + automation_id/metadata nas mensagens e origin (jsonb) na
-- conversa (anúncio/campanha/link) — nada disso é preenchido por regra nova
-- nesta etapa; só guarda o "referral" que a Meta já envia em conversas
-- iniciadas por anúncio.

create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  contact_phone text not null unique,
  contact_name text,
  profile_photo_url text,
  client_id uuid references public.simulation_registrations(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'in_service', 'finished')),
  assigned_user_id uuid references public.admin_users(id) on delete set null,
  unread_count integer not null default 0 check (unread_count >= 0),
  last_read_at timestamptz,
  last_read_by uuid references public.admin_users(id) on delete set null,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_direction text check (last_message_direction in ('inbound', 'outbound')),
  last_inbound_at timestamptz,
  source text not null default 'whatsapp',
  origin jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_conversations_last_message_idx
  on public.whatsapp_conversations (last_message_at desc nulls last);
create index if not exists whatsapp_conversations_client_idx
  on public.whatsapp_conversations (client_id) where client_id is not null;
create index if not exists whatsapp_conversations_unread_idx
  on public.whatsapp_conversations (unread_count) where unread_count > 0;
create index if not exists whatsapp_conversations_status_idx
  on public.whatsapp_conversations (status);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender_type text not null check (sender_type in ('customer', 'user', 'automation')),
  sender_user_id uuid references public.admin_users(id) on delete set null,
  sent_by_name text,
  automation_id uuid,
  meta_message_id text,
  message_type text not null default 'text',
  body text,
  payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'received'
    check (status in ('received', 'queued', 'sent', 'delivered', 'read', 'failed')),
  error_code text,
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Idempotência: a Meta reenvia webhooks — o mesmo ID de mensagem nunca vira
-- duas linhas.
create unique index if not exists whatsapp_messages_meta_message_id_uidx
  on public.whatsapp_messages (meta_message_id) where meta_message_id is not null;
create index if not exists whatsapp_messages_conversation_idx
  on public.whatsapp_messages (conversation_id, message_at desc);
create index if not exists whatsapp_messages_sender_user_idx
  on public.whatsapp_messages (sender_user_id) where sender_user_id is not null;

alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
revoke all on public.whatsapp_conversations from anon, authenticated;
revoke all on public.whatsapp_messages from anon, authenticated;
grant all on public.whatsapp_conversations to service_role;
grant all on public.whatsapp_messages to service_role;

-- Atualização ATÔMICA da conversa quando chegam mensagens do cliente
-- (contador de não lidas não pode perder incremento com dois webhooks
-- simultâneos).
create or replace function public.whatsapp_chat_apply_inbound(
  p_conversation_id uuid,
  p_count integer,
  p_at timestamptz,
  p_preview text,
  p_name text,
  p_client_id uuid,
  p_origin jsonb
) returns void
language sql
as $$
  update public.whatsapp_conversations c set
    unread_count = c.unread_count + greatest(p_count, 0),
    last_message_preview = case when c.last_message_at is null or p_at >= c.last_message_at then p_preview else c.last_message_preview end,
    last_message_direction = case when c.last_message_at is null or p_at >= c.last_message_at then 'inbound' else c.last_message_direction end,
    last_message_at = case when c.last_message_at is null or p_at >= c.last_message_at then p_at else c.last_message_at end,
    last_inbound_at = greatest(coalesce(c.last_inbound_at, p_at), p_at),
    status = case when c.status = 'finished' then 'open' else c.status end,
    contact_name = coalesce(nullif(c.contact_name, ''), nullif(p_name, '')),
    client_id = coalesce(c.client_id, p_client_id),
    origin = case when c.origin = '{}'::jsonb and p_origin is not null then p_origin else c.origin end,
    updated_at = now()
  where c.id = p_conversation_id;
$$;

-- Mensagem enviada pelo CRM (usuário ou automação): atualiza prévia/ordem da
-- conversa; resposta manual move "aberta" para "em atendimento".
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
    updated_at = now()
  where c.id = p_conversation_id;
$$;

revoke all on function public.whatsapp_chat_apply_inbound(uuid, integer, timestamptz, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.whatsapp_chat_apply_outbound(uuid, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_chat_apply_inbound(uuid, integer, timestamptz, text, text, uuid, jsonb) to service_role;
grant execute on function public.whatsapp_chat_apply_outbound(uuid, timestamptz, text, boolean) to service_role;

-- Backfill (idempotente): mensagens que o cliente já enviou desde que a
-- integração existe estão em whatsapp_master_events — vira histórico do CHAT,
-- sem marcar nada como não lido.
with inbound as (
  select
    e.sender_phone,
    coalesce(e.event_at, e.received_at) as at,
    e.contact_name,
    e.related_client_id,
    coalesce(e.message_text, '[' || coalesce(e.message_type, 'mensagem') || ']') as preview
  from public.whatsapp_master_events e
  where e.event_type = 'message' and e.direction = 'inbound' and e.sender_phone is not null
),
latest as (
  select distinct on (sender_phone) sender_phone, at, preview
  from inbound
  order by sender_phone, at desc
),
names as (
  select sender_phone,
    (array_agg(contact_name order by at desc) filter (where contact_name is not null))[1] as contact_name,
    (array_agg(related_client_id order by at desc) filter (where related_client_id is not null))[1] as client_id
  from inbound
  group by sender_phone
)
insert into public.whatsapp_conversations
  (contact_phone, contact_name, client_id, last_message_at, last_message_preview, last_message_direction, last_inbound_at, status)
select l.sender_phone, n.contact_name, n.client_id, l.at, l.preview, 'inbound', l.at, 'open'
from latest l
join names n on n.sender_phone = l.sender_phone
on conflict (contact_phone) do nothing;

insert into public.whatsapp_messages
  (conversation_id, direction, sender_type, meta_message_id, message_type, body, payload, status, message_at)
select
  c.id, 'inbound', 'customer', e.message_id, coalesce(e.message_type, 'text'), e.message_text,
  case when coalesce(e.message_type, 'text') = 'text' then '{}'::jsonb else coalesce(e.raw_payload -> 'message', '{}'::jsonb) end,
  'received', coalesce(e.event_at, e.received_at)
from public.whatsapp_master_events e
join public.whatsapp_conversations c on c.contact_phone = e.sender_phone
where e.event_type = 'message' and e.direction = 'inbound' and e.message_id is not null
on conflict (meta_message_id) where meta_message_id is not null do nothing;
