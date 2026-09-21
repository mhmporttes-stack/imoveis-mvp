-- Extrato de gastos de IA dentro do próprio CRM (não dá pra duplicar o
-- "adicionar saldo" da Anthropic aqui — isso fica no console deles, ligado
-- ao cartão de crédito — mas dá pra registrar quanto cada chamada real
-- consumiu, pra nunca precisar entrar no console só pra acompanhar gasto).
create table if not exists public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  feature text not null default 'client_document_analysis',
  model text not null,
  batch_id uuid references public.client_document_batches(id) on delete set null,
  client_id uuid references public.simulation_registrations(id) on delete set null,
  triggered_by uuid references public.admin_users(id) on delete set null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric(10,4) not null default 0,
  success boolean not null default true,
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_log_created_idx on public.ai_usage_log (created_at desc);
create index if not exists ai_usage_log_batch_idx on public.ai_usage_log (batch_id);
