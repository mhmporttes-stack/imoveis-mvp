-- REGRA OFICIAL DO DONO (2026-10-04): a carteira ativa de um corretor tem NO MAXIMO 30 clientes
-- (era 50 desde 2026-10-02; 100 antes). "Carteira ativa" = rodadas ativas da Meta Diaria
-- (daily_goal_rounds.status = 'active'), a mesma conta do card "Carteira ativa N/30".
--
-- ADITIVA e IDEMPOTENTE. Esta migration:
--   1) muda o teto de 50 para 30 (so se ainda for 50: nao desfaz um valor que o admin ajustou depois);
--   2) cria as tabelas de auditoria e de backup do rebalanceamento;
--   3) cria as funcoes do rebalanceamento (PLANO somente leitura, APLICAR e REVERTER).
-- NAO mexe em nenhum dado de cliente, rodada, contato ou fila: quem executa o rebalanceamento e a Central, com o
-- arquivo docs/sql-manual/carteira-30-aplicar-rebalanceamento.sql (so depois de conferir o plano). Nenhuma funcao
-- daqui e ligada a cron: uso MANUAL. As funcoes que entregam contato (claim_daily_goal_contacts,
-- claim_single_prospecting_contact, enqueue_extra_prospecting_dispatch) NAO sao alteradas: as tres ja chamam
-- daily_goal_reserve_wallet_slots (limite - atual, nunca acima), que le o teto do banco.
--
-- Prioridade de quem FICA (nao havia regra explicita; derivada da cadencia, documentada em
-- docs/BUSINESS_RULES.md MD-14): 1) quem esta protegido (negocio em andamento, resposta do cliente, atividade
-- futura, envio em andamento) nunca e devolvido; 2) mais avancado na cadencia (2 tentativas feitas > 1 > 0);
-- 3) contato mais recente; 4) rodada mais antiga; 5) id (desempate fixo). O excedente volta pelo MESMO mecanismo
-- da Prospecção (PRO-3/PRO-4/P-05): nunca contatado -> 'available'; ja tentado -> 'recent_attempt' +30 dias, e o
-- cliente fica sem responsavel (returnedToQueueClientPatch). Nao exclui, nao arquiva, nao muda etapa, nao marca
-- contato, nao apaga tentativa/historico, nao da ponto.

-- ---------------------------------------------------------------------------
-- 1) Teto 50 -> 30
-- ---------------------------------------------------------------------------
alter table public.daily_goal_wallet_config alter column wallet_limit set default 30;

update public.daily_goal_wallet_config
set wallet_limit = 30, updated_at = now()
where id = 'default' and wallet_limit = 50;

-- ---------------------------------------------------------------------------
-- 2) Auditoria e backup (RLS ligado, sem policy publica; sem FK de proposito: nao atrapalham remover usuario)
-- ---------------------------------------------------------------------------
create table if not exists public.daily_goal_wallet_trim_log (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  broker_id uuid not null,
  limit_value integer not null,
  wallet_before integer not null,       -- rodadas ativas antes (como o card mostrava)
  zombies_ended integer not null default 0,   -- rodadas ativas cujo contato JA tinha voltado para a fila
  kept integer not null default 0,
  returned integer not null default 0,        -- excedente devolvido a Prospecção
  returned_untouched integer not null default 0,   -- nunca tentados (voltam 'available')
  returned_with_attempts integer not null default 0, -- ja tentados (voltam 'recent_attempt' +30 dias)
  protected_count integer not null default 0,
  clients_unassigned integer not null default 0,
  queue_canceled integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reverted_at timestamptz
);
create index if not exists daily_goal_wallet_trim_log_run_idx on public.daily_goal_wallet_trim_log (run_id);

create table if not exists public.daily_goal_wallet_trim_backup (
  id bigserial primary key,
  run_id uuid not null,
  source_table text not null,
  row_id uuid not null,
  original jsonb not null,               -- linha INTEIRA como estava antes
  created_at timestamptz not null default now()
);
create index if not exists daily_goal_wallet_trim_backup_run_idx on public.daily_goal_wallet_trim_backup (run_id);

