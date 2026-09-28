-- A data original do cadastro permanece intocada. Só um novo envio de
-- formulário atualiza last_form_submitted_at; edições internas não o fazem.
alter table public.simulation_registrations
  add column if not exists last_form_submitted_at timestamptz;

-- Coluna gerada permite ordenar/paginar no banco sem atualizar todos os
-- clientes antigos (o que dispararia os triggers de negócio existentes).
alter table public.simulation_registrations
  add column if not exists list_order_at timestamptz
  generated always as (coalesce(last_form_submitted_at, created_at)) stored;

create index if not exists simulation_registrations_list_order_idx
  on public.simulation_registrations (list_order_at desc, id desc);
