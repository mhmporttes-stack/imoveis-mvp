alter table public.properties
add column if not exists is_development boolean not null default false;

update public.properties p
set is_development = true
where exists (select 1 from public.empreendimentos e where e.id = p.id);

create index if not exists properties_development_order_idx
on public.properties (is_development, display_order, created_at desc);