alter table public.daily_goal_wallet_trim_log enable row level security;
alter table public.daily_goal_wallet_trim_backup enable row level security;
revoke all on public.daily_goal_wallet_trim_log from anon, authenticated;
revoke all on public.daily_goal_wallet_trim_backup from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3a) PLANO (somente leitura): uma linha por rodada ativa, com a decisao.
--     kind: 'zombie' (contato ja devolvido -> so encerra a rodada) | 'keep' | 'return' (excedente).
--     p_limit nulo = teto efetivo do corretor (override individual, se houver, senao o global);
--     teto com bloqueio desligado (block_on_limit = false) nao devolve ninguem, salvo p_limit explicito.
-- ---------------------------------------------------------------------------
create or replace function public.daily_goal_wallet_trim_plan(p_limit integer default null, p_broker_id uuid default null)
returns table (
  broker_id uuid, round_id uuid, contact_id uuid, client_id uuid, attempt_count integer, origin text,
  client_status text, kind text, protected boolean, protect_reason text, keep_rank integer,
  limit_value integer, wallet_before integer
)
language sql
stable
set search_path to 'public'
as $plan$
  with cfg as (
    select u.id as broker_id,
           coalesce(p_limit, e.wallet_limit) as limit_value,
           (p_limit is not null or coalesce(e.block_on_limit, true)) as enforce
    from public.admin_users u
    cross join lateral public.daily_goal_wallet_effective_config(u.id) e
    where p_broker_id is null or u.id = p_broker_id
  ),
  act as (
    select r.id as round_id, r.broker_id, r.prospecting_contact_id as contact_id, r.client_id, r.attempt_count, r.origin,
           r.round_started_at, r.created_at as round_created_at,
           c.id as c_id, c.status as c_status, c.assigned_user_id as c_assigned, c.last_attempt_at as c_last_attempt_at,
           s.status as s_status, s.responsible_user_id as s_responsible,
           s.scheduled_activity_at as s_sched_at, s.scheduled_activity_completed_at as s_sched_done,
           (select max(a.created_at) from public.daily_goal_attempts a where a.round_id = r.id) as last_round_attempt_at
    from public.daily_goal_rounds r
    left join public.prospecting_contacts c on c.id = r.prospecting_contact_id
    left join public.simulation_registrations s on s.id = r.client_id
    where r.status = 'active' and (p_broker_id is null or r.broker_id = p_broker_id)
  ),
  flagged as (
    select a.*,
      -- Rodada "zumbi": o contato ja nao esta com este corretor (voltou para a fila, foi para outro corretor,
      -- virou nao-contactar ou foi apagado), mas a rodada continuou ativa e inflava a carteira.
      (a.c_id is null or a.c_status is distinct from 'claimed' or a.c_assigned is distinct from a.broker_id) as is_zombie,
      case
        when a.c_id is null or a.c_status is distinct from 'claimed' or a.c_assigned is distinct from a.broker_id then null
        when a.s_status is not null and a.s_status <> 'awaiting_return' then 'cliente_em_outra_etapa'
        when a.s_responsible is not null and a.s_responsible is distinct from a.broker_id then 'cliente_de_outro_responsavel'
        when exists (select 1 from public.prospecting_reply_alerts pa where pa.client_id = a.client_id and pa.status = 'open') then 'resposta_do_cliente_aberta'
        when exists (select 1 from public.calendar_activities ca where ca.client_id = a.client_id and ca.status = 'pending' and ca.scheduled_at >= now()) then 'atividade_futura_agendada'
        when a.s_sched_at is not null and a.s_sched_done is null and a.s_sched_at >= now() then 'atividade_futura_agendada'
        when exists (select 1 from public.whatsapp_conversations w where w.client_id = a.client_id and w.deleted_at is null
                       and (w.last_human_reply_at is not null or w.last_inbound_at is not null)) then 'conversa_com_o_cliente'
        when exists (select 1 from public.daily_goal_auto_queue q where q.round_id = a.round_id and q.status = 'sending') then 'envio_em_andamento'
        when a.origin = 'extra_dispatch' and a.attempt_count = 0
             and exists (select 1 from public.daily_goal_auto_queue q where q.round_id = a.round_id and q.source = 'extra' and q.status in ('pending', 'sending')) then 'disparar_em_andamento'
        else null
      end as protect_reason
    from act a
  ),
  ranked as (
    select f.*, g.limit_value, g.enforce,
      count(*) over (partition by f.broker_id) as active_total,
      count(*) filter (where f.protect_reason is not null) over (partition by f.broker_id) as protected_total,
      case when not f.is_zombie and f.protect_reason is null then
        row_number() over (
          partition by f.broker_id, (not f.is_zombie and f.protect_reason is null)
          order by f.attempt_count desc,
                   greatest(f.last_round_attempt_at, f.c_last_attempt_at) desc nulls last,
                   f.round_started_at asc, f.round_created_at asc, f.round_id)
      end as keep_rank
    from flagged f
    join cfg g on g.broker_id = f.broker_id
  )
  select r.broker_id, r.round_id, r.contact_id, r.client_id, r.attempt_count, r.origin, r.s_status as client_status,
         case
           when r.is_zombie then 'zombie'
           when not r.enforce then 'keep'
           when r.protect_reason is not null then 'keep'
           when r.keep_rank <= greatest(r.limit_value - r.protected_total, 0) then 'keep'
           else 'return'
         end as kind,
         r.protect_reason is not null as protected, r.protect_reason, r.keep_rank::integer,
         r.limit_value, r.active_total::integer as wallet_before
  from ranked r
