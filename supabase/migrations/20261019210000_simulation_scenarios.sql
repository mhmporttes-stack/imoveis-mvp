-- "Comparar simulações" (pedido do dono, 2026-10-19 — SIM-AUTO): histórico de cenários de simulação do cliente.
-- Cada simulação automática (site), cada "Refazer" e cada salvamento do corretor com valores diferentes do último vira
-- um cenário; nada é apagado. "Usar este cenário" copia os valores para a simulação atual. RLS ligado sem policy
-- (acesso só pelo servidor). Idempotente. O código funciona sem esta tabela (a aba mostra só a simulação atual).

create table if not exists public.simulation_scenarios (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.simulation_registrations(id) on delete cascade,
  simulation_id uuid references public.simulations(id) on delete set null,
  origin text not null check (origin in ('site', 'refazer', 'corretor', 'correcao_caixa')),
  checked_by_caixa boolean not null default false,
  data jsonb not null,
  values_key text not null,
  created_by_email text,
  created_by_user_id uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  checked_at timestamptz
);

create index if not exists simulation_scenarios_registration_idx on public.simulation_scenarios (registration_id, created_at desc);
create index if not exists simulation_scenarios_simulation_idx on public.simulation_scenarios (simulation_id, created_at desc);

alter table public.simulation_scenarios enable row level security;
