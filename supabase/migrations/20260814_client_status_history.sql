create extension if not exists pgcrypto;

create table if not exists public.client_status_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.simulation_registrations(id) on delete cascade,
  previous_status text,
  new_status text not null,
  changed_at timestamptz not null default now(),
  changed_by text
);

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'client_status_history_previous_status_check'
      and conrelid = 'public.client_status_history'::regclass
  ) then
    alter table public.client_status_history
    drop constraint client_status_history_previous_status_check;
  end if;

  if exists (
    select 1
    from pg_constraint
    where conname = 'client_status_history_new_status_check'
      and conrelid = 'public.client_status_history'::regclass
  ) then
    alter table public.client_status_history
    drop constraint client_status_history_new_status_check;
  end if;
end $$;

alter table public.client_status_history
add constraint client_status_history_previous_status_check
check (
  previous_status is null
  or previous_status in (
    'pending',
    'completed',
    'documentation_pending',
    'documents_pending',
    'approval_pending',
    'approved',
    'rejected',
    'sale_completed',
    'archived'
  )
);

alter table public.client_status_history
add constraint client_status_history_new_status_check
check (
  new_status in (
    'pending',
    'completed',
    'documentation_pending',
    'documents_pending',
    'approval_pending',
    'approved',
    'rejected',
    'sale_completed',
    'archived'
  )
);

create index if not exists client_status_history_client_id_idx
  on public.client_status_history (client_id);

create index if not exists client_status_history_changed_at_idx
  on public.client_status_history (changed_at desc);

create index if not exists client_status_history_new_status_changed_at_idx
  on public.client_status_history (new_status, changed_at desc);

insert into public.client_status_history (
  client_id,
  previous_status,
  new_status,
  changed_at,
  changed_by
)
select
  id,
  null,
  status,
  coalesce(last_status_change_at, updated_at, created_at, now()),
  last_admin_email
from public.simulation_registrations registrations
where status is not null
  and status <> 'pending'
  and not exists (
    select 1
    from public.client_status_history history
    where history.client_id = registrations.id
      and history.new_status = registrations.status
      and history.changed_at = coalesce(registrations.last_status_change_at, registrations.updated_at, registrations.created_at, now())
  );

alter table public.client_status_history enable row level security;
