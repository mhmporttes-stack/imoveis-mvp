-- Lentidão da Meta Diária / CRM (2026-10-06): o retorno automático (hibernação, cron a cada 2 min) cruza os
-- ~480 contatos "claimed" com daily_goal_rounds por (prospecting_contact_id, status, ended_at) — sem índice isso
-- varria a tabela inteira para cada contato (~227 ms por execução, ~4,8 BILHÕES de linhas lidas no total).
-- Com o índice: ~2 ms. Aditiva e idempotente (já aplicada em produção).
create index if not exists daily_goal_rounds_contact_status_idx
  on public.daily_goal_rounds (prospecting_contact_id, status, ended_at);
create index if not exists daily_goal_rounds_status_ended_idx
  on public.daily_goal_rounds (status, ended_at);
analyze public.daily_goal_rounds;
