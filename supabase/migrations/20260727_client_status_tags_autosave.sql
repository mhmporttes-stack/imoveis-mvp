alter table public.simulation_registrations
add column if not exists status text not null default 'pending',
add column if not exists approved_at timestamptz,
add column if not exists last_status_change_at timestamptz;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'simulation_registrations_phone_normalized_check'
  ) then
    alter table public.simulation_registrations
    drop constraint simulation_registrations_phone_normalized_check;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'simulation_registrations_status_check'
  ) then
    alter table public.simulation_registrations
    add constraint simulation_registrations_status_check
    check (status in ('pending', 'completed', 'approved'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'simulation_registrations_phone_normalized_compat_check'
  ) then
    alter table public.simulation_registrations
    add constraint simulation_registrations_phone_normalized_compat_check
    check (
      phone_normalized ~ '^\+55[0-9]{11}$'
      or phone_normalized ~ '^[0-9]{10,11}$'
    );
  end if;
end $$;

alter table public.simulations
add column if not exists registration_id uuid references public.simulation_registrations(id) on delete set null,
add column if not exists autosave_updated_at timestamptz;

create index if not exists simulations_registration_id_idx on public.simulations(registration_id);
create index if not exists simulation_registrations_status_idx on public.simulation_registrations(status);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  color text not null default '#0D4F8B',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_tags (
  client_id uuid not null references public.simulation_registrations(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, tag_id)
);

create index if not exists client_tags_client_id_idx on public.client_tags(client_id);
create index if not exists client_tags_tag_id_idx on public.client_tags(tag_id);

alter table public.tags enable row level security;
alter table public.client_tags enable row level security;

drop policy if exists "No public tag access" on public.tags;
drop policy if exists "No public client tag access" on public.client_tags;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'tags_set_updated_at'
  ) then
    create trigger tags_set_updated_at
    before update on public.tags
    for each row
    execute function public.set_updated_at();
  end if;
end $$;
