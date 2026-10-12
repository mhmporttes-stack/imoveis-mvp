-- Liberação manual da trava "primeira mensagem = link da simulação" (ROL-4c) para um cliente específico — pedido do
-- dono, 2026-10-12 (cliente idoso com dificuldade com links). Aditiva; o código funciona sem as colunas.
alter table public.simulation_registrations
  add column if not exists simulation_first_waived_at timestamptz,
  add column if not exists simulation_first_waived_by text;
