-- A automação da Meta Diária marca um item como "sent" assim que o
-- microsserviço (Baileys) devolve um wa_message_id — mas isso NÃO comprova
-- entrega de verdade (achado real, 2026-09-30: corretora Caroline relatou
-- mensagens marcadas "enviadas" que nunca chegaram no WhatsApp dela; Baileys
-- pode resolver sendMessage() antes da confirmação real do servidor do
-- WhatsApp). delivered_at só é preenchido quando o próprio WhatsApp confirma
-- entrega (evento messages.update, status DELIVERY_ACK/READ, repassado pelo
-- webhook) — dá pra distinguir "tentamos enviar" de "chegou de verdade".
alter table public.daily_goal_auto_queue
  add column if not exists delivered_at timestamptz;

create index if not exists daily_goal_auto_queue_sent_unconfirmed_idx
  on public.daily_goal_auto_queue (broker_id, sent_at)
  where status = 'sent' and delivered_at is null;
