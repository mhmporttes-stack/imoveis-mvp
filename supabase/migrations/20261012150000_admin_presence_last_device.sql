-- Aparelho do último sinal de presença (ícone celular/notebook no painel Online — pedido do dono, 2026-10-12).
-- Aditiva: o código funciona sem a coluna (não grava/lê o aparelho até ela existir).
alter table public.admin_presence
  add column if not exists last_device text;

alter table public.admin_presence
  drop constraint if exists admin_presence_last_device_check;

alter table public.admin_presence
  add constraint admin_presence_last_device_check check (last_device is null or last_device in ('mobile', 'desktop'));
