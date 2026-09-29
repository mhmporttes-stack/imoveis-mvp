-- Janela de envio da automação da Meta Diária: pedido do dono (2026-09-29)
-- de começar mais cedo (06:30) e ir até mais tarde (19:00) — mais tempo pra
-- espalhar os envios com a meta grande (100 contatos/dia). Muda o padrão
-- para quem ainda não ligou a automação e atualiza quem já ligou com a
-- janela antiga (08:00-18:00), que nunca escolheu esse horário de propósito.

alter table public.daily_goal_auto_settings
  alter column window_start_minutes set default 390, -- 06:30
  alter column window_end_minutes set default 1140;   -- 19:00

update public.daily_goal_auto_settings
set window_start_minutes = 390, window_end_minutes = 1140, updated_at = now()
where window_start_minutes = 480 and window_end_minutes = 1080;
