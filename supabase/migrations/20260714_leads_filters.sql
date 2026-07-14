alter table public.properties
  add column if not exists region text default '',
  add column if not exists status text default '',
  add column if not exists features_json jsonb not null default '[]'::jsonb,
  add column if not exists is_featured boolean not null default false,
  add column if not exists display_order integer default 0;

create index if not exists properties_cards_order_idx
  on public.properties (is_published, display_order, created_at desc);

alter table public.properties
  drop constraint if exists properties_type_check;

alter table public.properties
  add constraint properties_type_check
  check (type in ('casa', 'apartamento', 'loteamento', 'condominio', 'terreno', 'chacara', 'casa-condominio'));

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
