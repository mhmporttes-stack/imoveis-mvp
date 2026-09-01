alter table public.admin_users drop constraint if exists admin_users_role_check;

alter table public.admin_users
  add constraint admin_users_role_check check (role in ('admin', 'broker', 'associate'));

alter table public.admin_users
  add column if not exists linked_broker_id uuid references public.admin_users(id) on delete set null;

create index if not exists admin_users_linked_broker_id_idx
  on public.admin_users (linked_broker_id);

alter table public.admin_users drop constraint if exists admin_users_associate_broker_check;

alter table public.admin_users
  add constraint admin_users_associate_broker_check check (
    role = 'associate' or linked_broker_id is null
  );
