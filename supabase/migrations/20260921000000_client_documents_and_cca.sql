-- Módulo "Documentação do cliente + CCA" (correspondente bancária).
-- Reaproveita 100% do que já existe: autenticação/permissões
-- (assertCanAccessResponsibleUser via getSimulationRegistration),
-- notificações (crm_notifications), histórico (client_journey_events, sem
-- CHECK de event_type) e o padrão de storage já usado pelo projeto
-- (lib/media-storage.js) — nada disso é duplicado aqui. Só as tabelas
-- realmente novas: CCA, lote de upload, documento individual e o checklist
-- consolidado que a IA preenche.

-- CPF/PIS não existiam em nenhum lugar do schema (confirmado por busca em
-- todas as migrations) — necessários para a folha de identificação (item 12
-- do pedido original). Ficam no próprio cliente (não só no envio) para
-- nunca precisar perguntar de novo numa próxima operação do mesmo cliente.
alter table public.simulation_registrations add column if not exists cpf text;
alter table public.simulation_registrations add column if not exists pis text;

-- CCA nunca participa de ranking/meta diária/roleta/funil — por isso é uma
-- tabela própria, NUNCA um novo `role` em admin_users (evitaria ter que
-- excluir esse role manualmente de ~10 lugares com `role in (...)` no banco
-- e no código, incluindo a roleta de distribuição de leads).
create table if not exists public.cca (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_name text,
  whatsapp text not null,
  email text,
  notes text,
  active boolean not null default true,
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Um "lote": o conjunto de arquivos que o corretor arrasta/cola de uma vez
-- para o mesmo cliente, analisado pela IA como um conjunto relacionado
-- (nunca arquivo a arquivo isolado).
create table if not exists public.client_document_batches (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.simulation_registrations(id) on delete cascade,
  uploaded_by uuid references public.admin_users(id),
  status text not null default 'uploading' check (status in ('uploading', 'processing', 'analyzed', 'failed')),
  total_files integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  divergences jsonb not null default '[]'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  analyzed_at timestamptz
);
create index if not exists client_document_batches_client_idx on public.client_document_batches (client_id, created_at desc);

-- Um arquivo individual enviado (o PDF/imagem original, intocado — mesmo um
-- PDF com vários tipos de documento dentro continua sendo UMA linha aqui;
-- a separação por tipo/pessoa/página fica no checklist abaixo).
create table if not exists public.client_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.simulation_registrations(id) on delete cascade,
  batch_id uuid not null references public.client_document_batches(id) on delete cascade,
  uploaded_by uuid references public.admin_users(id),
  filename text not null,
  storage_path text not null,
  mime_type text not null,
  file_size integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists client_documents_batch_idx on public.client_documents (batch_id);
create index if not exists client_documents_client_idx on public.client_documents (client_id) where deleted_at is null;

-- O checklist consolidado (item 6/8 do pedido) — UMA linha por (pessoa, tipo
-- de documento) esperado/encontrado no lote. `document_id` nulo = "ausente"
-- (nenhum arquivo do lote cobre esse item do checklist). Também é onde uma
-- classificação de baixa confiança fica marcada como
-- "precisa_confirmacao" até correção manual (nunca a IA "adivinha").
create table if not exists public.client_document_checklist_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.client_document_batches(id) on delete cascade,
  client_id uuid not null references public.simulation_registrations(id) on delete cascade,
  document_id uuid references public.client_documents(id) on delete set null,
  person_label text not null default 'Titular',
  document_type text not null default 'nao_identificado',
  status text not null default 'em_analise' check (status in ('conforme', 'pendencia', 'ilegivel', 'ausente', 'divergencia', 'precisa_confirmacao', 'em_analise')),
  page_range text,
  observations text,
  confidence numeric(4,3),
  extracted_data jsonb not null default '{}'::jsonb,
  corrected_by uuid references public.admin_users(id),
  corrected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_document_checklist_items_batch_idx on public.client_document_checklist_items (batch_id);
create index if not exists client_document_checklist_items_client_idx on public.client_document_checklist_items (client_id);

-- Registro de "Enviar para análise" (item 8-11 do pedido original) — qual
-- CCA recebeu qual lote, quando, por quem. A preparação (mensagem, folha de
-- identificação) é sempre recalculada na hora a partir do cliente/lote —
-- aqui só fica o registro histórico do envio em si.
create table if not exists public.client_document_submissions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.simulation_registrations(id) on delete cascade,
  batch_id uuid references public.client_document_batches(id) on delete set null,
  cca_id uuid not null references public.cca(id),
  created_by uuid references public.admin_users(id),
  message text not null default '',
  document_count integer not null default 0,
  -- Dados da operação preenchidos na hora do envio (item 12 do pedido
  -- original: imóvel novo/usado, valor, empreendimento — não existe campo
  -- equivalente em simulation_registrations, confirmado por investigação;
  -- criar uma tabela própria de "operação" seria escopo maior do que este
  -- módulo pede, então fica registrado aqui, por envio).
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists client_document_submissions_client_idx on public.client_document_submissions (client_id, created_at desc);
-- Item 17 do pedido original: estrutura pronta para métricas por CCA
-- (quantidade de clientes enviados/aguardando/analisados, período) sem
-- precisar de tabela nova — já dá pra agregar por cca_id.
create index if not exists client_document_submissions_cca_idx on public.client_document_submissions (cca_id, created_at desc);
