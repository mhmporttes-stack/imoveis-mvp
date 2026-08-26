alter table public.simulation_registrations
add column if not exists scheduled_activity_notified_at timestamptz;

create index if not exists simulation_registrations_scheduled_activity_due_idx
  on public.simulation_registrations (scheduled_activity_at, scheduled_activity_notified_at)
  where scheduled_activity_at is not null;
