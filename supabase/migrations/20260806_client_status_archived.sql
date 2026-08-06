alter table public.simulation_registrations
add column if not exists status text not null default 'pending',
add column if not exists approved_at timestamptz,
add column if not exists last_status_change_at timestamptz;

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
check (status in ('pending', 'completed', 'documentation_pending', 'approved', 'archived'));

create index if not exists simulation_registrations_status_idx on public.simulation_registrations(status);
