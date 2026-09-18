-- Pente-fino Meta Diária/Prospecção/Pontuação: introduz o conceito de
-- "carteira ativa" (clientes aguardando 1ª+2ª+3ª tentativa combinadas) com
-- limite configurável, motivo obrigatório para "não contactar novamente" com
-- auditoria completa, e detecção de abuso (ações repetidas anormais).
--
-- Arquitetura pensada para permitir limite POR CORRETOR no futuro sem nova
-- migration: daily_goal_wallet_config guarda o valor global; um corretor com
-- linha em daily_goal_wallet_broker_overrides usa o valor individual dele
-- (hoje a tabela existe mas nenhuma tela grava nela — só o limite global é
-- editável em Gestão > Meta Diária > Configurações).

create table if not exists public.daily_goal_wallet_config (
  id text primary key default 'default',
  wallet_limit integer not null default 100,
  block_on_limit boolean not null default true,
  updated_by uuid references public.admin_users(id),
  updated_at timestamptz not null default now()
);
insert into public.daily_goal_wallet_config (id, wallet_limit, block_on_limit)
values ('default', 100, true)
on conflict (id) do nothing;

create table if not exists public.daily_goal_wallet_broker_overrides (
  broker_id uuid primary key references public.admin_users(id) on delete cascade,
  wallet_limit integer not null,
  updated_by uuid references public.admin_users(id),
  updated_at timestamptz not null default now()
);

-- Configuração EFETIVA de um corretor: override individual (quando existir)
-- prevalece sobre o valor global; o toggle de bloqueio continua sempre global
-- (não faria sentido um corretor ter limite mas outro não ter bloqueio).
create or replace function public.daily_goal_wallet_effective_config(p_broker_id uuid)
returns table(wallet_limit integer, block_on_limit boolean)
language sql stable
set search_path to 'public'
as $$
  select coalesce(o.wallet_limit, c.wallet_limit) as wallet_limit, c.block_on_limit
  from public.daily_goal_wallet_config c
  left join public.daily_goal_wallet_broker_overrides o on o.broker_id = p_broker_id
  where c.id = 'default';
$$;

-- Carteira ativa = rodadas ainda ativas (aguardando 1ª, 2ª ou 3ª tentativa) de
-- QUALQUER origem (Meta Diária ou prospecção manual, ambas gravam em
-- daily_goal_rounds) — exatamente a definição do pente-fino.
create or replace function public.daily_goal_active_wallet_count(p_broker_id uuid)
returns integer
language sql stable
set search_path to 'public'
as $$
  select count(*)::int from public.daily_goal_rounds where broker_id = p_broker_id and status = 'active';
$$;

-- Reserva atômica de espaço na carteira: usada tanto pela distribuição
-- automática da Meta Diária quanto pela prospecção manual (puxar da Base da
-- Imobiliária/Minha Base), sempre dentro da MESMA transação que efetivamente
-- reivindica o(s) contato(s) — pg_advisory_xact_lock por corretor garante que
-- duas chamadas simultâneas para o mesmo corretor nunca somem mais que o
-- limite (corretores diferentes não bloqueiam um ao outro). Bloqueio
-- desligado = sempre concede o solicitado (carteira sem teto).
create or replace function public.daily_goal_reserve_wallet_slots(p_broker_id uuid, p_requested integer)
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  v_limit integer;
  v_block boolean;
  v_current integer;
  v_available integer;
begin
  if p_requested <= 0 then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtext('daily_goal_wallet:' || p_broker_id::text));
  select wallet_limit, block_on_limit into v_limit, v_block
  from public.daily_goal_wallet_effective_config(p_broker_id);

  if not coalesce(v_block, true) then
    return p_requested;
  end if;

  v_current := public.daily_goal_active_wallet_count(p_broker_id);
  v_available := greatest(coalesce(v_limit, 0) - v_current, 0);
  return least(p_requested, v_available);
end;
$function$;

-- claim_daily_goal_contacts passa a respeitar a carteira: nunca reivindica
-- mais do que ESPAÇO DISPONÍVEL = LIMITE - CARTEIRA ATIVA, mesmo que a cota
-- diária configurada seja maior. Sem espaço, retorna conjunto vazio (a Meta
-- Diária do dia simplesmente distribui 0 novos — nunca lança erro aqui, o
-- erro amigável é responsabilidade da prospecção manual, ver
-- claim_single_prospecting_contact).
create or replace function public.claim_daily_goal_contacts(p_broker_id uuid, p_quota integer)
returns setof prospecting_contacts
language plpgsql
set search_path to 'public'
as $function$
declare
  v_now timestamptz := now();
  v_grant integer;
begin
  v_grant := public.daily_goal_reserve_wallet_slots(p_broker_id, p_quota);
  if v_grant <= 0 then
    return;
  end if;

  return query
    update public.prospecting_contacts
    set status = 'claimed', assigned_user_id = p_broker_id, last_broker_id = p_broker_id, updated_at = v_now
    where id in (
      select id from public.prospecting_contacts
      where assigned_user_id is null
        and (status = 'available' or (status = 'recent_attempt' and available_after <= v_now))
      order by queue_sort_at asc
      limit v_grant
      for update skip locked
    )
    returning *;
end;
$function$;

-- Reivindicação manual de UM contato específico (Base da Imobiliária/Minha
-- Base) — mesma trava de carteira, mas aqui SEM espaço disponível deve gerar
-- um erro claro para a tela mostrar o alerta amigável (nunca silenciar).
create or replace function public.claim_single_prospecting_contact(p_contact_id uuid, p_broker_id uuid)
returns setof prospecting_contacts
language plpgsql
set search_path to 'public'
as $function$
declare
  v_now timestamptz := now();
  v_grant integer;
begin
  v_grant := public.daily_goal_reserve_wallet_slots(p_broker_id, 1);
  if v_grant <= 0 then
    raise exception 'WALLET_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  return query
    update public.prospecting_contacts
    set status = 'claimed', assigned_user_id = p_broker_id, last_broker_id = p_broker_id, last_attempt_at = v_now, available_after = null, updated_at = v_now
    where id = p_contact_id
      and assigned_user_id is null
      and (status = 'available' or (status = 'recent_attempt' and available_after <= v_now))
    returning *;
end;
$function$;

-- Auditoria completa de "Não contactar novamente": motivo obrigatório
-- (opções rápidas + "Outro" com texto livre), quem executou, quando, e a
-- origem da ação (tela de prospecção manual vs. cliente já em atendimento).
create table if not exists public.daily_goal_do_not_contact_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.simulation_registrations(id) on delete set null,
  contact_id uuid references public.prospecting_contacts(id) on delete set null,
  broker_id uuid references public.admin_users(id),
  reason_key text not null,
  reason_text text,
  executed_by uuid references public.admin_users(id),
  origin text not null default 'prospecting',
  created_at timestamptz not null default now()
);
create index if not exists daily_goal_do_not_contact_log_executed_by_idx on public.daily_goal_do_not_contact_log (executed_by, created_at desc);

-- Log de detecção de abuso (ações repetidas anormais, ex.: várias "não
-- contactar novamente" seguidas para esvaziar a carteira) — só para auditoria
-- gerencial; a própria ação bloqueada nunca chega a se efetivar.
create table if not exists public.daily_goal_abuse_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.admin_users(id),
  action_type text not null,
  count_detected integer not null,
  window_minutes integer not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
