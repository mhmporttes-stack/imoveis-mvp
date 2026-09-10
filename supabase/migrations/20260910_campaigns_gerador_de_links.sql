-- Gerador de Links: campanhas de anúncio com rastreio de origem permanente.
-- Ver docs/spec-gerador-de-links.md para a especificação completa.

create extension if not exists pgcrypto;

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null
    check (length(nullif(btrim(name), '')) > 1),
  destination_type text not null
    check (destination_type in ('roulette', 'broker')),
  broker_id uuid references public.admin_users(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_broker_id_matches_destination check (
    (destination_type = 'broker' and broker_id is not null)
    or (destination_type = 'roulette' and broker_id is null)
  )
);

create index if not exists campaigns_status_idx on public.campaigns (status);
create index if not exists campaigns_created_at_idx on public.campaigns (created_at desc);
create index if not exists campaigns_broker_id_idx on public.campaigns (broker_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at
before update on public.campaigns
for each row
execute function public.set_updated_at();

alter table public.campaigns enable row level security;
revoke all on public.campaigns from anon, authenticated;
grant all on public.campaigns to service_role;

-- Origem do cadastro: registrada uma vez, no momento do cadastro, e nunca
-- reprocessada — preserva o histórico mesmo que a campanha seja renomeada,
-- desativada ou (no futuro) apagada.
create table if not exists public.client_origins (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.simulation_registrations(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  campaign_name_snapshot text not null,
  created_at timestamptz not null default now()
);

create index if not exists client_origins_client_id_idx on public.client_origins (client_id);
create index if not exists client_origins_campaign_id_idx on public.client_origins (campaign_id);

alter table public.client_origins enable row level security;
revoke all on public.client_origins from anon, authenticated;
grant all on public.client_origins to service_role;
