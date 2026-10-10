-- Backup de 2026-10-09 ficou sem RLS no schema public (advisor rls_disabled_in_public).
-- Sem policies, como as demais tabelas: só o service role (servidor) acessa.
alter table if exists public.whatsapp_conversations_hidden_backup_20261009 enable row level security;
