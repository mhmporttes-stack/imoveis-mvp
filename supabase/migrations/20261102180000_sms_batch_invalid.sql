-- Lote de SMS (dono, 2026-11-02): 'invalid' = número marcado como inválido (SMS não entregue). Aditiva e idempotente: só troca o
-- CHECK de event. Sem esta migration o botão "Número inválido" recusa com aviso.
alter table public.sms_batch_sends drop constraint if exists sms_batch_sends_event_check;
alter table public.sms_batch_sends
  add constraint sms_batch_sends_event_check check (event in ('sent', 'sent_2', 'opt_out', 'invalid'));
