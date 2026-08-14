alter table public.simulation_registrations
add column if not exists status text not null default 'pending';

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'simulation_registrations_status_check'
      and conrelid = 'public.simulation_registrations'::regclass
  ) then
    alter table public.simulation_registrations
    drop constraint simulation_registrations_status_check;
  end if;
end $$;

alter table public.simulation_registrations
add constraint simulation_registrations_status_check
check (
  status in (
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

create index if not exists simulation_registrations_status_idx on public.simulation_registrations(status);
