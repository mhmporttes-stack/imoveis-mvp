-- Fase 1 da integração Meta Ads (Gestão de Tráfego): apenas LEITURA.
-- Nenhuma tabela aqui é usada para criar/editar/pausar campanha na Meta —
-- isso só entra numa fase futura (traffic_action_proposals/traffic_action_log),
-- com aprovação explícita por proposta. Multi-conta desde já: ad_account_id
-- em toda tabela, mesmo com uma única conta configurada hoje (lib/meta-ads-config.js).

-- Metadados da conta de anúncios: moeda e timezone são necessários pra
-- interpretar corretamente os valores monetários e as datas de Insights
-- (a Meta reporta "date_start"/"date_stop" no fuso da própria conta, não em
-- America/Sao_Paulo por padrão).
create table if not exists public.meta_ad_accounts (
  ad_account_id text primary key,
  name text,
  currency text,
  timezone_name text,
  raw jsonb not null default '{}',
  last_synced_at timestamptz not null default now()
);

-- Cache dos objetos (campanha/conjunto/anúncio) — não é histórico, é o
-- estado mais recente conhecido de cada entidade. "targeting" só é
-- preenchido para adset (é lá que a Meta expõe geo_locations) — guardado
-- também dentro de "raw", mas como coluna própria facilita a auditoria
-- futura de localização (ver regra Marília/SP) sem reparsear jsonb aninhado.
create table if not exists public.meta_ad_entities (
  ad_account_id text not null references public.meta_ad_accounts(ad_account_id) on delete cascade,
  entity_type text not null check (entity_type in ('campaign', 'adset', 'ad')),
  entity_id text not null,
  parent_id text,
  name text not null,
  status text not null,
  objective text,
  targeting jsonb,
  raw jsonb not null default '{}',
  last_synced_at timestamptz not null default now(),
  primary key (ad_account_id, entity_type, entity_id)
);
create index if not exists meta_ad_entities_parent_idx on public.meta_ad_entities (ad_account_id, parent_id);
create index if not exists meta_ad_entities_status_idx on public.meta_ad_entities (ad_account_id, entity_type, status);

-- Série temporal de métricas — NUNCA tratar como imutável: a Meta ajusta
-- atribuição de conversão depois do fato, então esta tabela é sempre
-- UPSERT por (ad_account_id, entity_type, entity_id, date), nunca só INSERT.
-- date_start/date_stop replicam o período exato devolvido pela Meta (mesmo
-- sendo == date nesta fase, que usa sempre granularidade diária) para nunca
-- deixar o período ambíguo. "level"/"attribution_window" documentam a
-- origem exata de cada linha (nível consultado e janela de atribuição
-- usada na chamada) — nunca inferidos depois, sempre gravados no momento da sync.
--
-- Aditivas (podem ser somadas entre linhas quando fizer sentido): spend,
-- impressions, clicks, landing_page_views, leads.
-- NÃO aditivas (sempre vêm direto da API NESTE nível — nunca somadas de
-- entidades filhas): reach, frequency, cpm, ctr, cpc, cpl.
create table if not exists public.meta_ad_insights (
  ad_account_id text not null references public.meta_ad_accounts(ad_account_id) on delete cascade,
  entity_type text not null check (entity_type in ('campaign', 'adset', 'ad')),
  entity_id text not null,
  date date not null,
  date_start date not null,
  date_stop date not null,
  attribution_window text,
  spend numeric(14, 2) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  landing_page_views bigint not null default 0,
  leads bigint not null default 0,
  reach bigint,
  frequency numeric(10, 4),
  cpm numeric(10, 4),
  ctr numeric(10, 6),
  cpc numeric(10, 4),
  cpl numeric(10, 4),
  actions_raw jsonb not null default '[]',
  raw jsonb not null default '{}',
  synced_at timestamptz not null default now(),
  primary key (ad_account_id, entity_type, entity_id, date)
);
create index if not exists meta_ad_insights_date_idx on public.meta_ad_insights (ad_account_id, date);
create index if not exists meta_ad_insights_entity_idx on public.meta_ad_insights (ad_account_id, entity_type, entity_id);

-- Progresso de sincronização/backfill — por conta (nunca uma linha global
-- "default"), pra suportar múltiplas ad accounts no futuro sem refatorar.
create table if not exists public.meta_ad_sync_state (
  ad_account_id text primary key references public.meta_ad_accounts(ad_account_id) on delete cascade,
  backfill_started_at timestamptz,
  backfill_completed_through date,
  backfill_status text not null default 'not_started'
    check (backfill_status in ('not_started', 'in_progress', 'completed', 'failed')),
  last_intraday_sync_at timestamptz,
  last_intraday_status text,
  last_daily_consolidation_at timestamptz,
  last_daily_status text,
  updated_at timestamptz not null default now()
);

alter table public.meta_ad_accounts enable row level security;
alter table public.meta_ad_entities enable row level security;
alter table public.meta_ad_insights enable row level security;
alter table public.meta_ad_sync_state enable row level security;

revoke all on public.meta_ad_accounts, public.meta_ad_entities, public.meta_ad_insights, public.meta_ad_sync_state
  from anon, authenticated;
grant all on public.meta_ad_accounts, public.meta_ad_entities, public.meta_ad_insights, public.meta_ad_sync_state
  to service_role;
