-- Alexa V2 (etapa 2): estrutura de snapshots diários + cache de métricas.
-- Genérico de propósito ("crm_"): o próprio CRM poderá usar para gráficos,
-- relatórios e comparações. Só a service role acessa (RLS ligado, sem policy).
--
-- crm_metric_snapshots  = histórico (um valor por dia/métrica/dimensão).
-- crm_metric_cache      = valores recentes e pesados (e travas de job).
-- crm_status_counts()   = contagem de clientes por status em UMA consulta
--                         (a regra de etapas continua no código).

create table if not exists public.crm_metric_snapshots (
  id bigint generated always as identity primary key,
  snapshot_date date not null,
  metric_key text not null,
  dimension_type text not null default 'team',
  dimension_key text not null default 'all',
  value_num numeric,
  value_json jsonb,
  definition_version smallint not null default 1,
  source text not null default 'cron',
  captured_at timestamptz not null default now(),
  constraint crm_metric_snapshots_unique unique (snapshot_date, metric_key, dimension_type, dimension_key)
);

create index if not exists crm_metric_snapshots_metric_date_idx
  on public.crm_metric_snapshots (metric_key, snapshot_date desc);

create table if not exists public.crm_metric_cache (
  cache_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  valid_until timestamptz,
  compute_ms integer,
  status text not null default 'ok',
  error_code text,
  updated_at timestamptz not null default now()
);

alter table public.crm_metric_snapshots enable row level security;
alter table public.crm_metric_cache enable row level security;
revoke all on public.crm_metric_snapshots from anon, authenticated;
revoke all on public.crm_metric_cache from anon, authenticated;
grant all on public.crm_metric_snapshots to service_role;
grant all on public.crm_metric_cache to service_role;

create or replace function public.crm_status_counts()
returns table (status text, total bigint)
language sql
stable
as $$
  select coalesce(status, '') as status, count(*)::bigint as total
  from public.simulation_registrations
  group by coalesce(status, '');
$$;

revoke all on function public.crm_status_counts() from public, anon, authenticated;
grant execute on function public.crm_status_counts() to service_role;

-- Jobs (mesmo padrão dos outros crons: GET autenticado com o token do Vault).
-- Horários em UTC (São Paulo = UTC-3):
--   atualização de cache a cada 5 min, 07:00-20:59 BRT, segunda a sábado;
--   a cada 30 min fora desse horário e aos domingos;
--   retrato do estoque às 23:55 BRT (02:55 UTC) e ajuste de fechamento às
--   00:10 BRT (03:10 UTC), depois do daily-goal-close das 00:01.
select cron.schedule(
  'crm-cache-refresh-business',
  '*/5 10-23 * * 1-6',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/crm-snapshots?mode=refresh',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);

select cron.schedule(
  'crm-cache-refresh-offhours',
  '*/30 0-9 * * *',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/crm-snapshots?mode=refresh',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);

select cron.schedule(
  'crm-cache-refresh-sunday',
  '*/30 10-23 * * 0',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/crm-snapshots?mode=refresh',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);

select cron.schedule(
  'crm-snapshot-stock-2355',
  '55 2 * * *',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/crm-snapshots?mode=stock',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);

select cron.schedule(
  'crm-snapshot-close-0010',
  '10 3 * * *',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/crm-snapshots?mode=close',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 50000
  );
  $$
);
