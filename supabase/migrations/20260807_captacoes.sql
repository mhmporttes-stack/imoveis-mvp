create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.captacoes (
  id uuid primary key default gen_random_uuid(),
  owner_name text not null,
  owner_phone text not null default '',
  owner_email text not null default '',
  property_type text not null,
  property_type_other text not null default '',
  street text not null default '',
  number text not null default '',
  neighborhood text not null default '',
  city text not null default 'Marilia',
  state text not null default 'SP',
  intended_price numeric(14,2),
  requests_evaluation boolean not null default false,
  sale_timeline text not null default '',
  exchange_acceptance text not null default '',
  current_situation text not null default '',
  sale_reason text not null default '',
  notes text not null default '',
  details_json jsonb not null default '{}'::jsonb,
  photos_json jsonb not null default '[]'::jsonb,
  status text not null default 'nova',
  property_id uuid null references public.properties(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint captacoes_property_type_check check (
    property_type in ('casa', 'apartamento', 'terreno', 'chacara', 'sala_comercial', 'outro')
  ),
  constraint captacoes_status_check check (
    status in ('nova', 'em_analise', 'aguardando_contato', 'avaliada', 'aprovada_publicacao', 'publicada', 'nao_captada')
  ),
  constraint captacoes_price_non_negative check (intended_price is null or intended_price >= 0)
);

alter table public.properties
add column if not exists captacao_id uuid references public.captacoes(id) on delete set null;

create index if not exists captacoes_created_at_idx on public.captacoes(created_at desc);
create index if not exists captacoes_status_idx on public.captacoes(status);
create index if not exists captacoes_property_type_idx on public.captacoes(property_type);
create index if not exists captacoes_city_idx on public.captacoes(city);
create index if not exists captacoes_owner_name_idx on public.captacoes(owner_name);
create index if not exists properties_captacao_id_idx on public.properties(captacao_id);

alter table public.captacoes enable row level security;

drop trigger if exists captacoes_set_updated_at on public.captacoes;
create trigger captacoes_set_updated_at
before update on public.captacoes
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on table public.captacoes to authenticated;
grant insert on table public.captacoes to anon;
