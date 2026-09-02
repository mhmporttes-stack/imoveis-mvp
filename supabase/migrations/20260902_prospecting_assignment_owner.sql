alter table public.simulation_registrations
  add column if not exists prospecting_assigned_by_user_id uuid references public.admin_users(id) on delete set null;

create index if not exists simulation_registrations_prospecting_assigned_by_idx
  on public.simulation_registrations(prospecting_assigned_by_user_id)
  where prospecting_assigned_by_user_id is not null;

update public.simulation_registrations as registration
set prospecting_assigned_by_user_id = assignment.user_id
from (
  select distinct on (registration_id) registration_id, user_id
  from public.prospecting_history
  where event_type = 'bulk_assigned' and registration_id is not null and user_id is not null
  order by registration_id, created_at desc
) as assignment
where registration.id = assignment.registration_id
  and registration.prospecting_assigned_by_user_id is null;
