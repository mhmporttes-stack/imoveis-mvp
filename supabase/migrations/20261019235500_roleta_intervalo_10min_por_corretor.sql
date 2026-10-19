-- Regra do dono (2026-10-19, ROL-2h): "a partir do momento em que o corretor RECEBE um cliente pela distribuição, ele só
-- recebe o PRÓXIMO depois de 10 MINUTOS". Vale para TODOS os caminhos automáticos de distribuição — roleta de leads
-- novos (pick_round_robin_broker / reserva assign_round_robin_lead: formulário, Chat, anúncio, fila de espera,
-- redistribuição por prazo, "Devolver para a roleta", Fluxos) e fila de reativação do FUN-15l
-- (lib/cooled-clients-reactivation.js, via claim_roulette_receipt) — contando a partir do último cliente recebido por
-- QUALQUER um deles. Quem está em pausa é pulado sem perder o lugar na fila (como quem está offline); ninguém liberado
-- -> o cliente espera na fila e vai para o próximo que liberar (ROL-2b / FUN-15l).
--
-- Fonte única do intervalo: roulette_receive_interval() (o código JS só espelha os 10 min como reserva para antes desta
-- migration). Marca: admin_users.last_roulette_received_at, gravada DENTRO do mesmo lock da roleta
-- (pg_advisory_xact_lock 'lead_distribution_round_robin'), então dois leads simultâneos nunca caem no mesmo corretor
-- dentro dos 10 min. Sorteio que não virou cliente (formulário reenviado por cliente que já existe) é desfeito por
-- release_roulette_receipt.

alter table public.admin_users add column if not exists last_roulette_received_at timestamptz;

create or replace function public.roulette_receive_interval()
returns interval
language sql
immutable
as $function$
  select interval '10 minutes';
$function$;

