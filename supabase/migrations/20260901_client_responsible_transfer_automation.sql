alter table public.simulation_registrations
  add column if not exists previous_responsible_user_id uuid references public.admin_users(id) on delete set null,
  add column if not exists responsible_changed_at timestamptz;

create index if not exists simulation_registrations_responsible_changed_at_idx
  on public.simulation_registrations (responsible_changed_at desc)
  where responsible_changed_at is not null;
