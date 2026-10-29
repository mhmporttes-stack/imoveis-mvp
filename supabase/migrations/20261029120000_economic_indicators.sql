-- Indicadores Econômicos (pedido do dono, 2026-10-29 — docs/BUSINESS_RULES.md ECON-1).
-- Séries oficiais (BCB SGS / Olinda, IBGE SIDRA) coletadas pelo cron /api/cron/economic-indicators (lib/economic-indicators.js).
-- Catálogo (nome, fonte, unidade) vive no código (lib/economic-indicators-core.mjs); aqui só valores e estado da coleta.
-- RLS ligado e SEM policy (padrão do projeto): só o service role do servidor lê/escreve.

create table if not exists public.econ_indicator_values (
  id bigint generated always as identity primary key,
  indicator_code text not null,
  reference_date date not null,
  value numeric not null,
  reference_label text,
  fetched_at timestamptz not null default now(),
  unique (indicator_code, reference_date)
);

create table if not exists public.econ_indicator_status (
  indicator_code text primary key,
  latest_reference date,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  consecutive_failures integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Taxas médias de juros por instituição (financiamento imobiliário), BCB Olinda TaxasJurosMensalPorMes.
create table if not exists public.econ_bank_rates (
  id bigint generated always as identity primary key,
  reference_month date not null,
  modality text not null,
  institution text not null,
  cnpj8 text not null,
  position integer,
  rate_month numeric,
  rate_year numeric not null,
  fetched_at timestamptz not null default now(),
  unique (reference_month, modality, cnpj8)
);

-- Preferência de alerta por usuário e indicador (sem linha = padrão do indicador).
create table if not exists public.econ_alert_preferences (
  user_id uuid not null references public.admin_users(id) on delete cascade,
  indicator_code text not null,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, indicator_code)
);

alter table public.econ_indicator_values enable row level security;
alter table public.econ_indicator_status enable row level security;
alter table public.econ_bank_rates enable row level security;
alter table public.econ_alert_preferences enable row level security;

-- Coleta diária às 18:30 de São Paulo (21:30 UTC): pega as divulgações do dia (IBGE 9h, BCB/FGV ao longo do dia).
-- Séries mensais só ganham linha quando sai período novo (UNIQUE acima). Idempotente: mesmo nome atualiza o job.
select cron.schedule(
  'economic-indicators-daily',
  '30 21 * * *',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/economic-indicators',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 55000
  );
  $$
);
