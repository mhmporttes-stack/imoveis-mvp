-- Publicador do Facebook Marketplace (pedido do dono, 2026-10-20 — MKT-1): fila de anúncios de imóveis que a extensão do
-- Chrome no computador do dono publica sozinha. Só entra na fila (approved_at preenchido) o anúncio que o dono aprovou
-- na tela /admin/marketplace; editar o anúncio tira a aprovação. A chave da extensão fica só em hash em
-- crm_settings (id 'marketplace_publisher'), sem tabela própria. RLS ligado sem policy (acesso só pelo servidor).
-- Idempotente. O código funciona sem esta tabela (a tela avisa que a migration não foi aplicada).

create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  property_id text references public.properties(id) on delete set null,
  title text not null,
  price numeric(14, 2) not null check (price > 0),
  description text not null default '',
  offer_type text not null default 'sale' check (offer_type in ('sale', 'rent')),
  property_type text not null default 'house' check (property_type in ('house', 'apartment', 'townhouse', 'land')),
  bedrooms integer check (bedrooms is null or bedrooms between 0 and 20),
  bathrooms integer check (bathrooms is null or bathrooms between 0 and 20),
  area_m2 numeric(10, 2) check (area_m2 is null or area_m2 > 0),
  city text not null default 'Marília',
  state text not null default 'SP',
  neighborhood text not null default '',
  photo_urls jsonb not null default '[]'::jsonb check (jsonb_typeof(photo_urls) = 'array'),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'published', 'failed', 'cancelled')),
  approved_by uuid references public.admin_users(id) on delete set null,
  approved_at timestamptz,
  claimed_at timestamptz,
  published_at timestamptz,
  marketplace_url text,
  error text,
  attempts integer not null default 0 check (attempts >= 0),
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_listings_queue_idx on public.marketplace_listings (status, approved_at) where approved_at is not null;
create index if not exists marketplace_listings_created_idx on public.marketplace_listings (created_at desc);

alter table public.marketplace_listings enable row level security;
