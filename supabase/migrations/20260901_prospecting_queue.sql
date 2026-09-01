create table if not exists public.prospecting_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone_normalized text not null unique,
  status text not null default 'available' check (status in ('available', 'claimed', 'recent_attempt', 'do_not_contact')),
  assigned_user_id uuid references public.admin_users(id) on delete set null,
  registration_id uuid references public.simulation_registrations(id) on delete set null,
  last_broker_id uuid references public.admin_users(id) on delete set null,
  last_attempt_at timestamptz,
  available_after timestamptz,
  do_not_contact_by uuid references public.admin_users(id) on delete set null,
  do_not_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prospecting_history (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.prospecting_contacts(id) on delete cascade,
  registration_id uuid references public.simulation_registrations(id) on delete set null,
  user_id uuid references public.admin_users(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.simulation_registrations
  add column if not exists prospecting_contact_id uuid references public.prospecting_contacts(id) on delete set null;

create index if not exists prospecting_contacts_status_available_idx on public.prospecting_contacts(status, available_after);
create index if not exists prospecting_contacts_assigned_user_idx on public.prospecting_contacts(assigned_user_id) where assigned_user_id is not null;
create index if not exists prospecting_history_contact_created_idx on public.prospecting_history(contact_id, created_at desc);
create index if not exists simulation_registrations_prospecting_contact_idx on public.simulation_registrations(prospecting_contact_id) where prospecting_contact_id is not null;

alter table public.prospecting_contacts enable row level security;
alter table public.prospecting_history enable row level security;
revoke all on public.prospecting_contacts from anon, authenticated;
revoke all on public.prospecting_history from anon, authenticated;
grant all on public.prospecting_contacts to service_role;
grant all on public.prospecting_history to service_role;

alter table public.simulation_registrations drop constraint if exists simulation_registrations_status_check;
alter table public.simulation_registrations add constraint simulation_registrations_status_check check (
  status in (
    'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
    'documentation_pending', 'documents_pending', 'approval_pending', 'restriction', 'shielding',
    'approved', 'rejected', 'sale_completed', 'sale_forms', 'sale_reservation',
    'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'archived'
  )
);

alter table public.client_status_history drop constraint if exists client_status_history_previous_status_check;
alter table public.client_status_history drop constraint if exists client_status_history_new_status_check;
alter table public.client_status_history add constraint client_status_history_previous_status_check check (
  previous_status is null or previous_status in (
    'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
    'documentation_pending', 'documents_pending', 'approval_pending', 'restriction', 'shielding',
    'approved', 'rejected', 'sale_completed', 'sale_forms', 'sale_reservation',
    'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'archived'
  )
);
alter table public.client_status_history add constraint client_status_history_new_status_check check (
  new_status in (
    'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
    'documentation_pending', 'documents_pending', 'approval_pending', 'restriction', 'shielding',
    'approved', 'rejected', 'sale_completed', 'sale_forms', 'sale_reservation',
    'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'archived'
  )
);
