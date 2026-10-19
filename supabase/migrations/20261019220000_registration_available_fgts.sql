-- Entrada e FGTS disponíveis só no cadastro do cliente (pedido do dono, 2026-10-19): o cadastro ganha o campo de FGTS
-- disponível (a entrada já existia: available_purchase_resource). A simulação passa a ler os dois do cadastro
-- (lib/simulation-resources-core.mjs); simulações antigas com valores próprios continuam mostrando os delas.
-- Idempotente. O código funciona sem esta coluna (o FGTS do cadastro só não é gravado).
alter table public.simulation_registrations add column if not exists available_fgts_balance numeric(12, 2) not null default 0;
