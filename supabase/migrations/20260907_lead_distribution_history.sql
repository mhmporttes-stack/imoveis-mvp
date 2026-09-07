create table if not exists public.lead_distribution_history (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid references public.simulation_registrations(id) on delete set null,
  client_name text not null,
  event_type text not null check (event_type in ('assigned', 'auto_transferred')),
  from_user_id uuid references public.admin_users(id) on delete set null,
  to_user_id uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists lead_distribution_history_created_at_idx
  on public.lead_distribution_history (created_at desc);

alter table public.lead_distribution_history enable row level security;
revoke all on public.lead_distribution_history from anon, authenticated;
grant all on public.lead_distribution_history to service_role;

insert into public.lead_distribution_history (registration_id, client_name, event_type, to_user_id, created_at)
select id, full_name, 'assigned', responsible_user_id, created_at
from public.simulation_registrations
where distribution_type = 'round_robin'
  and responsible_user_id is not null;

insert into public.lead_distribution_history (registration_id, client_name, event_type, from_user_id, to_user_id, created_at)
select id, full_name, 'auto_transferred', previous_responsible_user_id, responsible_user_id, responsible_changed_at
from public.simulation_registrations
where distribution_type = 'round_robin'
  and previous_responsible_user_id is not null
  and responsible_user_id is not null
  and responsible_changed_at is not null;
