create table if not exists public.calendar_activities (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.simulation_registrations(id) on delete set null,
  responsible_user_id uuid references public.admin_users(id) on delete set null,
  title text not null,
  activity_type text not null default 'outro',
  scheduled_at timestamptz not null,
  note text,
  priority text check (priority is null or priority in ('standard', 'important', 'priority')),
  status text not null default 'pending' check (status in ('pending', 'completed', 'rescheduled')),
  completed_at timestamptz,
  rescheduled_from_id uuid references public.calendar_activities(id) on delete set null,
  rescheduled_to_id uuid references public.calendar_activities(id) on delete set null,
  rescheduled_to_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calendar_activities_scheduled_at_idx on public.calendar_activities (scheduled_at);
create index if not exists calendar_activities_responsible_idx on public.calendar_activities (responsible_user_id, scheduled_at);
create index if not exists calendar_activities_client_idx on public.calendar_activities (client_id);

alter table public.calendar_activities enable row level security;
revoke all on public.calendar_activities from anon, authenticated;
grant all on public.calendar_activities to service_role;
