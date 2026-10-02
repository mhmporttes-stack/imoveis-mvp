-- Central de Alertas do CRM (pedido do dono, 2026-10-02). Só ACRESCENTA.
-- Dois tipos: 'informative' (aviso flutuante ~5 s, não bloqueia) e
-- 'important' (bloqueia o CRM até "Entendi", com ciência registrada).
-- Não substitui Supervisão, Celebração, Mensagem do dia nem crm_notifications:
-- é a camada única para alertas novos e para os automáticos que o dono
-- quiser na tela (ex.: cliente aguardando resposta, hoje só falado na Alexa).
--
-- crm_alert_definitions = O QUE é o alerta (mensagem, tipo, público,
-- gatilho, período, repetição) — base para o dono criar alertas pelo CRM
-- depois. crm_alert_deliveries = CADA entrega a uma pessoa, com quando
-- apareceu e quando confirmou. dedupe_key + destinatário é único: o mesmo
-- evento nunca vira dois alertas.

create table if not exists public.crm_alert_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  title text not null,
  body_template text not null,
  kind text not null check (kind in ('informative', 'important')),
  -- público: {"type":"user","ids":[...]} | {"type":"role","roles":[...]} | {"type":"all"} | {"type":"system"}
  audience jsonb not null default '{"type":"system"}'::jsonb,
  -- gatilho: {"type":"manual"} | {"type":"system","source":"reply_waiting"} | futuro: condições
  trigger jsonb not null default '{"type":"manual"}'::jsonb,
  -- período/repetição (futuro construtor): {"start_at","end_at","hours":[ini,fim],"weekdays":[...]} / {"every_minutes":N,"max":N}
  schedule jsonb not null default '{}'::jsonb,
  repeat jsonb not null default '{}'::jsonb,
  enabled boolean not null default false,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid references public.crm_alert_definitions(id) on delete set null,
  recipient_id uuid not null references public.admin_users(id) on delete cascade,
  kind text not null check (kind in ('informative', 'important')),
  title text not null,
  body text not null,
  -- contexto livre (client_id, conversation_id, link) — sem FK rígida de propósito.
  context jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  shown_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.admin_users(id) on delete set null,
  unique (recipient_id, dedupe_key)
);

create index if not exists crm_alert_deliveries_pending_idx
  on public.crm_alert_deliveries (recipient_id, created_at)
  where acknowledged_at is null;

alter table public.crm_alert_definitions enable row level security;
alter table public.crm_alert_deliveries enable row level security;
revoke all on public.crm_alert_definitions from anon, authenticated;
revoke all on public.crm_alert_deliveries from anon, authenticated;

-- Alerta do sistema: cliente aguardando resposta (detector = lib/alexa-reply-alert.js).
-- Nasce DESLIGADO: o dono liga na Central quando quiser os modais na tela.
insert into public.crm_alert_definitions (key, title, body_template, kind, audience, trigger, enabled)
values (
  'reply_waiting',
  'Cliente aguardando resposta',
  '{primeiro_nome}, o cliente {cliente} está aguardando sua resposta há mais de {minutos} minutos.',
  'important',
  '{"type":"system"}'::jsonb,
  '{"type":"system","source":"reply_waiting"}'::jsonb,
  false
)
on conflict (key) do nothing;
