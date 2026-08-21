create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text not null,
  phone text not null default '',
  role text not null default 'broker',
  status text not null default 'active',
  simulation_ref text not null default lower(encode(gen_random_bytes(9), 'hex')),
  captacao_ref text not null default lower(encode(gen_random_bytes(9), 'hex')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  constraint admin_users_role_check check (role in ('admin', 'broker')),
  constraint admin_users_status_check check (status in ('active', 'inactive'))
);

create unique index if not exists admin_users_email_unique
  on public.admin_users (lower(email));

create unique index if not exists admin_users_auth_user_id_unique
  on public.admin_users (auth_user_id)
  where auth_user_id is not null;

create unique index if not exists admin_users_simulation_ref_unique
  on public.admin_users (simulation_ref);

create unique index if not exists admin_users_captacao_ref_unique
  on public.admin_users (captacao_ref);

create index if not exists admin_users_role_status_idx
  on public.admin_users (role, status);

insert into public.admin_users (auth_user_id, name, email, phone, role, status, simulation_ref, captacao_ref)
select u.id, 'Matheus Machado', 'mhmporttes@gmail.com', '', 'admin', 'active', 'matheus', 'matheus-captacao'
from auth.users u
where lower(u.email) = 'mhmporttes@gmail.com'
  and not exists (
    select 1 from public.admin_users existing
    where lower(existing.email) = 'mhmporttes@gmail.com'
  );

insert into public.admin_users (name, email, phone, role, status, simulation_ref, captacao_ref)
select 'Matheus Machado', 'mhmporttes@gmail.com', '', 'admin', 'active', 'matheus', 'matheus-captacao'
where not exists (
  select 1 from public.admin_users existing
  where lower(existing.email) = 'mhmporttes@gmail.com'
);

insert into public.admin_users (auth_user_id, name, email, phone, role, status, simulation_ref, captacao_ref)
select u.id, 'Benck', 'forbencke@gmail.com', '', 'broker', 'active', 'benck', 'benck-captacao'
from auth.users u
where lower(u.email) = 'forbencke@gmail.com'
  and not exists (
    select 1 from public.admin_users existing
    where lower(existing.email) = 'forbencke@gmail.com'
  );

insert into public.admin_users (name, email, phone, role, status, simulation_ref, captacao_ref)
select 'Benck', 'forbencke@gmail.com', '', 'broker', 'active', 'benck', 'benck-captacao'
where not exists (
  select 1 from public.admin_users existing
  where lower(existing.email) = 'forbencke@gmail.com'
);

update public.admin_users
set
  name = coalesce(nullif(name, ''), 'Matheus Machado'),
  role = 'admin',
  status = 'active',
  simulation_ref = 'matheus',
  captacao_ref = 'matheus-captacao',
  disabled_at = null,
  updated_at = now()
where lower(email) = 'mhmporttes@gmail.com';

update public.admin_users
set
  name = coalesce(nullif(name, ''), 'Matheus Machado'),
  role = 'admin',
  status = 'active',
  simulation_ref = 'matheus-icloud',
  captacao_ref = 'matheus-icloud-captacao',
  disabled_at = null,
  updated_at = now()
where lower(email) = 'mhmporttes@icloud.com';

update public.admin_users
set
  name = coalesce(nullif(name, ''), 'Benck'),
  role = 'broker',
  status = 'active',
  simulation_ref = 'benck',
  captacao_ref = 'benck-captacao',
  disabled_at = null,
  updated_at = now()
where lower(email) = 'forbencke@gmail.com';

update public.admin_users admin_user
set auth_user_id = auth_user.id
from auth.users auth_user
where admin_user.auth_user_id is null
  and lower(admin_user.email) = lower(auth_user.email);

alter table if exists public.simulation_registrations
  add column if not exists responsible_user_id uuid references public.admin_users(id) on delete set null;

alter table if exists public.captacoes
  add column if not exists responsible_user_id uuid references public.admin_users(id) on delete set null;

alter table if exists public.properties
  add column if not exists created_by_user_id uuid references public.admin_users(id) on delete set null;

alter table if exists public.simulations
  add column if not exists created_by_user_id uuid references public.admin_users(id) on delete set null;

create index if not exists simulation_registrations_responsible_user_id_idx
  on public.simulation_registrations (responsible_user_id);

create index if not exists captacoes_responsible_user_id_idx
  on public.captacoes (responsible_user_id);

create index if not exists properties_created_by_user_id_idx
  on public.properties (created_by_user_id);

create index if not exists simulations_created_by_user_id_idx
  on public.simulations (created_by_user_id);

drop trigger if exists admin_users_set_updated_at on public.admin_users;

create trigger admin_users_set_updated_at
before update on public.admin_users
for each row
execute function public.set_updated_at();

alter table public.admin_users enable row level security;

drop policy if exists "Admin users are managed by service role" on public.admin_users;

create policy "Admin users are managed by service role"
on public.admin_users
for all
using (false)
with check (false);
