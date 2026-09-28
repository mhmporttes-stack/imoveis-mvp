-- Completa as regras iniciadas no banco em 20260928034446.
-- O intervalo usa o campo points como quantidade de minutos, versionada
-- junto dos pesos para que alterações não mudem dias anteriores.
alter table public.scoring_rule_versions drop constraint if exists scoring_rule_versions_rule_key_check;
alter table public.scoring_rule_versions add constraint scoring_rule_versions_rule_key_check
  check (rule_key in (
    'new_client', 'prospecting', 'service', 'simulation', 'documentation',
    'sent_for_approval', 'approval', 'sale', 'presence_10min',
    'presence_interval_minutes', 'presence_top_bonus', 'daily_goal_penalty'
  ));

insert into public.scoring_rule_versions (rule_key, points, active, effective_from)
values
  ('presence_10min', 5, true, now()),
  ('presence_interval_minutes', 10, true, now()),
  ('presence_top_bonus', 30, true, now()),
  ('daily_goal_penalty', 50, true, now())
on conflict (rule_key) where effective_to is null do nothing;
