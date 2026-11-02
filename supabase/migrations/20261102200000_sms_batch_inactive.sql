-- Lote de SMS (dono, 2026-11-02): 'inactive' = número que existe mas não está ativo (junto de 'invalid' = não existe).
-- Aditiva e idempotente: só troca o CHECK de event.
alter table public.sms_batch_sends drop constraint if exists sms_batch_sends_event_check;
alter table public.sms_batch_sends
  add constraint sms_batch_sends_event_check check (event in ('sent', 'sent_2', 'opt_out', 'invalid', 'inactive'));
