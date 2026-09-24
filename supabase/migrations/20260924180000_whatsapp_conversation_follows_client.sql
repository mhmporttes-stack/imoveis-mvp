-- Quando o corretor RESPONSÁVEL de um cliente muda (transferência manual,
-- roleta, retorno automático, atribuição em lote…), a conversa do WhatsApp
-- desse cliente passa a ser atendida pelo novo responsável. É o "vice-versa"
-- da regra "atribuir a conversa transfere o cliente" (feita no código do
-- Chat, com histórico de transferência). Trigger no banco para cobrir TODOS os
-- caminhos que mudam o responsável, sem depender de cada um lembrar do Chat.
create or replace function public.sync_whatsapp_conversation_assignee()
returns trigger
language plpgsql
as $$
begin
  if new.responsible_user_id is distinct from old.responsible_user_id then
    update public.whatsapp_conversations
       set assigned_user_id = new.responsible_user_id,
           updated_at = now()
     where client_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_conversation_assignee_sync on public.simulation_registrations;
create trigger whatsapp_conversation_assignee_sync
  after update of responsible_user_id on public.simulation_registrations
  for each row
  execute function public.sync_whatsapp_conversation_assignee();
