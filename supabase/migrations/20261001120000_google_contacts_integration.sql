-- Integração Google Contacts por corretor (pedido do dono, 2026-10-01) —
-- antes de um disparo automático da Meta Diária, salva o cliente na agenda
-- Google do corretor responsável. Opt-in por corretor, paralela ao WhatsApp
-- individual (nunca toca em whatsapp_individual_sessions nem nas tabelas da
-- automação). Migration só ADITIVA — nenhuma estrutura existente é alterada.

-- Conexão OAuth do corretor com o Google (1 por corretor). Tokens sempre
-- cifrados (AES-256-GCM, mesmo padrão já usado para as credenciais do
-- Baileys em whatsapp-individual-service/src/crypto.js) — nunca em texto
-- puro. access_token é opcional (só cache de curta duração; sempre
-- renovável via refresh_token).
create table if not exists public.google_contacts_connections (
  broker_id uuid primary key references public.admin_users(id) on delete cascade,
  google_account_email text,
  google_account_id text,
  encrypted_refresh_token text,
  encrypted_access_token text,
  access_token_expires_at timestamptz,
  scopes text,
  status text not null default 'disconnected' check (status in ('disconnected', 'connected', 'expired', 'error')),
  sync_enabled boolean not null default false,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Mapa broker+cliente -> contato já criado no Google (fonte da verdade LOCAL
-- pra nunca duplicar contato nem depender da busca instável do Google logo
-- após criar). unique(broker_id, normalized_phone) garante 1 contato por
-- corretor+telefone, mesmo com tentativas concorrentes (upsert atômico).
create table if not exists public.google_contact_sync (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.admin_users(id) on delete cascade,
  client_id uuid references public.simulation_registrations(id) on delete set null,
  normalized_phone text not null,
  google_resource_name text,
  google_contact_id text,
  sync_status text not null default 'pending' check (sync_status in ('pending', 'syncing', 'synced', 'failed')),
  synced_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (broker_id, normalized_phone)
);

create index if not exists google_contact_sync_client_idx on public.google_contact_sync (client_id);
create index if not exists google_contact_sync_status_idx on public.google_contact_sync (broker_id, sync_status);

alter table public.google_contacts_connections enable row level security;
alter table public.google_contact_sync enable row level security;

revoke all on public.google_contacts_connections from anon, authenticated;
revoke all on public.google_contact_sync from anon, authenticated;

grant all on public.google_contacts_connections to service_role;
grant all on public.google_contact_sync to service_role;

-- Flag global (pedido do dono: "google_contacts_enabled GLOBALMENTE
-- disponível") — mesmo padrão já usado em crm_settings (ex.:
-- daily_goal_auto_defaults). Disponível por padrão; corretor continua
-- precisando conectar a própria conta E ligar sync_enabled individualmente.
insert into public.crm_settings (id, setting_value)
values ('google_contacts_global', '{"enabled": true}'::jsonb)
on conflict (id) do nothing;
