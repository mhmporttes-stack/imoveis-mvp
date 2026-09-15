-- Conta quantas vezes um link de campanha foi ABERTO (não só quantos viraram
-- cliente) — dá visão do abandono no meio do caminho (Gerador de Links).
-- Registro minimo de proposito: so serve para contar, nunca guarda dado
-- pessoal do visitante (sem IP, sem user agent, sem cookie).
create table if not exists public.campaign_link_views (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists campaign_link_views_campaign_id_idx on public.campaign_link_views (campaign_id);

alter table public.campaign_link_views enable row level security;
revoke all on public.campaign_link_views from anon, authenticated;
grant all on public.campaign_link_views to service_role;
