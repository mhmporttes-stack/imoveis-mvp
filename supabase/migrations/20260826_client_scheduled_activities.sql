alter table public.simulation_registrations
add column if not exists scheduled_activity_at timestamptz,
add column if not exists scheduled_activity_note text;

create index if not exists simulation_registrations_scheduled_activity_at_idx
  on public.simulation_registrations (scheduled_activity_at)
  where scheduled_activity_at is not null;