$plan$;

-- ---------------------------------------------------------------------------
-- 3b) APLICAR: executa o plano numa transacao so (a propria chamada), com backup e auditoria.
--     Idempotente: com todo mundo <= teto e sem zumbi, nao muda nada e nao grava nada.
--     Reduzir o teto depois = chamar de novo (ele le o teto do banco) ou passar p_limit.
-- ---------------------------------------------------------------------------
create or replace function public.daily_goal_wallet_trim(p_limit integer default null, p_broker_id uuid default null)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_run uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_available_after timestamptz := now() + interval '30 days';
  v_broker record;
  v_bad record;
  v_result jsonb;
  v_enforce boolean;
begin
  if p_limit is not null and p_limit < 1 then
    raise exception 'LIMITE_INVALIDO' using errcode = 'P0001';
  end if;

  v_enforce := p_limit is not null or coalesce((select block_on_limit from public.daily_goal_wallet_config where id = 'default'), true);

  -- Mesma trava das reservas (claim_*): ninguem reivindica contato deste corretor enquanto o plano e aplicado.
  for v_broker in
    select distinct r.broker_id from public.daily_goal_rounds r
    where r.status = 'active' and (p_broker_id is null or r.broker_id = p_broker_id)
    order by r.broker_id
  loop
    perform pg_advisory_xact_lock(hashtext('daily_goal_wallet:' || v_broker.broker_id::text));
  end loop;

  drop table if exists pg_temp._wallet_trim_plan;
  create temp table _wallet_trim_plan on commit drop as
    select * from public.daily_goal_wallet_trim_plan(p_limit, p_broker_id) where kind in ('zombie', 'return');

  -- BACKUP (linha inteira, antes de qualquer UPDATE).
  insert into public.daily_goal_wallet_trim_backup (run_id, source_table, row_id, original)
  select v_run, 'daily_goal_rounds', r.id, to_jsonb(r)
  from public.daily_goal_rounds r join _wallet_trim_plan p on p.round_id = r.id where r.status = 'active';

  insert into public.daily_goal_wallet_trim_backup (run_id, source_table, row_id, original)
  select v_run, 'prospecting_contacts', c.id, to_jsonb(c)
  from public.prospecting_contacts c join _wallet_trim_plan p on p.contact_id = c.id
  where p.kind = 'return' and c.status = 'claimed' and c.assigned_user_id = p.broker_id;

  insert into public.daily_goal_wallet_trim_backup (run_id, source_table, row_id, original)
  select v_run, 'simulation_registrations', s.id, to_jsonb(s)
  from public.simulation_registrations s join _wallet_trim_plan p on p.client_id = s.id
  where p.kind = 'return' and p.attempt_count >= 1 and s.status = 'awaiting_return' and s.responsible_user_id = p.broker_id;

  insert into public.daily_goal_wallet_trim_backup (run_id, source_table, row_id, original)
  select v_run, 'daily_goal_auto_queue', q.id, to_jsonb(q)
  from public.daily_goal_auto_queue q join _wallet_trim_plan p on p.round_id = q.round_id where q.status = 'pending';

  -- Auditoria por corretor (antes dos UPDATEs: conta o que o plano decidiu).
  insert into public.daily_goal_wallet_trim_log
    (run_id, broker_id, limit_value, wallet_before, zombies_ended, kept, returned, returned_untouched, returned_with_attempts,
     protected_count, clients_unassigned, queue_canceled, details)
  select v_run, p.broker_id, max(p.limit_value), max(p.wallet_before),
         count(*) filter (where p.kind = 'zombie'),
         max(p.wallet_before) - count(*),
         count(*) filter (where p.kind = 'return'),
         count(*) filter (where p.kind = 'return' and p.attempt_count = 0),
         count(*) filter (where p.kind = 'return' and p.attempt_count >= 1),
         (select count(*) from public.daily_goal_wallet_trim_plan(p_limit, p.broker_id) x where x.protected),
         count(*) filter (where p.kind = 'return' and p.attempt_count >= 1 and exists (
            select 1 from public.simulation_registrations s where s.id = p.client_id and s.status = 'awaiting_return' and s.responsible_user_id = p.broker_id)),
         (select count(*) from public.daily_goal_auto_queue q join _wallet_trim_plan z on z.round_id = q.round_id
            where z.broker_id = p.broker_id and q.status = 'pending'),
         jsonb_build_object(
           'devolvidos_por_tentativa', jsonb_build_object(
             '0', count(*) filter (where p.kind = 'return' and p.attempt_count = 0),
             '1', count(*) filter (where p.kind = 'return' and p.attempt_count = 1),
             '2', count(*) filter (where p.kind = 'return' and p.attempt_count = 2)),
           'devolvidos_por_origem', jsonb_build_object(
             'meta_diaria', count(*) filter (where p.kind = 'return' and coalesce(p.origin, 'meta_diaria') <> 'extra_dispatch'),
             'disparar', count(*) filter (where p.kind = 'return' and p.origin = 'extra_dispatch')),
           'devolvidos_por_etapa', jsonb_build_object(
             'tentando_contato', count(*) filter (where p.kind = 'return' and p.client_status = 'awaiting_return'),
             'sem_cadastro_ainda', count(*) filter (where p.kind = 'return' and p.client_status is null),
             'outra_etapa', count(*) filter (where p.kind = 'return' and p.client_status is not null and p.client_status <> 'awaiting_return')))
  from _wallet_trim_plan p
  group by p.broker_id;

  -- 1) Fila automatica: item PENDENTE de rodada que sai da carteira e cancelado (mesmo motivo da reconciliacao existente).
  update public.daily_goal_auto_queue q
     set status = 'canceled', skip_reason = 'round_reconciled', updated_at = v_now
   where q.status = 'pending' and q.round_id in (select round_id from _wallet_trim_plan);

  -- 2) Contatos do EXCEDENTE voltam para a Prospecção (mecanismo PRO-3/PRO-4):
  --    nunca tentado -> 'available'; ja tentado -> 'recent_attempt' +30 dias. last_attempt_at/attempt_count NAO mudam.
  update public.prospecting_contacts c
     set status = 'available', assigned_user_id = null, available_after = null, updated_at = v_now
    from _wallet_trim_plan p
   where p.contact_id = c.id and p.kind = 'return' and p.attempt_count = 0
     and c.status = 'claimed' and c.assigned_user_id = p.broker_id;

  update public.prospecting_contacts c
     set status = 'recent_attempt', assigned_user_id = null, last_broker_id = p.broker_id,
         available_after = v_available_after, queue_sort_at = v_available_after, updated_at = v_now
    from _wallet_trim_plan p
   where p.contact_id = c.id and p.kind = 'return' and p.attempt_count >= 1
     and c.status = 'claimed' and c.assigned_user_id = p.broker_id;

  -- 3) Cliente ja cadastrado (so quem teve tentativa): fica SEM RESPONSAVEL, mesma etapa (returnedToQueueClientPatch).
  update public.simulation_registrations s
     set responsible_user_id = null, last_status_change_at = v_now
    from _wallet_trim_plan p
   where p.client_id = s.id and p.kind = 'return' and p.attempt_count >= 1
     and s.status = 'awaiting_return' and s.responsible_user_id = p.broker_id;

  -- 4) A rodada sai da carteira (tentativas e historico de tentativas ficam intactos).
  update public.daily_goal_rounds r
     set status = 'ended_no_conversion', ended_at = v_now
   where r.status = 'active' and r.id in (select round_id from _wallet_trim_plan);

  -- 5) Historico (mesmo tipo de evento da reconciliacao; nao conta ponto nem tentativa).
  insert into public.prospecting_history (contact_id, registration_id, user_id, event_type, details)
  select p.contact_id, p.client_id, p.broker_id, 'daily_goal_round_ended',
         jsonb_build_object('attempt', p.attempt_count,
                            'reason', case when p.kind = 'zombie' then 'wallet_trim_contact_already_returned' else 'wallet_trim_over_limit' end,
                            'run_id', v_run, 'limit', p.limit_value)
  from _wallet_trim_plan p
  where p.contact_id is not null and exists (select 1 from public.prospecting_contacts c where c.id = p.contact_id);

  -- TRAVA DE SEGURANCA: depois de aplicar, nenhum corretor pode ficar acima do teto, exceto por rodadas PROTEGIDAS
  -- (negocio em andamento nunca e devolvido) -> se acontecer, desfaz tudo (a propria transacao e abortada).
  for v_bad in
    select pl.broker_id, max(pl.limit_value) as limite, count(*) as ativas
    from public.daily_goal_wallet_trim_plan(p_limit, p_broker_id) pl
    where v_enforce and pl.broker_id in (select broker_id from _wallet_trim_plan)
    group by pl.broker_id
    having count(*) > greatest(max(pl.limit_value), count(*) filter (where pl.protected))
  loop
    raise exception 'CARTEIRA_ACIMA_DO_TETO_APOS_REBALANCEAR broker=% ativas=% limite=%', v_bad.broker_id, v_bad.ativas, v_bad.limite using errcode = 'P0001';
  end loop;

  select jsonb_build_object(
           'run_id', v_run,
           'brokers_affected', count(*),
           'zombies_ended', coalesce(sum(zombies_ended), 0),
           'returned', coalesce(sum(returned), 0),
           'returned_untouched', coalesce(sum(returned_untouched), 0),
           'returned_with_attempts', coalesce(sum(returned_with_attempts), 0),
           'clients_unassigned', coalesce(sum(clients_unassigned), 0),
           'queue_canceled', coalesce(sum(queue_canceled), 0))
    into v_result
  from public.daily_goal_wallet_trim_log where run_id = v_run;
  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3c) REVERTER uma execucao (pelo run_id): devolve rodada, contato, cliente e fila ao estado do backup,
