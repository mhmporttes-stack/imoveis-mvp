-- Configuração da Alexa (falas espontâneas no Echo Dot via Voice Monkey).
-- Linha única (id = 1). NUNCA guarda token/ID do dispositivo: essas credenciais
-- ficam só nas variáveis protegidas da Vercel (VOICEMONKEY_TOKEN/DEVICE).
-- Defaults preservam o comportamento anterior: só "Novo cliente" fala, 24h.

create table if not exists public.alexa_settings (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default true,
  allowed_weekdays smallint[] not null default '{0,1,2,3,4,5,6}',
  start_time text not null default '00:00' check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text not null default '23:59' check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  min_interval_seconds integer not null default 0 check (min_interval_seconds between 0 and 3600),
  events jsonb not null default '{}'::jsonb,
  last_spoken_at timestamptz,
  updated_by uuid references public.admin_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.alexa_settings (id) values (1) on conflict (id) do nothing;

alter table public.alexa_settings enable row level security;
revoke all on public.alexa_settings from anon, authenticated;
grant all on public.alexa_settings to service_role;
