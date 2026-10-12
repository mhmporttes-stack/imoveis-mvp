-- Aparelho de cada marca de presença por minuto (histórico "entrou/saiu · celular/computador" no painel Online —
-- pedido do dono, 2026-10-12). Aditiva: o código funciona sem a coluna (histórico sem aparelho até ela existir).
alter table public.admin_presence_activity
  add column if not exists device text;

alter table public.admin_presence_activity
  drop constraint if exists admin_presence_activity_device_check;

alter table public.admin_presence_activity
  add constraint admin_presence_activity_device_check check (device is null or device in ('mobile', 'desktop'));
