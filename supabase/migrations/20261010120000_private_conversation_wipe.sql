-- Particular (2026-10-10): ao destrancar uma conversa Particular o histórico é apagado do Chat e o contato volta limpo.
-- history_cutoff_at = momento do destrancamento: mensagem mais antiga que isso (ex.: reimportada do WhatsApp) não é
-- importada nem exibida. A cópia interna das mensagens apagadas fica em whatsapp_private_wipe_backup, sem acesso
-- público (só service_role / dono pelo banco). Aditiva: nada existente é alterado.
alter table public.whatsapp_conversations add column if not exists history_cutoff_at timestamptz;

create table if not exists public.whatsapp_private_wipe_backup (
  id uuid primary key default gen_random_uuid(),
  wiped_at timestamptz not null default now(),
  wiped_by uuid,
  conversation_id uuid not null,
  contact_phone text,
  message jsonb not null
);
create index if not exists whatsapp_private_wipe_backup_conversation_idx on public.whatsapp_private_wipe_backup (conversation_id);
alter table public.whatsapp_private_wipe_backup enable row level security;
revoke all on public.whatsapp_private_wipe_backup from anon, authenticated;
grant all on public.whatsapp_private_wipe_backup to service_role;