--     SOMENTE quando nada mudou depois (contato ainda sem corretor e intocado desde a execucao, cliente ainda sem
--     responsavel). Quem ja foi reivindicado por outra pessoa fica como esta e e contado em "skipped".
-- ---------------------------------------------------------------------------
create or replace function public.daily_goal_wallet_trim_revert(p_run_id uuid)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_at timestamptz;
  v_rounds integer := 0;
  v_skipped integer := 0;
begin
  select min(created_at) into v_at from public.daily_goal_wallet_trim_backup where run_id = p_run_id;
  if v_at is null then
    raise exception 'EXECUCAO_NAO_ENCONTRADA' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.daily_goal_wallet_trim_log where run_id = p_run_id and reverted_at is not null) then
    return jsonb_build_object('run_id', p_run_id, 'already_reverted', true);
  end if;

  drop table if exists pg_temp._wallet_trim_restore;
  create temp table _wallet_trim_restore on commit drop as
    select b.row_id as round_id, o.status as o_status, o.ended_at as o_ended_at, o.prospecting_contact_id as contact_id, o.client_id
    from public.daily_goal_wallet_trim_backup b
    cross join lateral jsonb_populate_record(null::public.daily_goal_rounds, b.original) o
    join public.daily_goal_rounds r on r.id = b.row_id
    where b.run_id = p_run_id and b.source_table = 'daily_goal_rounds'
      and r.status = 'ended_no_conversion' and r.ended_at = v_at
      and (
        -- zumbi: o contato nao foi mexido pelo rebalanceamento (nao ha backup dele)
        not exists (select 1 from public.daily_goal_wallet_trim_backup bc where bc.run_id = p_run_id and bc.source_table = 'prospecting_contacts' and bc.row_id = o.prospecting_contact_id)
        -- devolvido: o contato continua exatamente como o rebalanceamento o deixou
        or exists (select 1 from public.prospecting_contacts c where c.id = o.prospecting_contact_id and c.assigned_user_id is null and c.updated_at = v_at)
      );

  select count(*) into v_rounds from _wallet_trim_restore;
  select count(*) - v_rounds into v_skipped from public.daily_goal_wallet_trim_backup where run_id = p_run_id and source_table = 'daily_goal_rounds';

  update public.prospecting_contacts c
     set status = o.status, assigned_user_id = o.assigned_user_id, last_broker_id = o.last_broker_id,
         available_after = o.available_after, queue_sort_at = o.queue_sort_at, updated_at = o.updated_at
    from public.daily_goal_wallet_trim_backup b
    cross join lateral jsonb_populate_record(null::public.prospecting_contacts, b.original) o
   where b.run_id = p_run_id and b.source_table = 'prospecting_contacts' and b.row_id = c.id
     and c.id in (select contact_id from _wallet_trim_restore);

  update public.simulation_registrations s
     set responsible_user_id = o.responsible_user_id, last_status_change_at = o.last_status_change_at
    from public.daily_goal_wallet_trim_backup b
    cross join lateral jsonb_populate_record(null::public.simulation_registrations, b.original) o
   where b.run_id = p_run_id and b.source_table = 'simulation_registrations' and b.row_id = s.id
     and s.responsible_user_id is null and s.last_status_change_at = v_at
     and s.id in (select client_id from _wallet_trim_restore where client_id is not null);

  update public.daily_goal_auto_queue q
     set status = o.status, skip_reason = o.skip_reason, updated_at = o.updated_at
    from public.daily_goal_wallet_trim_backup b
    cross join lateral jsonb_populate_record(null::public.daily_goal_auto_queue, b.original) o
   where b.run_id = p_run_id and b.source_table = 'daily_goal_auto_queue' and b.row_id = q.id
     and q.status = 'canceled' and q.updated_at = v_at
     and q.round_id in (select round_id from _wallet_trim_restore);

  update public.daily_goal_rounds r
     set status = z.o_status, ended_at = z.o_ended_at
    from _wallet_trim_restore z
   where z.round_id = r.id;

  update public.daily_goal_wallet_trim_log set reverted_at = now() where run_id = p_run_id;
  return jsonb_build_object('run_id', p_run_id, 'rounds_restored', v_rounds, 'rounds_skipped', v_skipped);
end;
$function$;

-- Somente o servidor/Central executa (mesmo padrao das demais funcoes internas).
revoke all on function public.daily_goal_wallet_trim_plan(integer, uuid) from public, anon, authenticated;
revoke all on function public.daily_goal_wallet_trim(integer, uuid) from public, anon, authenticated;
revoke all on function public.daily_goal_wallet_trim_revert(uuid) from public, anon, authenticated;
grant execute on function public.daily_goal_wallet_trim_plan(integer, uuid) to service_role;
grant execute on function public.daily_goal_wallet_trim(integer, uuid) to service_role;
grant execute on function public.daily_goal_wallet_trim_revert(uuid) to service_role;
