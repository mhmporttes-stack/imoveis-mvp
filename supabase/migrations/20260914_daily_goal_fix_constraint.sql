-- Um cliente pode converter (virar "Em atendimento") antes de qualquer
-- tentativa da Meta Diária ter sido enviada (ex.: alguém mudou o status por
-- fora) — converted_attempt precisa aceitar 0, não só 1..3.
alter table public.daily_goal_rounds drop constraint if exists daily_goal_rounds_converted_attempt_check;
alter table public.daily_goal_rounds add constraint daily_goal_rounds_converted_attempt_check
  check (converted_attempt is null or converted_attempt between 0 and 3);
