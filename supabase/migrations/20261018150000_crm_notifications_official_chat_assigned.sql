-- Exceção à política de notificações (regra do dono, 2026-10-18 — PRES-25): quando a conversa do WhatsApp OFICIAL é
-- atribuída ao corretor pelo código do atendimento (MM-XXXXXXXX) dos botões do link, ele recebe UM aviso no sino (e push)
-- por atribuição — tipo 'official_chat_assigned' (lib/whatsapp-contact-code.js). Os demais tipos seguem descartados.
-- Mesma lista de lib/notification-policy-core.mjs (sino). Aditiva: só troca o corpo da função; o gatilho continua o mesmo.
create or replace function public.crm_notifications_policy()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.notification_type in ('new_client', 'scheduled_activity', 'clients_transferred', 'official_chat_assigned') then
    return new;
  end if;
  return null; -- descarta em silêncio (a gravação não falha)
end;
$$;
