-- Lista configurável de sub-status do acompanhamento pós-envio à CCA,
-- crescível pelo admin sem alterar código — mesmo padrão de lib/cca.js e
-- lib/client-tags.js (tabela própria + lib/*.js com list/create/update/
-- delete). NUNCA um valor novo em simulation_registrations.status (CHECK
-- constraint fixo de 25 valores) nem em client_status_history — essa lista é
-- uma camada informativa paralela, sem efeito automático sobre o status
-- principal do cliente (confirmado com o dono: só o envio à CCA muda o
-- status principal; escolher "Aprovado"/"Reprovado" aqui nunca muda
-- simulation_registrations.status).
--
-- `key` é o identificador ESTÁVEL usado pelo código, imutável depois de
-- criado — `label` é o texto livre editável pelo admin. `awaiting_cca_return`
-- é o único key com tratamento especial: é o status aberto automaticamente
-- no primeiro envio (lib/client-documents.js, submitToCca) e o único cujo
-- rótulo é montado como "Aguardando retorno de {nome da CCA}" em vez de
-- "{label} — {nome da CCA}" — decisão deliberada de não criar uma coluna de
-- "template de exibição": um key hardcoded em lib/cca-status-presentation.mjs
-- é suficiente.
create table if not exists public.cca_status_stages (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cca_status_stages_active_idx on public.cca_status_stages (active, sort_order);
alter table public.cca_status_stages enable row level security;
revoke all on public.cca_status_stages from anon, authenticated;
grant all on public.cca_status_stages to service_role;

insert into public.cca_status_stages (key, label, sort_order) values
  ('awaiting_cca_return', 'Aguardando retorno da CCA', 10),
  ('documentation_pending', 'Documentação pendente', 20),
  ('awaiting_cancellation_letter', 'Aguardando carta de cancelamento', 30),
  ('awaiting_rating', 'Aguardando rating', 40),
  ('approved', 'Aprovado', 50),
  ('rejected', 'Reprovado', 60)
on conflict (key) do nothing;
