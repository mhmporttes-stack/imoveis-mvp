-- Reconhecimentos: sequências e metas de período (dono, 2026-10-30). Aditiva e idempotente; NÃO apagar nem
-- reescrever dado. O código funciona sem esta migration (degrada para o comportamento anterior).

-- 1) Meta semanal/mensal (opção B): pendentes resolvidos/total de CADA dia, gravados no fechamento do dia
--    (lib/daily-goal.js closeDailyGoalDay). Dias já fechados ficam NULL (sem backfill): entram só com a prospecção.
alter table public.daily_goals
  add column if not exists pending_done integer,
  add column if not exists pending_total integer;

-- 2) Liderança diária em sequência: quem fechou cada dia em 1º no ranking (gravado pelo cron celebrations-ranking, a
--    cada 2 min; o último registro do dia é o fechamento). leader_broker_id nulo = dia sem líder qualificado.
create table if not exists public.celebration_daily_leaders (
  day date primary key,
  leader_broker_id uuid references public.admin_users(id) on delete set null,
  points numeric not null default 0,
  recorded_at timestamptz not null default now()
);
alter table public.celebration_daily_leaders enable row level security;

-- 3) Gatilho novo + texto padrão. [N] = dias seguidos de liderança; [N+1] = o próximo.
insert into public.celebration_triggers (key, enabled, config, animation_mode)
values ('ranking_streak', true, '{}'::jsonb, 'coroa')
on conflict (key) do nothing;

insert into public.celebration_message_templates (trigger_key, template, active, is_default)
values
  ('ranking_streak', '[nome], você manteve a liderança diária por [N] dias seguidos. Vamos buscar o [N+1]º e manter a liderança! 👑', true, true),
  ('ranking_streak', 'Liderança em sequência, [nome]: [N] dias seguidos em 1º! Bora buscar o [N+1]º. 👑', true, true)
on conflict (trigger_key, template) do nothing;

-- 4) Marcos de "dias seguidos de meta": só troca a lista se ainda for a padrão antiga ([3,5,10]) — uma lista que o
--    admin já editou não é tocada.
update public.celebration_triggers
   set config = jsonb_set(config, '{thresholds}', '[2,3,5,7,10,15,20,30]'::jsonb)
 where key = 'goal_streak'
   and config -> 'thresholds' = '[3,5,10]'::jsonb;
