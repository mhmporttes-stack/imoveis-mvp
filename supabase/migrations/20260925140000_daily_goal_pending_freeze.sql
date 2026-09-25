-- Meta Diária = prospecção + clientes pendentes (regra oficial 2026-09-25).
--
-- As pendências do corretor são CONGELADAS no início de cada dia: a lista de
-- clientes (e a quantidade) não muda ao longo do dia — quem completar 3 dias
-- sem contato durante o dia só entra na meta do dia seguinte. Fica numa tabela
-- própria (uma linha por corretor/dia) e NÃO em daily_goals, porque a linha de
-- daily_goals é o "gatilho" da geração da cota (upsert com ignoreDuplicates em
-- ensureDailyGoalGenerated): criá-la antes da hora impediria a geração.
--
-- Quem grava: o cron diário daily-goal-close (00:10 America/Sao_Paulo) e, como
-- plano B, o primeiro acesso do dia à Meta Diária. Idempotente por chave
-- primária (broker_id, goal_date). Não altera nenhuma tabela existente.
create table if not exists public.daily_goal_pending_freeze (
  broker_id uuid not null references public.admin_users(id) on delete cascade,
  goal_date date not null,
  pending_client_ids uuid[] not null default '{}',
  pending_total integer not null default 0 check (pending_total >= 0),
  source text not null default 'lazy' check (source in ('cron', 'lazy')),
  frozen_at timestamptz not null default now(),
  primary key (broker_id, goal_date)
);

create index if not exists daily_goal_pending_freeze_date_idx
  on public.daily_goal_pending_freeze (goal_date);

alter table public.daily_goal_pending_freeze enable row level security;
revoke all on public.daily_goal_pending_freeze from anon, authenticated;
grant all on public.daily_goal_pending_freeze to service_role;
