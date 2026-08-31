create table if not exists public.whatsapp_master_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  message_id text,
  direction text not null default 'inbound'
    check (direction in ('inbound', 'outbound', 'system')),
  event_type text not null,
  sender_phone text,
  contact_name text,
  recipient_phone_id text,
  message_type text,
  message_text text,
  event_at timestamptz,
  received_at timestamptz not null default now(),
  related_client_id uuid references public.simulation_registrations(id) on delete set null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_master_events_sender_phone_idx
on public.whatsapp_master_events (sender_phone);

create index if not exists whatsapp_master_events_related_client_idx
on public.whatsapp_master_events (related_client_id)
where related_client_id is not null;

create index if not exists whatsapp_master_events_event_at_idx
on public.whatsapp_master_events (event_at desc);

alter table public.whatsapp_master_events enable row level security;

revoke all on public.whatsapp_master_events from anon, authenticated;
grant all on public.whatsapp_master_events to service_role;
