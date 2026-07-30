alter table public.simulation_registrations
add column if not exists last_whatsapp_contact_at timestamptz,
add column if not exists last_admin_email text,
add column if not exists last_admin_activity_at timestamptz;

create index if not exists simulation_registrations_last_whatsapp_contact_at_idx
  on public.simulation_registrations (last_whatsapp_contact_at desc);

create index if not exists simulation_registrations_last_admin_activity_at_idx
  on public.simulation_registrations (last_admin_activity_at desc);
