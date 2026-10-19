-- SIM-AUTO "Refazer simulação automática" (regra do dono, 2026-10-19): cada refazer abre uma conferência NOVA e a
-- anterior ainda aberta fica como histórico ('superseded'); conferências fechadas (ok/corrected) nunca são apagadas.
-- Troca o índice único por simulação por um único só para a conferência ABERTA. Idempotente.

alter table public.simulation_auto_reviews drop constraint if exists simulation_auto_reviews_review_status_check;
alter table public.simulation_auto_reviews add constraint simulation_auto_reviews_review_status_check
  check (review_status in ('pending', 'correcting', 'ok', 'corrected', 'superseded'));

drop index if exists public.simulation_auto_reviews_simulation_unique;
create unique index if not exists simulation_auto_reviews_open_unique
  on public.simulation_auto_reviews (simulation_id)
  where review_status in ('pending', 'correcting');
create index if not exists simulation_auto_reviews_simulation_idx on public.simulation_auto_reviews (simulation_id, created_at desc);
