-- Backfill PROPOSTO (NÃO aplicado) — incidente 2026-10-17 "o povo não sabe o que foi mandado".
-- Mensagens já enviadas pela automação da Meta Diária / fila "Disparar" pelo WhatsApp pessoal do corretor nunca
-- entraram no Chat (só em daily_goal_auto_queue). O código corrigido grava as próximas; isto recupera as antigas.
--
-- Escopo conservador: só conversas que JÁ EXISTEM (cliente respondeu ou alguém conversou) — não cria conversa nova
-- para quem nunca respondeu (encheria o Chat de centenas de contatos). Só itens com prova de envio (wa_message_id),
-- conversa do MESMO dono e número que enviou, não excluída, e respeitando o corte de histórico (history_cutoff_at).
-- Linha de AUTOMAÇÃO (sender_type 'automation'): não é contato humano, não muda status, não mexe na conversa
-- (last_message_at/prévia/não lidas ficam como estão — as respostas do cliente são mais recentes).
-- Idempotente: pula o que já existe (índice único session_user_id + metadata->>'wa_message_id').
-- Telefone: compara 55+DDD + últimos 8 dígitos (com/sem o 9), o mesmo critério de phoneLookupCandidates.

-- 1) CONTAGEM (somente leitura) — rodar primeiro.
with sent as (
  select q.id, q.broker_id, coalesce(q.session_slot, 1) as slot, q.wa_message_id, q.message_text, q.source,
         q.attempt_number, coalesce(q.sent_at, q.send_started_at) as at, q.delivered_at,
         regexp_replace(pc.phone_normalized, '\D', '', 'g') as d
  from public.daily_goal_auto_queue q
  join public.prospecting_contacts pc on pc.id = q.contact_id
  where q.wa_message_id is not null and q.status in ('sent', 'error')
    and coalesce(q.sent_at, q.send_started_at) is not null
), matched as (
  select s.*, c.id as conversation_id
  from sent s
  join lateral (
    select c.id from public.whatsapp_conversations c
    where c.session_key = s.broker_id and coalesce(c.session_slot, 1) = s.slot and c.deleted_at is null
      and length(s.d) >= 12 and c.contact_phone ~ '^\+?[0-9]+$'
      and left(regexp_replace(c.contact_phone, '\D', '', 'g'), 4) = left(s.d, 4)
      and right(regexp_replace(c.contact_phone, '\D', '', 'g'), 8) = right(s.d, 8)
      and (c.history_cutoff_at is null or s.at >= c.history_cutoff_at)
    order by c.last_message_at desc nulls last limit 1
  ) c on true
)
select count(*) as a_gravar, count(distinct conversation_id) as conversas, min(at) as mais_antiga, max(at) as mais_recente
from matched m
where not exists (
  select 1 from public.whatsapp_messages w
  where w.channel = 'whatsapp_individual' and w.session_user_id = m.broker_id and w.metadata->>'wa_message_id' = m.wa_message_id
);

-- 2) GRAVAÇÃO — só com o OK do dono, depois de conferir a contagem. Mesmo filtro do passo 1.
-- insert into public.whatsapp_messages
--   (conversation_id, direction, sender_type, channel, session_user_id, session_slot, message_type, body, metadata,
--    status, sent_at, delivered_at, message_at)
-- select m.conversation_id, 'outbound', 'automation', 'whatsapp_individual', m.broker_id, m.slot, 'text', m.message_text,
--        jsonb_build_object('kind', 'daily_goal_auto', 'wa_message_id', m.wa_message_id, 'daily_goal_queue_id', m.id,
--                           'daily_goal_source', coalesce(m.source, 'meta'), 'attempt_number', m.attempt_number,
--                           'recorded_from', 'backfill_2026_10_17'),
--        case when m.delivered_at is not null then 'delivered' else 'sent' end, m.at, m.delivered_at, m.at
-- from matched m   -- (repetir aqui os CTEs "sent" e "matched" do passo 1)
-- where not exists (
--   select 1 from public.whatsapp_messages w
--   where w.channel = 'whatsapp_individual' and w.session_user_id = m.broker_id and w.metadata->>'wa_message_id' = m.wa_message_id
-- )
-- on conflict do nothing;
