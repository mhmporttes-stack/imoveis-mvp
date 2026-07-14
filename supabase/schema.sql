create table if not exists public.properties (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  builder text default '',
  location text default '',
  region text default '',
  status text default '',
  type text default 'apartamento' check (type in ('casa', 'apartamento', 'loteamento', 'condominio', 'terreno', 'chacara', 'casa-condominio')),
  price text default '',
  terms text default '',
  discounts text default '',
  installment_entry text default '',
  delivery text default '',
  area text default '',
  bedrooms text default '',
  features_json jsonb not null default '[]'::jsonb,
  photos_json jsonb not null default '[]'::jsonb,
  pdf_name text default '',
  pdf_data text default '',
  builder_url text default '',
  whatsapp text default '',
  instagram text default '',
  internal_notes text default '',
  sales_text text default '',
  is_published boolean not null default true,
  is_featured boolean not null default false,
  display_order integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists properties_published_created_idx
  on public.properties (is_published, created_at desc);

create index if not exists properties_cards_order_idx
  on public.properties (is_published, display_order, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists properties_set_updated_at on public.properties;

create trigger properties_set_updated_at
before update on public.properties
for each row
execute function public.set_updated_at();

alter table public.properties enable row level security;

drop policy if exists "Public can read published properties" on public.properties;

create policy "Public can read published properties"
on public.properties
for select
using (is_published = true);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  source text not null default 'homepage_modal',
  page_url text default '',
  created_at timestamptz not null default now()
);

alter table public.leads enable row level security;

create index if not exists leads_created_at_idx
  on public.leads (created_at desc);

create index if not exists leads_phone_created_at_idx
  on public.leads (phone, created_at desc);
