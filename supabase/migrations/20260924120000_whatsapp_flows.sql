-- WhatsApp Master > Fluxos (automação visual estilo ManyChat): fluxos com
-- mensagens de botão/lista/link, perguntas, condições, esperas e ações,
-- executados sobre o Chat (whatsapp_conversations/whatsapp_messages).
--
-- Rascunho x publicado: o editor grava em graph/trigger (rascunho, salva a
-- cada mudança); "Ativar/Atualizar" copia para published_graph/published_trigger,
-- que é o que roda de verdade. Cada sessão guarda um SNAPSHOT do grafo
-- (graph) — editar o fluxo não muda a conversa que já está em andamento.

create table if not exists public.whatsapp_flows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  trigger jsonb not null default '{}'::jsonb,
  graph jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  published_trigger jsonb,
  published_graph jsonb,
  version integer not null default 1,
  published_version integer,
  triggered_count integer not null default 0,
  created_by uuid references public.admin_users(id) on delete set null,
  updated_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists whatsapp_flows_status_idx on public.whatsapp_flows (status);

create table if not exists public.whatsapp_flow_sessions (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.whatsapp_flows(id) on delete cascade,
  flow_version integer,
  contact_phone text not null,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'waiting', 'completed', 'handoff', 'expired', 'failed')),
  graph jsonb not null,
  current_node_id text,
  pending_target text,
  awaiting jsonb,
  vars jsonb not null default '{}'::jsonb,
  retries integer not null default 0,
  wait_until timestamptz,
  lock_until timestamptz,
  end_reason text,
  error text,
  started_at timestamptz not null default now(),
  last_input_at timestamptz,
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);

-- No máximo UMA sessão viva por telefone (o cliente conversa com um fluxo de
-- cada vez). Índice parcial só serve para INSERT (não para upsert).
create unique index if not exists whatsapp_flow_sessions_one_live_per_phone_uidx
  on public.whatsapp_flow_sessions (contact_phone)
  where status in ('active', 'waiting');
create index if not exists whatsapp_flow_sessions_due_idx
  on public.whatsapp_flow_sessions (wait_until)
  where status = 'waiting';
create index if not exists whatsapp_flow_sessions_flow_phone_idx
  on public.whatsapp_flow_sessions (flow_id, contact_phone, started_at desc);

create table if not exists public.whatsapp_flow_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.whatsapp_flow_sessions(id) on delete cascade,
  flow_id uuid references public.whatsapp_flows(id) on delete cascade,
  contact_phone text,
  node_id text,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_flow_logs_flow_idx on public.whatsapp_flow_logs (flow_id, created_at desc);
create index if not exists whatsapp_flow_logs_session_idx on public.whatsapp_flow_logs (session_id, created_at);

alter table public.whatsapp_flows enable row level security;
alter table public.whatsapp_flow_sessions enable row level security;
alter table public.whatsapp_flow_logs enable row level security;
revoke all on public.whatsapp_flows from anon, authenticated;
revoke all on public.whatsapp_flow_sessions from anon, authenticated;
revoke all on public.whatsapp_flow_logs from anon, authenticated;
grant all on public.whatsapp_flows to service_role;
grant all on public.whatsapp_flow_sessions to service_role;
grant all on public.whatsapp_flow_logs to service_role;

create or replace function public.increment_whatsapp_flow_count(p_id uuid)
returns void
language sql
as $$
  update public.whatsapp_flows set triggered_count = triggered_count + 1 where id = p_id;
$$;

revoke all on function public.increment_whatsapp_flow_count(uuid) from public, anon, authenticated;
grant execute on function public.increment_whatsapp_flow_count(uuid) to service_role;
