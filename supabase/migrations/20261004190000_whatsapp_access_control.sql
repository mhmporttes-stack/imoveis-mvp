-- Controle individual de ACESSO AOS RECURSOS WHATSAPP por corretor (pedido do dono, 2026-10-04).
-- Conceito DIFERENTE da automação ligada/desligada (daily_goal_auto_settings.enabled): aqui o admin/gestor
-- libera ou bloqueia o USO do WhatsApp do CRM (Chat, Meta Diária, conexão/QR, envios) para um corretor.
-- Aditiva: todo mundo continua LIBERADO (default false) — nada é bloqueado ao aplicar.
-- Bloquear não desconecta sessão, não apaga credenciais, fila, histórico nem cliente.

alter table public.admin_users
  add column if not exists whatsapp_access_blocked boolean not null default false;

comment on column public.admin_users.whatsapp_access_blocked is
  'true = acesso aos recursos WhatsApp do CRM bloqueado pelo admin/gestor (Chat, Meta Diária do corretor, conexão/QR, envios). Só muda por lib/whatsapp-access.js (com auditoria).';

create table if not exists public.whatsapp_access_audit (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null,
  previous_blocked boolean not null,
  new_blocked boolean not null,
  changed_by uuid,
  changed_by_name text,
  changed_by_email text,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_access_audit_broker_idx on public.whatsapp_access_audit (broker_id, created_at desc);
alter table public.whatsapp_access_audit enable row level security;
