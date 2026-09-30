-- Corrige bug real (achado 2026-09-30 investigando por que a Carol não
-- recebia disparo nenhum): UNIQUE (round_id, attempt_number) cobria TODOS os
-- status, então um item cancelado (ex.: pausa manual "pausado_para_investigacao")
-- ou skipped/error travava para sempre a re-fila daquele round+tentativa —
-- todo insert em lote seguinte batia em 23505, e o código de
-- lib/daily-goal-auto.js engolia esse erro (23505 não é relançado), então o
-- cron "sucedia" sem nunca escrever nada. Corretores afetados até aqui:
-- Caroline (4 itens canceled), e35cad2f (5 skipped), f67fa793 (11 skipped).
--
-- Fix: a unicidade só precisa valer enquanto o item está "vivo" (pending/
-- sending/sent) — depois de canceled/skipped/error, uma nova tentativa para
-- o mesmo round+attempt_number deve poder ser enfileirada.
alter table public.daily_goal_auto_queue
  drop constraint daily_goal_auto_queue_round_id_attempt_number_key;

create unique index daily_goal_auto_queue_round_attempt_active_idx
  on public.daily_goal_auto_queue (round_id, attempt_number)
  where status in ('pending', 'sending', 'sent');
