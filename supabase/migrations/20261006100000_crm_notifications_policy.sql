-- Política de notificações (regra do dono, 2026-10-06): o sino do painel
-- (crm_notifications) só recebe aviso de CLIENTE NOVO e de ATIVIDADE AGENDADA
-- (e o aviso de transferência de clientes, que é cliente novo para quem recebe).
-- Qualquer outro tipo (mensagem interna do Chat, documentação, roleta parou,
-- automação genérica...) é descartado no banco — vale mesmo que algum código
-- esqueça de respeitar a regra (o push é barrado em lib/push-subscriptions.js).
-- Mesma lista de lib/notification-policy-core.mjs.

create or replace function public.crm_notifications_policy()
returns trigger
language plpgsql
as $$
begin
  if new.notification_type in ('new_client', 'scheduled_activity', 'clients_transferred') then
    return new;
  end if;
  return null; -- descarta em silêncio (a gravação não falha)
end;
$$;

drop trigger if exists crm_notifications_policy on public.crm_notifications;
create trigger crm_notifications_policy
  before insert on public.crm_notifications
  for each row execute function public.crm_notifications_policy();

-- Avisos antigos de tipos que deixaram de existir saem do sino (marcados como lidos; nada é apagado).
update public.crm_notifications
   set read_at = now()
 where read_at is null
   and notification_type not in ('new_client', 'scheduled_activity', 'clients_transferred');
