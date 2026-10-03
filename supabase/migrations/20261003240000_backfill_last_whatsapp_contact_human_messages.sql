-- P-11 (decisão do dono, 2026-10-03) — backfill CONSERVADOR do último contato do cliente.
-- Contexto: até 2026-10-03 a mensagem que o corretor mandava pelo APLICATIVO do celular gravava a conversa
-- (last_human_reply_at) mas NÃO o cliente (simulation_registrations.last_whatsapp_contact_at); o Chat do CRM já
-- gravava desde 2026-09-28. Esta migration copia para o cliente SÓ o que tem evidência inequívoca:
--   * mensagem em whatsapp_messages: saída (outbound), por pessoa (sender_type = 'user'), enviada (status
--     sent/delivered/read — nunca failed), não reação, não nota interna, não histórico importado
--     (metadata.history), e que NÃO é eco da automação da Meta Diária (mesmo wa_message_id, ou mesmo texto
--     enviado pelo mesmo WhatsApp dentro de 10 min, em daily_goal_auto_queue);
--   * conversa já ligada ao cliente (client_id) e o telefone do cliente tem UM único cadastro (CLI-4: telefone
--     com vários atendimentos é ambíguo — não altera);
--   * cliente ativo (nem arquivado nem "Não contactar").
-- Efeito: apenas last_whatsapp_contact_at (avança só para frente: nulo ou anterior à última mensagem humana).
-- NÃO altera status, responsável, histórico de status nem pontuação. Clique no botão WhatsApp, automação e
-- histórico ambíguo nunca viram contato humano. Idempotente (rodar de novo não muda nada).

with human_messages as (
  select c.client_id, m.message_at
  from public.whatsapp_messages m
  join public.whatsapp_conversations c on c.id = m.conversation_id
  where m.direction = 'outbound'
    and m.sender_type = 'user'
    and m.status in ('sent', 'delivered', 'read')
    and m.message_type not in ('reaction', 'internal')
    and coalesce(m.metadata->>'history', '') <> 'true'
    and coalesce(m.metadata->>'internal', '') <> 'true'
    and c.client_id is not null
    and not exists (
      select 1 from public.daily_goal_auto_queue q
      where q.wa_message_id is not null and q.wa_message_id = m.metadata->>'wa_message_id'
    )
    and not exists (
      select 1 from public.daily_goal_auto_queue q
      where q.broker_id = m.session_user_id
        and q.message_text = m.body
        and q.send_started_at is not null
        and abs(extract(epoch from (q.send_started_at - m.message_at))) <= 600
    )
), latest as (
  select client_id, max(message_at) as last_human_at
  from human_messages
  group by client_id
)
update public.simulation_registrations r
   set last_whatsapp_contact_at = l.last_human_at
  from latest l
 where r.id = l.client_id
   and r.status not in ('archived', 'do_not_contact')
   and (r.last_whatsapp_contact_at is null or r.last_whatsapp_contact_at < l.last_human_at)
   and (select count(*) from public.simulation_registrations o where o.phone_normalized = r.phone_normalized) = 1;
