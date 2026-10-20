-- Exceção à política de notificações (regra do dono, 2026-10-20): lista de documentos pedida pelo cliente no WhatsApp
-- OFICIAL (botão da apresentação) — o corretor responsável recebe UM aviso no sino (e push) dizendo que a lista foi enviada
-- sozinha, ou que ficou pendente com a lista pronta na ficha — tipo 'documents_list_auto' (lib/documents-list-auto.js).
-- Mesma lista de lib/notification-policy-core.mjs (sino). Aditiva e idempotente: só troca o corpo da função; gatilho igual.
create or replace function public.crm_notifications_policy()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.notification_type in ('new_client', 'scheduled_activity', 'clients_transferred', 'official_chat_assigned', 'documents_list_auto') then
    return new;
  end if;
  return null; -- descarta em silêncio (a gravação não falha)
end;
$$;
