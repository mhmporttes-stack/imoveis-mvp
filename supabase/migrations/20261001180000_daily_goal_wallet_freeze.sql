-- Meta de prospecção do dia (wallet.dayTarget) CONGELADA no início do dia
-- (regra confirmada pelo dono em 2026-10-01). Antes, o denominador era
-- "carteira ativa AGORA" recalculado a cada carregamento — contato novo
-- entrando na carteira durante o dia (claim manual ou automático) inflava a
-- meta depois que o corretor já tinha concluído tudo que existia pela manhã,
-- fazendo o percentual cair sem nenhum motivo visível pra quem olha a tela
-- (caso real: Bruna Santos, 2026-10-01 — via de 100% pra 98% com mais
-- contatos entrando na 3ª tentativa durante o dia).
--
-- Mesmo padrão de daily_goal_pending_freeze (ver
-- 20260925140000_daily_goal_pending_freeze.sql): congela só os IDs das
-- rodadas ativas no início do dia; o estado atual de cada rodada (encerrada,
-- convertida, tentativa de hoje) continua lido ao vivo — só o CONJUNTO não
-- cresce mais durante o dia. Rodada criada hoje (contato novo) não entra na
-- meta de hoje; passa a contar a partir de amanhã. Tentativa feita hoje numa
-- rodada fora do congelamento continua contando como trabalho (soma pontos
-- percentuais extras), só não aparece em nenhuma etapa específica do card.
--
-- Quem grava: o cron diário daily-goal-close (junto do congelamento das
-- pendências) e, como plano B, o primeiro acesso do dia. Idempotente por
-- chave primária (broker_id, goal_date). Não altera nenhuma tabela existente.
create table if not exists public.daily_goal_wallet_freeze (
  broker_id uuid not null references public.admin_users(id) on delete cascade,
  goal_date date not null,
  round_ids uuid[] not null default '{}',
  round_total integer not null default 0 check (round_total >= 0),
  source text not null default 'lazy' check (source in ('cron', 'lazy')),
  frozen_at timestamptz not null default now(),
  primary key (broker_id, goal_date)
);

create index if not exists daily_goal_wallet_freeze_date_idx
  on public.daily_goal_wallet_freeze (goal_date);

alter table public.daily_goal_wallet_freeze enable row level security;
revoke all on public.daily_goal_wallet_freeze from anon, authenticated;
grant all on public.daily_goal_wallet_freeze to service_role;
