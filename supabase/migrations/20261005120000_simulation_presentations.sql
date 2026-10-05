-- Apresentação interativa da simulação (link público individual /s/<token>).
-- ADITIVA e idempotente: não altera nenhuma tabela existente. O PDF da simulação não depende disto.
-- Acesso só pelo servidor (service role): RLS ligado e SEM policy pública.
-- Documentação: docs/DATABASE.md (simulation_presentations) e docs/BUSINESS_RULES.md (PRES-1..PRES-8).

create table if not exists public.simulation_presentations (
  id uuid primary key default gen_random_uuid(),
  -- Identificador PÚBLICO do link: aleatório (>= 128 bits, 24 caracteres base62), nunca o id interno.
  token text not null unique check (char_length(token) >= 22),
  -- A simulação (public.simulations) é quem guarda os valores; a apresentação lê SEMPRE o estado atual dela.
  simulation_id uuid not null references public.simulations(id) on delete cascade,
  registration_id uuid references public.simulation_registrations(id) on delete set null,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'revoked')),
  revoked_at timestamptz,
  -- Métricas discretas (sem IP, sem user-agent, sem dado pessoal).
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  view_count integer not null default 0,
  completed_at timestamptz,
  last_scene smallint
);

-- Um link ATIVO por simulação: "gerar" é idempotente e devolve sempre o mesmo link.
create unique index if not exists simulation_presentations_one_active_idx
  on public.simulation_presentations (simulation_id)
  where status = 'active';

create index if not exists simulation_presentations_registration_idx
  on public.simulation_presentations (registration_id);

alter table public.simulation_presentations enable row level security;
revoke all on public.simulation_presentations from anon, authenticated;
grant all on public.simulation_presentations to service_role;

-- Registro atômico de evento (um único UPDATE; sem leitura-depois-escrita).
--   p_tipo 'abriu'    : first/last_opened_at; view_count + 1 só quando p_nova_sessao (abertura de sessão, não recarga)
--   p_tipo 'cena'     : last_scene = maior cena já alcançada
--   p_tipo 'concluiu' : completed_at (só a primeira vez) e last_scene
-- Retorna true quando o link existe e está ativo; false caso contrário (token inexistente/revogado).
create or replace function public.record_simulation_presentation_event(
  p_token text,
  p_tipo text,
  p_cena integer default null,
  p_nova_sessao boolean default false
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rows integer;
  v_cena smallint := case when p_cena between 1 and 32 then p_cena::smallint else null end;
begin
  if p_tipo = 'abriu' then
    update public.simulation_presentations
       set first_opened_at = coalesce(first_opened_at, now()),
           last_opened_at = now(),
           view_count = view_count + case when p_nova_sessao then 1 else 0 end
     where token = p_token and status = 'active';
  elsif p_tipo = 'cena' then
    update public.simulation_presentations
       set last_scene = greatest(coalesce(last_scene, 0), coalesce(v_cena, 0))
     where token = p_token and status = 'active';
  elsif p_tipo = 'concluiu' then
    update public.simulation_presentations
       set completed_at = coalesce(completed_at, now()),
           last_scene = greatest(coalesce(last_scene, 0), coalesce(v_cena, 0))
     where token = p_token and status = 'active';
  else
    return false;
  end if;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.record_simulation_presentation_event(text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.record_simulation_presentation_event(text, text, integer, boolean) to service_role;
