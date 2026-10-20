-- Registro de toques e aberturas da apresentação interativa (/s/<token>) — Mesa "Atendimento depois da simulação",
-- lote A item 3 (autorizado pelo dono em 2026-10-19). ADITIVA e idempotente: não altera nenhuma tabela existente.
-- Acesso só pelo servidor (service role): RLS ligado e SEM policy pública (mesmo padrão de 20261005120000).
-- Sem IP, sem user-agent, sem dado pessoal: só o link, o tipo, o botão tocado (lista fechada), a cena exata e se quem abriu
-- tinha sessão do painel (equipe), decidido no SERVIDOR da página. O código tolera esta tabela ainda não existir.
-- Documentação: docs/DATABASE.md (simulation_presentation_events) e docs/BUSINESS_RULES.md (PRES-7).
create table if not exists public.simulation_presentation_events (
  id bigint generated always as identity primary key,
  presentation_id uuid not null references public.simulation_presentations(id) on delete cascade,
  -- 'abriu' = nova sessão do navegador (recarga não conta); 'toque' = botão tocado
  tipo text not null check (tipo in ('abriu', 'toque')),
  alvo text check (alvo is null or alvo in ('estrategia', 'agendar', 'imoveis', 'lista', 'validar', 'baixar')),
  cena smallint check (cena is null or cena between 1 and 32),
  equipe boolean not null default false,
  created_at timestamptz not null default now(),
  constraint simulation_presentation_events_toque_alvo check (tipo <> 'toque' or (alvo is not null and cena is not null))
);

create index if not exists simulation_presentation_events_presentation_idx
  on public.simulation_presentation_events (presentation_id, created_at);

alter table public.simulation_presentation_events enable row level security;
revoke all on public.simulation_presentation_events from anon, authenticated;
grant all on public.simulation_presentation_events to service_role;
