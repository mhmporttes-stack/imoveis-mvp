-- Exceção à política de notificações (REGRA OFICIAL do dono, 2026-10-22, MKT-2i): mensagem interna no Chat do
-- MARKETPLACE avisa no sino (e push) admin geral, corretor responsável/atribuído e gestora da equipe — tipo
-- 'marketplace_internal' (lib/marketplace-chat.js). Ao tocar, abre a conversa: coluna nova `link` (rota interna do painel,
-- só preenchida por esse aviso; os demais tipos continuam sem link e o sino segue abrindo a ficha do cliente).
-- A nota interna do Chat do WhatsApp ('chat_internal') continua bloqueada (AUT-9).
-- Mesma lista de lib/notification-policy-core.mjs (sino). Aditiva e idempotente: coluna nullable + troca do corpo da função.
alter table public.crm_notifications add column if not exists link text;

create or replace function public.crm_notifications_policy()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.notification_type in ('new_client', 'scheduled_activity', 'clients_transferred', 'official_chat_assigned', 'documents_list_auto', 'marketplace_internal') then
    return new;
  end if;
  return null; -- descarta em silêncio (a gravação não falha)
end;
$$;
