-- Lote de SMS, 2ª mensagem (dono, 2026-11-02): 'sent_2' = a 2ª mensagem enviada depois da 1ª ('sent'). Aditiva e idempotente:
-- só troca o CHECK de event (drop if exists + add). Sem esta migration a 2ª mensagem recusa o envio com aviso.
alter table public.sms_batch_sends drop constraint if exists sms_batch_sends_event_check;
alter table public.sms_batch_sends
  add constraint sms_batch_sends_event_check check (event in ('sent', 'sent_2', 'opt_out'));
