-- Chat do Marketplace dentro do CRM (MKT-2, dono, 2026-10-20). A extensão do Chrome no PC do dono espelha SÓ as
-- conversas do Marketplace (nunca mensagens pessoais do Messenger) e envia as respostas que os corretores escrevem no
-- CRM. Tabelas próprias (não whatsapp_conversations): o Chat do WhatsApp é ancorado em telefone/sessão e tem gatilhos,
-- Fluxos, lembretes e envio que não podem ser acionados por uma conversa do Facebook. RLS ligado sem policy (acesso só
-- pelo servidor). Idempotente. Depende de 20261020120000_marketplace_listings.sql.

create table if not exists public.marketplace_conversations (
  id uuid primary key default gen_random_uuid(),
  thread_key text not null unique,
  thread_url text not null default '',
  contact_name text not null default '',
  contact_photo_url text not null default '',
  listing_id uuid references public.marketplace_listings(id) on delete set null,
  listing_title text not null default '',
  listing_url text not null default '',
  assigned_user_id uuid references public.admin_users(id) on delete set null,
  assigned_at timestamptz,
  waiting_distribution_at timestamptz,
  redistributions integer not null default 0,
  client_id uuid references public.simulation_registrations(id) on delete set null,
  unread_count integer not null default 0,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_human_reply_at timestamptz,
  last_message_preview text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_conversations_last_idx on public.marketplace_conversations (last_message_at desc);
create index if not exists marketplace_conversations_assigned_idx on public.marketplace_conversations (assigned_user_id, last_message_at desc);
create index if not exists marketplace_conversations_waiting_idx on public.marketplace_conversations (waiting_distribution_at) where waiting_distribution_at is not null;

create table if not exists public.marketplace_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.marketplace_conversations(id) on delete cascade,
  external_id text,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender_name text not null default '',
  sender_user_id uuid references public.admin_users(id) on delete set null,
  body text not null default '',
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  -- inbound: received. outbound do CRM: queued → sending → sent | failed. outbound visto no Facebook (enviado fora do
  -- CRM, pelo próprio dono): sent.
  status text not null default 'received' check (status in ('received', 'queued', 'sending', 'sent', 'failed')),
  error text,
  attempts integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists marketplace_messages_external_uidx on public.marketplace_messages (conversation_id, external_id) where external_id is not null;
create index if not exists marketplace_messages_conversation_idx on public.marketplace_messages (conversation_id, message_at);
create index if not exists marketplace_messages_outbox_idx on public.marketplace_messages (status, created_at) where status in ('queued', 'sending');

alter table public.marketplace_conversations enable row level security;
alter table public.marketplace_messages enable row level security;
