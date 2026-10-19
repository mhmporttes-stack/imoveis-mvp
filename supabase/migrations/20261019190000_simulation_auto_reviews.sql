-- SIM-AUTO (pedido do dono, 2026-10-19): conferência da simulação automática do site pelo corretor ("Simulação OK" /
-- "Corrigir simulação"), para a análise diária de aprendizado (docs/analytics/simulacao-automatica-conferencia.sql).
-- Uma linha por simulação automática: retrato do que o site calculou (nunca sobrescrito depois de conferido), resposta
-- do corretor e, se corrigiu, os valores lançados da Caixa. RLS ligado sem policy (acesso só pelo servidor). Idempotente.

create table if not exists public.simulation_auto_reviews (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.simulation_registrations(id) on delete cascade,
  simulation_id uuid not null references public.simulations(id) on delete cascade,
  estimate_version text,
  auto_snapshot jsonb not null,
  review_status text not null default 'pending' check (review_status in ('pending', 'correcting', 'ok', 'corrected')),
  caixa_income numeric(12, 2),
  corrected_snapshot jsonb,
  corrected_at timestamptz,
  reviewed_by_user_id uuid references public.admin_users(id) on delete set null,
  reviewed_by_email text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists simulation_auto_reviews_simulation_unique on public.simulation_auto_reviews (simulation_id);
create index if not exists simulation_auto_reviews_registration_idx on public.simulation_auto_reviews (registration_id);
create index if not exists simulation_auto_reviews_reviewed_at_idx on public.simulation_auto_reviews (reviewed_at);

alter table public.simulation_auto_reviews enable row level security;
