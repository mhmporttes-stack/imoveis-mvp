-- Automação da Meta Diária (pedido do dono, 2026-10-02). Aditiva e idempotente.

-- 1) "Intervalo médio máximo" (minutos) com oscilação ligada: o intervalo
-- médio efetivo é o MENOR entre (tempo restante da janela ÷ mensagens) e este
-- valor — a janela é LIMITE de envio, não duração obrigatória da fila.
-- NULL = sem limite (comportamento anterior).
alter table public.daily_goal_auto_settings
  add column if not exists max_avg_gap_minutes integer;
alter table public.daily_goal_auto_settings drop constraint if exists daily_goal_auto_settings_max_avg_gap_check;
alter table public.daily_goal_auto_settings add constraint daily_goal_auto_settings_max_avg_gap_check
  check (max_avg_gap_minutes is null or max_avg_gap_minutes between 1 and 180);

-- 2) Marca gravada IMEDIATAMENTE antes de chamar o WhatsApp. Item preso em
-- 'sending' sem esta marca nunca chegou a enviar (seguro devolver à fila);
-- com a marca e sem wa_message_id/entrega, o envio é incerto — vai para
-- revisão e NUNCA é reenviado automaticamente.
alter table public.daily_goal_auto_queue
  add column if not exists send_started_at timestamptz;

create index if not exists daily_goal_auto_queue_sending_idx
  on public.daily_goal_auto_queue (updated_at) where status = 'sending';
