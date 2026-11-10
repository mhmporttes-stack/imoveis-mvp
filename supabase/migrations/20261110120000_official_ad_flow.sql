-- Fluxo do anúncio no número OFICIAL (dono, 2026-11-10 — docs/BUSINESS_RULES.md WA-40). NÃO APLICADA: sem esta migration o fluxo,
-- mesmo "ligado" em crm_settings, registra o erro "tabela não existe" e não age. Aditiva: duas tabelas novas, nada existente muda.

-- Sessão do fluxo por telefone (uma viva por vez): etapa, temporizadores e estado da transferência.
create table if not exists public.official_ad_flow_sessions (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  conversation_id uuid,
  client_id uuid references public.simulation_registrations(id) on delete set null,
  profile_name text not null default '',
  step text not null default 'greeted' check (step in ('greeted', 'location', 'values')),
  status text not null default 'active' check (status in ('active', 'offering', 'offer_exhausted', 'transferred', 'held_by_owner', 'finished', 'stopped')),
  step_entered_at timestamptz not null default now(),
  last_client_at timestamptz,
  nudged_at timestamptz,
  form_token text,
  transfer_reason text,
  transferred_to uuid references public.admin_users(id) on delete set null,
  transferred_at timestamptz,
  end_reason text,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- No máximo UMA sessão viva por telefone (webhook duplicado/simultâneo = uma sessão).
create unique index if not exists official_ad_flow_sessions_live_phone_idx
  on public.official_ad_flow_sessions (phone) where status in ('active', 'offering');
create unique index if not exists official_ad_flow_sessions_form_token_idx
  on public.official_ad_flow_sessions (form_token) where form_token is not null;
create index if not exists official_ad_flow_sessions_client_idx on public.official_ad_flow_sessions (client_id);
create index if not exists official_ad_flow_sessions_live_timer_idx
  on public.official_ad_flow_sessions (step_entered_at) where status in ('active', 'offering');

-- Oferta ao próximo da roleta (serviço reutilizável, lib/roulette-offer.js): quem foi oferecido, prazo, ordem já consultada e
-- aceites tardios. Uma oferta pendente por cliente/tipo.
create table if not exists public.roulette_offers (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('ad_flow', 'general')),
  client_id uuid references public.simulation_registrations(id) on delete cascade,
  ref_id uuid,
  state text not null default 'pending' check (state in ('pending', 'accepted', 'exhausted', 'cancelled')),
  current_user_id uuid references public.admin_users(id) on delete set null,
  candidate_order jsonb not null default '[]'::jsonb,
  asked_user_ids jsonb not null default '[]'::jsonb,
  late_accepts jsonb not null default '[]'::jsonb,
  timeout_sec integer not null default 60,
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_by uuid references public.admin_users(id) on delete set null,
  accepted_at timestamptz,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists roulette_offers_one_pending_idx on public.roulette_offers (kind, client_id) where state = 'pending';
create index if not exists roulette_offers_pending_expiry_idx on public.roulette_offers (expires_at) where state = 'pending';
create index if not exists roulette_offers_updated_idx on public.roulette_offers (updated_at desc);

-- Mesmo padrão das demais tabelas: RLS ligado, sem policy pública (acesso só pelo servidor com a service role).
alter table public.official_ad_flow_sessions enable row level security;
alter table public.roulette_offers enable row level security;
