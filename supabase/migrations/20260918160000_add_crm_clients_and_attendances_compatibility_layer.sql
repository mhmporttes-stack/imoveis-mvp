-- Compatibility layer for the client/attendance split.
-- Existing simulation_registrations remain the source of truth while modules
-- are migrated incrementally. This migration is intentionally non-destructive.

create table if not exists public.crm_clients (
  id uuid primary key default gen_random_uuid(),
  canonical_phone text not null,
  full_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_clients_canonical_phone_key unique (canonical_phone)
);

create table if not exists public.crm_attendances (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients(id) on delete restrict,
  legacy_registration_id uuid not null references public.simulation_registrations(id) on delete restrict,
  responsible_user_id uuid references public.admin_users(id) on delete set null,
  status text not null,
  source_kind text,
  source_label text,
  campaign_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint crm_attendances_legacy_registration_key unique (legacy_registration_id)
);

create index if not exists crm_attendances_client_idx on public.crm_attendances(client_id);
create index if not exists crm_attendances_responsible_idx on public.crm_attendances(responsible_user_id);
create index if not exists crm_attendances_status_idx on public.crm_attendances(status);

insert into public.crm_clients (canonical_phone, full_name, created_at, updated_at)
select distinct on (phone_normalized)
  phone_normalized, full_name, created_at, updated_at
from public.simulation_registrations
where phone_normalized is not null and phone_normalized <> ''
order by phone_normalized, created_at, id
on conflict (canonical_phone) do nothing;

insert into public.crm_attendances (
  client_id, legacy_registration_id, responsible_user_id, status,
  created_at, updated_at, closed_at
)
select
  c.id, r.id, r.responsible_user_id, r.status,
  r.created_at, r.updated_at,
  case when r.status in ('completed','sale_completed','archived','do_not_contact')
    then r.updated_at else null end
from public.simulation_registrations r
join public.crm_clients c on c.canonical_phone = r.phone_normalized
on conflict (legacy_registration_id) do nothing;
