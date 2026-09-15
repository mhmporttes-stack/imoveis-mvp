-- Historico do WhatsApp Manual: so registra o clique real em "Abrir
-- WhatsApp" (action=opened) e, separadamente, o clique manual e opcional em
-- "Marcar como enviado" (action=marked_sent) -- nunca "enviado" de fato, ja
-- que o CRM nao tem como saber se a mensagem foi realmente enviada dentro
-- do WhatsApp de terceiros (fora da Cloud API).
create table if not exists public.whatsapp_manual_log (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.admin_users(id) on delete cascade,
  performed_by uuid references public.admin_users(id) on delete set null,
  summary_type text not null check (summary_type in ('today', 'last7', 'last30')),
  action text not null check (action in ('opened', 'marked_sent')),
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_manual_log_broker_idx on public.whatsapp_manual_log (broker_id, created_at desc);
create index if not exists whatsapp_manual_log_created_idx on public.whatsapp_manual_log (created_at desc);

alter table public.whatsapp_manual_log enable row level security;
revoke all on public.whatsapp_manual_log from anon, authenticated;
grant all on public.whatsapp_manual_log to service_role;
