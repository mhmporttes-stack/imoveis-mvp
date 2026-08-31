alter table public.crm_automation_rules
  add column if not exists delay_value integer not null default 0,
  add column if not exists delay_unit text not null default 'minutes',
  add column if not exists last_run_at timestamptz,
  add column if not exists run_count integer not null default 0;

alter table public.crm_automation_rules
  drop constraint if exists crm_automation_rules_delay_value_check,
  add constraint crm_automation_rules_delay_value_check check (delay_value between 0 and 3650),
  drop constraint if exists crm_automation_rules_delay_unit_check,
  add constraint crm_automation_rules_delay_unit_check check (delay_unit in ('minutes', 'hours', 'days'));

create table if not exists public.crm_automation_executions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.crm_automation_rules(id) on delete cascade,
  client_id uuid not null references public.simulation_registrations(id) on delete cascade,
  event_key text not null,
  status text not null default 'processing' check (status in ('processing', 'success', 'failed')),
  error text not null default '',
  executed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (rule_id, client_id, event_key)
);

create index if not exists crm_automation_executions_rule_executed_idx
  on public.crm_automation_executions (rule_id, executed_at desc);

alter table public.crm_automation_executions enable row level security;
revoke all on public.crm_automation_executions from anon, authenticated;
grant all on public.crm_automation_executions to service_role;

insert into public.crm_automation_rules
  (name, trigger_type, trigger_config, condition_config, action_config, delay_value, delay_unit, enabled)
select
  seed.name,
  seed.trigger_type,
  seed.trigger_config,
  seed.condition_config,
  seed.action_config,
  seed.delay_value,
  seed.delay_unit,
  false
from (values
  (
    'Novo cliente sem ação',
    'client_created',
    '{}'::jsonb,
    '[{"type":"has_future_activity","value":false},{"type":"not_archived","value":true}]'::jsonb,
    '[{"type":"create_notification","title":"Novo cliente aguardando ação","message":"O cliente está sem atividade futura.","target":"client_broker"}]'::jsonb,
    30,
    'minutes'
  ),
  (
    'Follow-up de simulação',
    'status_changed',
    '{"status":"simulation_sent"}'::jsonb,
    '[{"type":"status_equals","value":"simulation_sent"},{"type":"has_future_activity","value":false}]'::jsonb,
    '[{"type":"create_activity","activityType":"follow_up","note":"Realizar follow-up da simulação enviada.","target":"client_broker","offsetValue":0,"offsetUnit":"minutes"},{"type":"create_notification","title":"Follow-up de simulação","message":"A simulação enviada precisa de acompanhamento.","target":"client_broker"}]'::jsonb,
    4,
    'hours'
  ),
  (
    'Cliente sem atividade futura',
    'no_future_activity',
    '{}'::jsonb,
    '[{"type":"not_archived","value":true},{"type":"has_future_activity","value":false}]'::jsonb,
    '[{"type":"create_notification","title":"Cliente aguardando ação","message":"O cliente está sem atividade futura.","target":"client_broker"}]'::jsonb,
    0,
    'minutes'
  )
) as seed(name, trigger_type, trigger_config, condition_config, action_config, delay_value, delay_unit)
where not exists (
  select 1 from public.crm_automation_rules existing where lower(existing.name) = lower(seed.name)
);
