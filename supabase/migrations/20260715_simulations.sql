create table if not exists public.simulations (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  simulation_type text not null default 'novo'
    check (simulation_type in ('novo', 'usado')),
  financing_value numeric(14, 2) not null default 0,
  subsidy_value numeric(14, 2) not null default 0,
  first_installment numeric(14, 2) default 0,
  last_installment numeric(14, 2) default 0,
  down_payment_value numeric(14, 2) default 0,
  fgts_value numeric(14, 2) default 0,
  total_purchase_power numeric(14, 2) not null default 0,
  expanded_purchase_power numeric(14, 2) not null default 0,
  show_expanded_power boolean not null default false,
  simulation_date date not null default current_date,
  public_note text default '',
  internal_note text default '',
  output_mode text not null default 'individual'
    check (output_mode in ('individual', 'comparativo')),
  created_by text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.simulation_properties (
  id uuid primary key default gen_random_uuid(),
  simulation_id uuid not null references public.simulations(id) on delete cascade,
  property_id text references public.properties(id) on delete set null,
  display_order integer not null default 0,
  custom_name text default '',
  custom_price text default '',
  custom_location text default '',
  custom_type text default '',
  custom_area text default '',
  custom_bedrooms text default '',
  custom_builder text default '',
  custom_delivery text default '',
  custom_terms text default '',
  custom_discounts text default '',
  custom_sales_text text default '',
  recommendation_reason text default '',
  image_url text default '',
  layout_mode text not null default 'individual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.simulation_property_benefits (
  id uuid primary key default gen_random_uuid(),
  simulation_property_id uuid not null references public.simulation_properties(id) on delete cascade,
  benefit_text text not null,
  display_order integer not null default 0,
  is_custom boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists simulations_created_at_idx
  on public.simulations (created_at desc);

create index if not exists simulations_client_name_idx
  on public.simulations using gin (to_tsvector('portuguese', client_name));

create index if not exists simulation_properties_simulation_idx
  on public.simulation_properties (simulation_id, display_order);

create index if not exists simulation_benefits_property_idx
  on public.simulation_property_benefits (simulation_property_id, display_order);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists simulations_set_updated_at on public.simulations;
create trigger simulations_set_updated_at
before update on public.simulations
for each row
execute function public.set_updated_at();

drop trigger if exists simulation_properties_set_updated_at on public.simulation_properties;
create trigger simulation_properties_set_updated_at
before update on public.simulation_properties
for each row
execute function public.set_updated_at();

alter table public.simulations enable row level security;
alter table public.simulation_properties enable row level security;
alter table public.simulation_property_benefits enable row level security;
