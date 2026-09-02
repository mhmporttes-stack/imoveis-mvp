alter table public.simulation_registrations
  add column if not exists prospecting_assigned_pending boolean not null default false;

