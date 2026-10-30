-- Alerta de mensagem nova do cliente no Chat do Marketplace (REGRA OFICIAL do dono, 2026-10-30, MKT-3; exceção à AUT-9
-- só do Marketplace): sino (crm_notifications 'marketplace_inbound', com `link` da conversa) + push ao atribuído; sem
-- atribuído, admins gerais e gestoras. Um aviso por conversa a cada 10 min: `inbound_notified_at` é reservado de forma
-- atômica (UPDATE condicional) por lib/marketplace-chat.js. Sem esta migration o código não avisa (nunca vira spam).
-- Mesma lista de lib/notification-policy-core.mjs (sino). Aditiva e idempotente: coluna nullable + troca do corpo da função.
alter table public.marketplace_conversations add column if not exists inbound_notified_at timestamptz;

create or replace function public.crm_notifications_policy()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.notification_type in ('new_client', 'scheduled_activity', 'clients_transferred', 'official_chat_assigned', 'documents_list_auto', 'marketplace_internal', 'marketplace_inbound') then
    return new;
  end if;
  return null; -- descarta em silêncio (a gravação não falha)
end;
$$;
