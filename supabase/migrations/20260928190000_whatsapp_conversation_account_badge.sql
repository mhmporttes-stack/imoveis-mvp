-- Badge visual na lista de Conversas: qual conta WhatsApp (sessão
-- individual de um corretor, ou o número oficial) está sendo usada
-- naquela conversa. Guarda só a REFERÊNCIA (canal + usuário da sessão),
-- nunca duplica dado de mensagem — mesmo padrão de last_message_direction,
-- só que atualizado apenas por SAÍDA (outbound nunca é sobrescrito por
-- uma mensagem recebida depois; se nunca houve saída, fica a conta que
-- recebeu a primeira mensagem).
alter table public.whatsapp_conversations
  add column if not exists account_channel text check (account_channel in ('whatsapp_individual', 'whatsapp_cloud_api')),
  add column if not exists account_user_id uuid references public.admin_users(id) on delete set null;

-- Backfill: última mensagem de SAÍDA de cada conversa; sem nenhuma saída,
-- a primeira mensagem recebida.
with last_outbound as (
  select distinct on (conversation_id) conversation_id, channel, session_user_id
  from public.whatsapp_messages
  where direction = 'outbound'
  order by conversation_id, message_at desc
),
first_inbound as (
  select distinct on (conversation_id) conversation_id, channel, session_user_id
  from public.whatsapp_messages
  where direction = 'inbound'
  order by conversation_id, message_at asc
)
update public.whatsapp_conversations c set
  account_channel = coalesce(lo.channel, fi.channel),
  account_user_id = coalesce(lo.session_user_id, fi.session_user_id)
from public.whatsapp_conversations base
left join last_outbound lo on lo.conversation_id = base.id
left join first_inbound fi on fi.conversation_id = base.id
where c.id = base.id and (lo.conversation_id is not null or fi.conversation_id is not null);
