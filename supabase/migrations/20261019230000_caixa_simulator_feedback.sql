-- "Simulador Caixa" do painel (pedido do dono, 2026-10-19): voto 👍/👎 do corretor sobre o resultado do motor, com as
-- entradas, as saídas (recalculadas no servidor com o mesmo motor) e, opcionalmente no 👎, os valores da Caixa. Para a
-- análise diária (docs/analytics/simulacao-automatica-conferencia.sql). Não é cliente nem lead. RLS ligado sem policy
-- (acesso só pelo servidor). Idempotente. O código funciona sem esta tabela (o voto só não é gravado).

create table if not exists public.caixa_simulator_feedback (
  id uuid primary key default gen_random_uuid(),
  vote text not null check (vote in ('up', 'down')),
  inputs jsonb not null,
  outputs jsonb not null,
  caixa_values jsonb,
  estimate_version text,
  created_by_user_id uuid references public.admin_users(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists caixa_simulator_feedback_created_idx on public.caixa_simulator_feedback (created_at desc);

alter table public.caixa_simulator_feedback enable row level security;
