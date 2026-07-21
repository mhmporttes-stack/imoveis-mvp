create extension if not exists pgcrypto;

create table if not exists public.simulation_registrations (
  id uuid primary key default gen_random_uuid(),
  simulation_type text not null
    check (simulation_type in ('individual', 'joint')),
  full_name text not null
    check (length(nullif(btrim(full_name), '')) > 1),
  phone text not null,
  phone_normalized text not null
    check (phone_normalized ~ '^[0-9]{10,11}$'),
  oldest_birth_date date not null
    check (oldest_birth_date <= current_date),
  primary_income_type text not null
    check (primary_income_type in ('registered_employment', 'income_tax_declarant', 'self_employed_unregistered')),
  primary_profession text not null
    check (length(nullif(btrim(primary_profession), '')) > 1),
  primary_monthly_income numeric(14, 2) not null
    check (primary_monthly_income >= 0),
  secondary_income_type text
    check (
      secondary_income_type is null
      or secondary_income_type in ('registered_employment', 'income_tax_declarant', 'self_employed_unregistered')
    ),
  secondary_profession text,
  secondary_monthly_income numeric(14, 2)
    check (secondary_monthly_income is null or secondary_monthly_income >= 0),
  has_over_three_years_registered_work boolean not null,
  has_children_under_18 boolean not null,
  primary_marital_status text not null
    check (primary_marital_status in ('married', 'single', 'divorced', 'stable_union', 'widowed')),
  secondary_marital_status text
    check (
      secondary_marital_status is null
      or secondary_marital_status in ('married', 'single', 'divorced', 'stable_union', 'widowed')
    ),
  has_residential_property boolean not null,
  available_purchase_resource numeric(14, 2) not null default 0
    check (available_purchase_resource >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint simulation_registrations_secondary_fields_match_type check (
    (
      simulation_type = 'joint'
      and secondary_income_type is not null
      and length(nullif(btrim(secondary_profession), '')) > 1
      and secondary_monthly_income is not null
      and secondary_marital_status is not null
    )
    or
    (
      simulation_type = 'individual'
      and secondary_income_type is null
      and secondary_profession is null
      and secondary_monthly_income is null
      and secondary_marital_status is null
    )
  )
);

create index if not exists simulation_registrations_created_at_idx
  on public.simulation_registrations (created_at desc);

create index if not exists simulation_registrations_full_name_idx
  on public.simulation_registrations (full_name);

create index if not exists simulation_registrations_phone_normalized_idx
  on public.simulation_registrations (phone_normalized);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists simulation_registrations_set_updated_at on public.simulation_registrations;
create trigger simulation_registrations_set_updated_at
before update on public.simulation_registrations
for each row
execute function public.set_updated_at();

alter table public.simulation_registrations enable row level security;
