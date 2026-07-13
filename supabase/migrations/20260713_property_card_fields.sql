alter table public.properties
  add column if not exists region text default '',
  add column if not exists status text default '',
  add column if not exists features_json jsonb not null default '[]'::jsonb,
  add column if not exists is_featured boolean not null default false,
  add column if not exists display_order integer default 0;

create index if not exists properties_cards_order_idx
  on public.properties (is_published, display_order, created_at desc);
