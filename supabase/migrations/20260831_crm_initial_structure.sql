alter table public.simulation_registrations
drop constraint if exists simulation_registrations_status_check;

alter table public.simulation_registrations
add constraint simulation_registrations_status_check check (
  status in (
    'pending',
    'completed',
    'simulation_sent',
    'in_service',
    'awaiting_return',
    'documentation_pending',
    'documents_pending',
    'approval_pending',
    'shielding',
    'approved',
    'rejected',
    'sale_completed',
    'archived'
  )
);

alter table public.simulation_registrations
add column if not exists scheduled_activity_type text not null default 'follow_up';

alter table public.simulation_registrations
drop constraint if exists simulation_registrations_scheduled_activity_type_check;

alter table public.simulation_registrations
add constraint simulation_registrations_scheduled_activity_type_check
check (length(btrim(scheduled_activity_type)) between 1 and 80);

create table if not exists public.crm_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.admin_users(id) on delete cascade,
  client_id uuid references public.simulation_registrations(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '',
  notification_type text not null default 'general',
  scheduled_at timestamptz not null default now(),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists crm_notifications_recipient_unread_idx
on public.crm_notifications (recipient_user_id, created_at desc)
where read_at is null;

create index if not exists crm_notifications_client_idx
on public.crm_notifications (client_id)
where client_id is not null;

create table if not exists public.crm_settings (
  id text primary key,
  setting_value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.admin_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.crm_settings (id, setting_value)
values (
  'whatsapp_master',
  '{"phone":"","connectionStatus":"disconnected","connectionId":"","lastConnectedAt":null,"active":false}'::jsonb
)
on conflict (id) do nothing;

create table if not exists public.crm_automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  trigger_type text not null,
  trigger_config jsonb not null default '{}'::jsonb,
  condition_config jsonb not null default '{}'::jsonb,
  action_config jsonb not null default '{}'::jsonb,
  enabled boolean not null default false,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_automation_rules_enabled_idx
on public.crm_automation_rules (enabled)
where enabled = true;

alter table public.crm_notifications enable row level security;
alter table public.crm_settings enable row level security;
alter table public.crm_automation_rules enable row level security;

revoke all on public.crm_notifications from anon, authenticated;
revoke all on public.crm_settings from anon, authenticated;
revoke all on public.crm_automation_rules from anon, authenticated;

grant all on public.crm_notifications to service_role;
grant all on public.crm_settings to service_role;
grant all on public.crm_automation_rules to service_role;
