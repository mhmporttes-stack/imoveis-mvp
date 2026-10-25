-- whatsapp-dispatch-service — esquema inicial (schema próprio `wa_dispatch`, não colide com o CRM).
-- Aplicação: `npm run migrate` (registra em wa_dispatch.schema_migrations). No Supabase do CRM o arquivo
-- pode ser aplicado como está: RLS habilitado SEM policies públicas, igual ao resto do projeto; acesso só
-- pelo papel do serviço (DATABASE_URL), nunca por anon/authenticated.

create extension if not exists pgcrypto;

create schema if not exists wa_dispatch;

-- Instâncias (números) de WhatsApp. Quantidade livre: cada número é uma linha.
create table if not exists wa_dispatch.whatsapp_instances (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 2 and 80),
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  provider text not null check (provider in ('meta_cloud_api', 'crm_individual')),
  connection_type text not null check (connection_type in ('cloud_api', 'crm_individual_session')),
  -- Identificadores do provedor (phone_number_id, waba_id / crm_user_id). NUNCA tokens.
  provider_config jsonb not null default '{}'::jsonb,
  -- Nome da variável de ambiente que guarda o token deste número (o valor nunca vai para o banco).
  credential_ref text check (credential_ref is null or credential_ref ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  connection_state text not null default 'registered'
    check (connection_state in ('registered', 'verifying', 'connected', 'disconnected', 'reconnecting', 'error', 'not_configured')),
  profile_state text not null default 'not_started'
    check (profile_state in ('not_started', 'in_progress', 'completed', 'completed_with_limitations', 'failed')),
  operational_state text not null default 'inactive'
    check (operational_state in ('inactive', 'active', 'paused', 'suspended')),
  enabled boolean not null default false,
  daily_limit integer not null default 50 check (daily_limit >= 0),
  min_interval_seconds integer not null default 60 check (min_interval_seconds >= 0),
  -- {"days":[1,2,3,4,5],"start":"09:00","end":"18:00"} — dias ISO (1=segunda ... 7=domingo).
  send_window jsonb not null default '{"days":[1,2,3,4,5],"start":"09:00","end":"18:00"}'::jsonb,
  timezone text not null default 'America/Sao_Paulo',
  rotation_order integer not null default 0,
  -- Perfil desejado (nome comercial, recado, descrição, endereço, e-mail, sites/Instagram, categoria, URL da foto).
  profile_config jsonb not null default '{}'::jsonb,
  suspension_reason text,
  last_error text,
  last_error_at timestamptz,
  last_connected_at timestamptz,
  last_checked_at timestamptz,
  last_assigned_at timestamptz,
  last_success_send_at timestamptz,
  total_accepted bigint not null default 0,
  total_failed bigint not null default 0,
  total_delivered bigint not null default 0,
  total_read bigint not null default 0,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists whatsapp_instances_eligible_idx
  on wa_dispatch.whatsapp_instances (enabled, connection_state, operational_state, last_assigned_at);

-- Reserva diária por instância (contador persistente, atualização atômica).
create table if not exists wa_dispatch.instance_daily_usage (
  instance_id uuid not null references wa_dispatch.whatsapp_instances(id) on delete cascade,
  usage_date date not null,
  reserved integer not null default 0 check (reserved >= 0),
  accepted integer not null default 0 check (accepted >= 0),
  updated_at timestamptz not null default now(),
  primary key (instance_id, usage_date)
);

create table if not exists wa_dispatch.campaigns (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  name text not null,
  -- Finalidade do contato; o consentimento tem de cobrir exatamente esta finalidade.
  purpose text not null check (purpose ~ '^[a-z0-9_]{2,64}$'),
  message_type text not null default 'template' check (message_type in ('template', 'text')),
  template_name text,
  template_language text,
  -- Parâmetros fixos do template (components da Cloud API), sem dado pessoal.
  template_components jsonb not null default '[]'::jsonb,
  text_body text,
  enabled boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (message_type <> 'template' or (template_name is not null and template_language is not null)),
  check (message_type <> 'text' or text_body is not null)
);

create table if not exists wa_dispatch.leads (
  id uuid primary key default gen_random_uuid(),
  crm_lead_id text not null check (length(crm_lead_id) between 1 and 100),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  campaign_id uuid not null references wa_dispatch.campaigns(id) on delete restrict,
  consent_reference text not null check (length(consent_reference) between 1 and 200),
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 200),
  status text not null default 'received'
    check (status in ('received', 'authorized', 'rejected', 'cancelled', 'completed')),
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (crm_lead_id, campaign_id)
);
create index if not exists leads_phone_idx on wa_dispatch.leads (phone_e164);

