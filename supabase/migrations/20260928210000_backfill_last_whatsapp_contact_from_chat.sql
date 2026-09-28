-- Bug real reportado pelo dono em 2026-09-28: cliente ativamente respondido pelo Chat
-- (número oficial ou WhatsApp individual) continuava contando como "pendente"/"sem
-- contato há mais de 3 dias" (Meta Diária, filtro "Clientes pendentes", automação
-- time_without_contact) porque simulation_registrations.last_whatsapp_contact_at só
-- era gravado ao clicar o botão WhatsApp do card do cliente ou reivindicar/tentar
-- contato pela Prospecção — NUNCA ao mandar mensagem direto na conversa do Chat
-- (lib/whatsapp-client-status.js, markClientOnHumanMessage só gravava quando o
-- EVENTO também mudava o status do cliente; para quem já estava "Em atendimento"
-- a função retornava sem tocar em nada). Corrigido no código nesta mesma leva
-- (markClientOnHumanMessage passa a gravar last_whatsapp_contact_at sempre, antes
-- de checar a transição de status).
--
-- Esta migration é só a faxina retroativa: qualquer cliente com mensagem HUMANA
-- (direction='outbound', sender_type='user', não 'failed') mais recente no Chat do
-- que o last_whatsapp_contact_at gravado tem o campo atualizado pra bater com a
-- mensagem real mais recente — 65 clientes afetados quando aplicado em produção
-- em 2026-09-28 (caso relatado pelo dono: "Denise morena", responsável Bruna
-- Santos, respondida às 14:11 do dia mas com last_whatsapp_contact_at parado em
-- 25/09). Idempotente: rodar de novo não muda nada além de recalcular o mesmo máximo.

update public.simulation_registrations r
set last_whatsapp_contact_at = x.last_human_msg, updated_at = now()
from (
  select c.client_id, max(m.sent_at) as last_human_msg
  from public.whatsapp_conversations c
  join public.whatsapp_messages m on m.conversation_id = c.id
  where m.direction = 'outbound' and m.sender_type = 'user' and m.status <> 'failed' and c.client_id is not null
  group by c.client_id
) x
where r.id = x.client_id
  and (r.last_whatsapp_contact_at is null or r.last_whatsapp_contact_at < x.last_human_msg);
