-- Disparo automático: oscilação percentual em cima da média calculada
-- automaticamente (janela ÷ mensagens do dia), em vez do intervalo
-- min/máx fixo — pedido do dono, 2026-09-30. Ver lib/daily-goal-auto-core.mjs
-- (spreadScheduleMinutes) e lib/daily-goal-auto.js.
alter table public.daily_goal_auto_settings
  add column if not exists oscillate_enabled boolean not null default false,
  add column if not exists oscillate_percent integer not null default 50;

alter table public.daily_goal_auto_settings
  drop constraint if exists daily_goal_auto_settings_oscillate_percent_check;
alter table public.daily_goal_auto_settings
  add constraint daily_goal_auto_settings_oscillate_percent_check
  check (oscillate_percent >= 0 and oscillate_percent <= 100);

comment on column public.daily_goal_auto_settings.oscillate_enabled is
  'Quando true, ignora min_gap_minutes/max_gap_minutes: o intervalo entre mensagens vira a média (tempo restante da janela / mensagens do dia) +/- oscillate_percent%.';
comment on column public.daily_goal_auto_settings.oscillate_percent is
  'Percentual de variação em torno da média calculada, só usado quando oscillate_enabled = true.';