-- Corretor liberado para receber (último recebimento automático há 10 min ou mais, ou nunca).
create or replace function public.roulette_cooldown_ok(p_user_id uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(
    (select u.last_roulette_received_at from public.admin_users u where u.id = p_user_id),
    '-infinity'::timestamptz
  ) <= now() - public.roulette_receive_interval();
$function$;

create or replace function public.roulette_cooldown_ok_ids(p_user_ids uuid[])
returns setof uuid
language sql
stable
set search_path to 'public'
as $function$
  select u from unnest(p_user_ids) as u where public.roulette_cooldown_ok(u);
$function$;

-- Fila de reativação (FUN-15l): reserva o corretor para UMA entrega, no mesmo lock da roleta. false = em pausa.
create or replace function public.claim_roulette_receipt(p_user_id uuid)
returns boolean
language plpgsql
set search_path to 'public'
as $function$
begin
  perform pg_advisory_xact_lock(hashtext('lead_distribution_round_robin'));
  update public.admin_users
  set last_roulette_received_at = now()
  where id = p_user_id
    and coalesce(last_roulette_received_at, '-infinity'::timestamptz) <= now() - public.roulette_receive_interval();
  return found;
end;
$function$;

-- Desfaz uma reserva que não virou cliente (sorteio feito e cliente não entregue). Só limpa a marca gravada a partir de
-- p_since: como o corretor estava liberado no sorteio (nada nos 10 min anteriores) e ninguém mais pode entregar a ele
-- nos 10 min seguintes, limpar equivale a voltar ao estado anterior.
create or replace function public.release_roulette_receipt(p_user_id uuid, p_since timestamptz)
returns boolean
language plpgsql
set search_path to 'public'
as $function$
begin
  perform pg_advisory_xact_lock(hashtext('lead_distribution_round_robin'));
  update public.admin_users
  set last_roulette_received_at = null
  where id = p_user_id
    and last_roulette_received_at >= p_since;
  return found;
end;
$function$;

create or replace function public.pick_round_robin_broker(excluded_broker_id uuid default null::uuid)
 returns table(picked_broker_id uuid, picked_tier text, skipped_ids uuid[])
 language plpgsql
 set search_path to 'public'
as $function$
declare
  ordered_ids uuid[];
  chosen_id uuid;
  chosen_rank integer;
  chosen_index integer;
  final_position integer;
begin
  perform pg_advisory_xact_lock(hashtext('lead_distribution_round_robin'));

  with eligible as (
    select
      u.id,
      u.lead_distribution_position as pos,
      lower(u.name) as lname,
      p.last_activity_at,
      exists (
        select 1
        from public.simulation_registrations r
        where r.responsible_user_id = u.id
          and r.distribution_type = 'round_robin'
          and r.status = 'pending'
          and r.last_whatsapp_contact_at is null
          and coalesce(r.responsible_changed_at, r.created_at) >= now() - interval '15 minutes'
      ) as has_waiting
    from public.admin_users u
    left join public.admin_presence p on p.user_id = u.id
    where u.status = 'active'
      and u.role in ('admin', 'manager', 'broker', 'associate')
      and u.lead_distribution_enabled = true
      and (excluded_broker_id is null or u.id <> excluded_broker_id)
      and p.last_activity_at >= now() - interval '5 minutes'
      and public.roulette_user_extra_eligible(u.id)
      -- ROL-2h (dono, 2026-10-19): 10 min entre dois recebimentos automáticos do mesmo corretor.
      and coalesce(u.last_roulette_received_at, '-infinity'::timestamptz) <= now() - public.roulette_receive_interval()
  ), ranked as (
    select
      id, pos, lname,
      case when has_waiting then 2 else 1 end as tier_rank
    from eligible
  )
  select
    (select array_agg(id order by pos nulls last, lname, id) from ranked),
    (select id from ranked order by tier_rank, pos nulls last, lname, id limit 1),
    (select tier_rank from ranked order by tier_rank, pos nulls last, lname, id limit 1)
  into ordered_ids, chosen_id, chosen_rank;

  if chosen_id is null then return; end if;

  chosen_index := array_position(ordered_ids, chosen_id);

  select coalesce(max(lead_distribution_position), 0) + 1 into final_position
  from public.admin_users;
  update public.admin_users
  set lead_distribution_position = final_position,
      last_roulette_received_at = now()
  where id = chosen_id;

  with ordered as (
    select id, row_number() over (order by lead_distribution_position nulls last, lower(name), id) as position
    from public.admin_users
    where status = 'active'
      and role in ('admin', 'manager', 'broker', 'associate')
      and lead_distribution_enabled = true
  )
  update public.admin_users as users
  set lead_distribution_position = ordered.position
  from ordered
  where users.id = ordered.id;

  insert into public.lead_distribution_state (id, last_broker_id, updated_at)
  values ('default', chosen_id, now())
  on conflict (id) do update
    set last_broker_id = excluded.last_broker_id,
        updated_at = excluded.updated_at;

  return query select
    chosen_id,
    case chosen_rank when 1 then 'online' else 'online_ocupado' end,
    coalesce(ordered_ids[1:chosen_index - 1], '{}'::uuid[]);
end;
$function$;

create or replace function public.assign_round_robin_lead(excluded_broker_id uuid default null::uuid)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
  broker_ids uuid[];
  last_id uuid;
  start_position integer;
  candidate_id uuid;
  candidate_offset integer;
  final_position integer;
begin
  perform pg_advisory_xact_lock(hashtext('lead_distribution_round_robin'));

  select array_agg(u.id order by u.lead_distribution_position nulls last, lower(u.name), u.id)
    into broker_ids
  from public.admin_users u
  where u.status = 'active'
    and u.role in ('admin', 'manager', 'broker', 'associate')
    and u.lead_distribution_enabled = true
    and public.roulette_user_extra_eligible(u.id)
    -- ROL-2h (dono, 2026-10-19): 10 min entre dois recebimentos automáticos do mesmo corretor.
    and coalesce(u.last_roulette_received_at, '-infinity'::timestamptz) <= now() - public.roulette_receive_interval();

  if broker_ids is null or array_length(broker_ids, 1) is null then return null; end if;

  select last_broker_id into last_id
  from public.lead_distribution_state
  where id = 'default';

  start_position := array_position(broker_ids, coalesce(excluded_broker_id, last_id));
  for candidate_offset in 1..array_length(broker_ids, 1) loop
    candidate_id := broker_ids[mod(coalesce(start_position, 0) + candidate_offset - 1, array_length(broker_ids, 1)) + 1];
    if excluded_broker_id is null or candidate_id <> excluded_broker_id then exit; end if;
    candidate_id := null;
  end loop;

  if candidate_id is null then return null; end if;

  select coalesce(max(lead_distribution_position), 0) + 1 into final_position
  from public.admin_users;
  update public.admin_users
  set lead_distribution_position = final_position,
      last_roulette_received_at = now()
  where id = candidate_id;

  with ordered as (
    select id, row_number() over (order by lead_distribution_position nulls last, lower(name), id) as position
    from public.admin_users
    where status = 'active'
      and role in ('admin', 'manager', 'broker', 'associate')
      and lead_distribution_enabled = true
  )
  update public.admin_users as users
  set lead_distribution_position = ordered.position
  from ordered
  where users.id = ordered.id;

  insert into public.lead_distribution_state (id, last_broker_id, updated_at)
  values ('default', candidate_id, now())
  on conflict (id) do update
    set last_broker_id = excluded.last_broker_id,
        updated_at = excluded.updated_at;

  return candidate_id;
end;
$function$;

-- Na hora de aplicar: quem recebeu cliente pela distribuição nos últimos 10 min já entra em pausa (roleta/fila de espera
-- pelo lead_distribution_history, sem contar o dono segurando a fila; fila de reativação pelo cooled_client_cases).
with recent as (
  select h.to_user_id as user_id, max(h.created_at) as at
  from public.lead_distribution_history h
  where h.to_user_id is not null
    and h.created_at >= now() - interval '10 minutes'
    and h.event_type in ('assigned', 'auto_transferred')
    and coalesce(h.details->>'toWaitingQueue', 'false') <> 'true'
    and coalesce(h.details->>'heldByOwner', 'false') <> 'true'
  group by h.to_user_id
  union all
  select c.reactivation_offered_to, max(c.reactivation_offered_at)
  from public.cooled_client_cases c
  where c.reactivation_offered_to is not null
    and c.reactivation_offered_at >= now() - interval '10 minutes'
  group by c.reactivation_offered_to
), latest as (
  select user_id, max(at) as at from recent group by user_id
)
update public.admin_users u
set last_roulette_received_at = latest.at
from latest
where u.id = latest.user_id
  and (u.last_roulette_received_at is null or u.last_roulette_received_at < latest.at);

-- Só o servidor (service_role) chama estas funções; nunca pelo navegador.
revoke execute on function public.roulette_receive_interval() from public, anon, authenticated;
revoke execute on function public.roulette_cooldown_ok(uuid) from public, anon, authenticated;
revoke execute on function public.roulette_cooldown_ok_ids(uuid[]) from public, anon, authenticated;
revoke execute on function public.claim_roulette_receipt(uuid) from public, anon, authenticated;
revoke execute on function public.release_roulette_receipt(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.roulette_receive_interval() to service_role;
grant execute on function public.roulette_cooldown_ok(uuid) to service_role;
grant execute on function public.roulette_cooldown_ok_ids(uuid[]) to service_role;
grant execute on function public.claim_roulette_receipt(uuid) to service_role;
grant execute on function public.release_roulette_receipt(uuid, timestamptz) to service_role;
