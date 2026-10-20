-- Diagnóstico de estrutura do Chat do Marketplace (2026-10-20): a extensão do PC do dono envia um ESQUELETO
-- anonimizado da página do Facebook (tags, roles, aria-labels mascarados, caminhos de link com ids trocados e marcadores
-- de texto — nunca nome, mensagem ou dado real) para calibrar os seletores. Idempotente, sem DROP. RLS ligado sem
-- policy (acesso só pelo servidor).
create table if not exists public.marketplace_diagnostics (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (char_length(kind) between 1 and 40),
  payload jsonb not null
);

create index if not exists marketplace_diagnostics_created_idx on public.marketplace_diagnostics (created_at desc);

alter table public.marketplace_diagnostics enable row level security;
