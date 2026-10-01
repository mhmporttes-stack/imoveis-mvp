-- Rotina "Chegada ao escritório" da Alexa.
-- routines: configuração das rotinas (dentro de alexa_settings).
-- alexa_arrival_state: estado único da rotina. Guarda só o HASH da chave do
-- iPhone (a chave em si aparece uma única vez no painel e nunca é salva).

alter table public.alexa_settings
  add column if not exists routines jsonb not null default '{}'::jsonb;

create table if not exists public.alexa_arrival_state (
  id integer primary key default 1 check (id = 1),
  token_hash text,
  token_created_at timestamptz,
  owner_user_id uuid references public.admin_users(id) on delete set null,
  last_ping_at timestamptz,
  last_arrival_date date,
  pending_run_at timestamptz,
  last_run_at timestamptz,
  last_run_status text,
  updated_at timestamptz not null default now()
);

insert into public.alexa_arrival_state (id) values (1) on conflict (id) do nothing;

alter table public.alexa_arrival_state enable row level security;
revoke all on public.alexa_arrival_state from anon, authenticated;
grant all on public.alexa_arrival_state to service_role;
