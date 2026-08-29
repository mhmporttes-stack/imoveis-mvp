alter table public.simulation_registrations
add column if not exists scheduled_activity_completed_at timestamptz,
add column if not exists scheduled_activity_completed_by uuid references auth.users(id) on delete set null;

create index if not exists simulation_registrations_scheduled_activity_completed_at_idx
on public.simulation_registrations (scheduled_activity_completed_at)
where scheduled_activity_completed_at is not null;
