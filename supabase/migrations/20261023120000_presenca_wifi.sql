-- PRES-WIFI (dono, 2026-10-23): chegada/saída pelo Wi-Fi via Atalhos do iPhone (POST /api/presence/wifi).
-- Aditiva e idempotente. Uma linha por usuário: só o HASH da chave pessoal (a chave aparece uma vez no painel),
-- os gatilhos do Voice Monkey (ligar/desligar a tomada) e o último evento. Histórico em presence_wifi_events.

create table if not exists public.presence_wifi_tokens (
  user_id uuid primary key references public.admin_users(id) on delete cascade,
  token_hash text unique,
  token_created_at timestamptz,
  plug_on_device text,
  plug_off_device text,
  last_event text check (last_event in ('arrive', 'leave')),
  last_event_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.presence_wifi_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete cascade,
  event text not null check (event in ('arrive', 'leave')),
  received_at timestamptz not null default now(),
  office_status text,
  plug_status text
);
create index if not exists presence_wifi_events_user_idx on public.presence_wifi_events (user_id, received_at desc);

alter table public.presence_wifi_tokens enable row level security;
alter table public.presence_wifi_events enable row level security;
revoke all on public.presence_wifi_tokens from anon, authenticated;
revoke all on public.presence_wifi_events from anon, authenticated;
grant all on public.presence_wifi_tokens to service_role;
grant all on public.presence_wifi_events to service_role;
