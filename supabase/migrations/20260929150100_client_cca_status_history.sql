-- Histórico de status do acompanhamento pós-envio à CCA — tabela SEPARADA de
-- client_document_submissions (que continua sendo só o log write-once de "o
-- que foi enviado", nunca lido de volta pela UI) e de client_status_history
-- (que é só o histórico do CHECK enum de simulation_registrations.status).
-- Segue literalmente o schema pedido pelo dono: id, cliente_id, cca_id,
-- status, observação, data_entrada, data_saída.
--
-- Toda mudança de sub-status grava uma linha nova; a linha aberta
-- (exited_at is null) é o status "atual" do cliente. O índice único parcial
-- abaixo garante no máximo UMA linha aberta por cliente (trava contra
-- duplo-clique/corrida, e também contra reenvio-sem-fechar-a-anterior) e é o
-- caminho rápido de "status atual" (contador de dias, badge do card, filtro)
-- sem precisar varrer client_journey_events, que não tem um formato
-- eficiente pra isso.
create table if not exists public.client_cca_status_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.simulation_registrations(id) on delete cascade,
  cca_id uuid not null references public.cca(id),
  status_id uuid not null references public.cca_status_stages(id),
  observation text,
  entered_at timestamptz not null default now(),
  exited_at timestamptz,
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists client_cca_status_history_open_idx
  on public.client_cca_status_history (client_id) where exited_at is null;
create index if not exists client_cca_status_history_client_idx
  on public.client_cca_status_history (client_id, entered_at desc);
create index if not exists client_cca_status_history_cca_idx
  on public.client_cca_status_history (cca_id, entered_at desc);
create index if not exists client_cca_status_history_status_idx
  on public.client_cca_status_history (status_id, entered_at desc);
alter table public.client_cca_status_history enable row level security;
revoke all on public.client_cca_status_history from anon, authenticated;
grant all on public.client_cca_status_history to service_role;