create table if not exists wa_dispatch.consent_records (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references wa_dispatch.leads(id) on delete set null,
  crm_lead_id text,
  phone_e164 text not null,
  purpose text not null,
  state text not null check (state in ('granted', 'denied', 'revoked', 'unverifiable')),
  origin text not null,           -- de onde veio (ex.: formulario_simulacao)
  verifier text not null,         -- quem validou (crm-db, crm-http, api_revogacao)
  evidence_ref text,              -- referência verificável (ex.: simulation_registrations:<uuid>)
  consented_at timestamptz,       -- data do consentimento na fonte
  verified_at timestamptz not null default now(),
  revoked_at timestamptz,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists consent_records_phone_purpose_idx
  on wa_dispatch.consent_records (phone_e164, purpose, verified_at desc);

-- Lista de não contato. Nunca é apagada: desativação só com motivo e responsável (trigger abaixo bloqueia DELETE).
create table if not exists wa_dispatch.suppression_list (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  reason text not null,
  source text not null,
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  deactivated_by text,
  deactivation_reason text,
  check (active or (deactivated_at is not null and deactivated_by is not null and deactivation_reason is not null))
);

create or replace function wa_dispatch.block_suppression_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'suppression_list não pode ser apagada: use a desativação com motivo (auditada).';
end;
$$;
drop trigger if exists suppression_list_no_delete on wa_dispatch.suppression_list;
create trigger suppression_list_no_delete before delete on wa_dispatch.suppression_list
  for each row execute function wa_dispatch.block_suppression_delete();
drop trigger if exists suppression_list_no_truncate on wa_dispatch.suppression_list;
create trigger suppression_list_no_truncate before truncate on wa_dispatch.suppression_list
  for each statement execute function wa_dispatch.block_suppression_delete();

create table if not exists wa_dispatch.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references wa_dispatch.leads(id) on delete restrict,
  campaign_id uuid not null references wa_dispatch.campaigns(id) on delete restrict,
  instance_id uuid references wa_dispatch.whatsapp_instances(id) on delete restrict,
  phone_e164 text not null,
  status text not null default 'requested' check (status in (
    'requested',                    -- pedido recebido, aguardando autorização
    'scheduled',                    -- autorizado, aguardando instância/horário
    'queued',                       -- instância reservada, trabalho na fila
    'sending',                      -- chamada ao provedor em andamento
    'accepted',                     -- provedor aceitou (não é entrega)
    'delivered', 'read', 'replied', -- confirmações reais do provedor/cliente
    'unknown_pending_verification', -- resultado desconhecido: verificar antes de qualquer reenvio
    'unknown_needs_review',         -- não foi possível verificar: decisão humana, nunca reenvio automático
    'failed', 'cancelled')),
  reserved_usage_date date,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  provider_message_id text unique,
  pacing_status text,
  requested_at timestamptz not null default now(),
  authorized_at timestamptz,
  queued_at timestamptz,
  sending_started_at timestamptz,
  sending_lock_expires_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  last_error_code text,
  last_error_message text,
  cancel_reason text,
  processing_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists outbound_messages_status_due_idx on wa_dispatch.outbound_messages (status, next_attempt_at);
create index if not exists outbound_messages_phone_idx on wa_dispatch.outbound_messages (phone_e164);
create index if not exists outbound_messages_instance_idx on wa_dispatch.outbound_messages (instance_id, status);
create index if not exists outbound_messages_campaign_idx on wa_dispatch.outbound_messages (campaign_id);

create table if not exists wa_dispatch.message_events (
  id bigint generated always as identity primary key,
  outbound_message_id uuid references wa_dispatch.outbound_messages(id) on delete cascade,
  instance_id uuid references wa_dispatch.whatsapp_instances(id) on delete set null,
  event_type text not null,
  status text,
  attempt integer,
  provider_message_id text,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists message_events_message_idx on wa_dispatch.message_events (outbound_message_id, id);
create index if not exists message_events_type_idx on wa_dispatch.message_events (event_type, created_at desc);

create table if not exists wa_dispatch.onboarding_runs (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references wa_dispatch.whatsapp_instances(id) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'completed', 'completed_with_limitations', 'failed')),
  desired_profile jsonb not null,
  -- [{key, required, state: pending|confirmed|failed|unsupported, attempts, response, error, limitation, updated_at}]
  steps jsonb not null default '[]'::jsonb,
  attempts integer not null default 0,
  last_error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists onboarding_runs_instance_idx on wa_dispatch.onboarding_runs (instance_id, started_at desc);
create unique index if not exists onboarding_runs_one_running_idx
  on wa_dispatch.onboarding_runs (instance_id) where status = 'running';

create table if not exists wa_dispatch.webhook_events (
  id bigint generated always as identity primary key,
  provider text not null,
  dedupe_key text not null unique,     -- sha256 do corpo bruto: o mesmo corpo reenviado (replay) não é reprocessado
  signature_valid boolean not null,
  event_kind text,
  instance_id uuid references wa_dispatch.whatsapp_instances(id) on delete set null,
  summary jsonb not null default '{}'::jsonb,  -- só ids/estados; sem texto de mensagem
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

create table if not exists wa_dispatch.audit_logs (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_entity_idx on wa_dispatch.audit_logs (entity_type, entity_id, created_at desc);
create index if not exists audit_logs_created_idx on wa_dispatch.audit_logs (created_at desc);

-- RLS habilitado sem policies públicas (padrão do projeto). O serviço conecta com papel próprio/owner.
do $$
declare t text;
begin
  foreach t in array array['whatsapp_instances','instance_daily_usage','campaigns','leads','consent_records',
    'suppression_list','outbound_messages','message_events','onboarding_runs','webhook_events','audit_logs']
  loop
    execute format('alter table wa_dispatch.%I enable row level security', t);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema wa_dispatch from anon';
    execute 'revoke all on all tables in schema wa_dispatch from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema wa_dispatch from authenticated';
    execute 'revoke all on all tables in schema wa_dispatch from authenticated';
  end if;
end $$;
