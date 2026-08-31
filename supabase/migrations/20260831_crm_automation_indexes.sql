create index if not exists crm_automation_executions_client_idx
  on public.crm_automation_executions (client_id);

create index if not exists crm_automation_rules_created_by_idx
  on public.crm_automation_rules (created_by)
  where created_by is not null;
