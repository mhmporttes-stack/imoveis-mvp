-- Reenvios do formulário público por link de campanha: quando a mesma pessoa
-- (mesmo nome + telefone) preenche de novo, o CRM atualiza o cadastro
-- existente em vez de criar outro — antes, esse reenvio não deixava rastro
-- nenhum, e o card do link mostrava menos "cadastros" que a Meta (que conta
-- cada envio como um lead). Só reenvios são gravados aqui; o primeiro envio
-- continua sendo a linha de client_origins. Total de cadastros do link =
-- linhas de client_origins + linhas desta tabela.
create table if not exists public.campaign_link_duplicate_submissions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  client_id uuid references public.simulation_registrations(id) on delete set null,
  journey_type text,
  created_at timestamptz not null default now()
);

create index if not exists campaign_link_duplicate_submissions_campaign_idx
  on public.campaign_link_duplicate_submissions (campaign_id, created_at);

alter table public.campaign_link_duplicate_submissions enable row level security;
