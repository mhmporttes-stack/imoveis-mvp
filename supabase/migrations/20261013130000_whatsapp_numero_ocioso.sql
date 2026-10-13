-- Regra do dono (2026-10-13, ROL-2e): número do WhatsApp "conectado" que fica 4 horas sem enviar nem receber mensagem,
-- contando só das 8h às 21h (todos os dias, horário de Brasília), passa a OCIOSO (ícone laranja) e deixa de valer para a
-- roleta (ROL-2d). Volta sozinho com qualquer mensagem enviada/recebida naquele número ou ao reconectar.

-- Minutos dentro da janela 08:00–21:00 (America/Sao_Paulo) entre dois instantes.
create or replace function public.business_minutes_between(p_from timestamptz, p_to timestamptz)
returns integer
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(sum(greatest(0, extract(epoch from (
           least(p_to, ((d::timestamp + interval '21 hours') at time zone 'America/Sao_Paulo'))
         - greatest(p_from, ((d::timestamp + interval '8 hours') at time zone 'America/Sao_Paulo'))
         )) / 60))::integer, 0)
  from generate_series((p_from at time zone 'America/Sao_Paulo')::date, (p_to at time zone 'America/Sao_Paulo')::date, interval '1 day') as g(d)
  where p_from is not null and p_to is not null and p_to > p_from;
$function$;

-- Situação de cada número: conectado, última atividade (mensagem no número ou conexão) e se está ATIVO (conectado e
-- com menos de 240 min ociosos dentro da janela).
create or replace function public.whatsapp_number_activity(p_user_ids uuid[] default null)
returns table(user_id uuid, slot integer, status text, last_activity_at timestamptz, idle_minutes integer, active boolean)
language sql
stable
set search_path to 'public'
as $function$
  with base as (
    select s.user_id, coalesce(s.slot, 1) as slot, s.status,
      greatest(
        s.last_connected_at,
        (select max(c.last_message_at) from public.whatsapp_conversations c
          where c.session_key = s.user_id and coalesce(c.session_slot, 1) = coalesce(s.slot, 1))
      ) as last_activity_at
    from public.whatsapp_individual_sessions s
    where p_user_ids is null or s.user_id = any(p_user_ids)
  )
  select b.user_id, b.slot, b.status, b.last_activity_at,
    public.business_minutes_between(b.last_activity_at, now()) as idle_minutes,
    (b.status = 'connected' and (b.last_activity_at is null or public.business_minutes_between(b.last_activity_at, now()) < 240)) as active
  from base b;
$function$;

-- Roleta: o "WhatsApp conectado" da ROL-2d passa a exigir número ATIVO.
create or replace function public.whatsapp_user_has_active_number(p_user_id uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select exists (select 1 from public.whatsapp_number_activity(array[p_user_id]) a where a.active);
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
      and public.whatsapp_user_has_active_number(u.id)
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
  set lead_distribution_position = final_position
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
    and public.whatsapp_user_has_active_number(u.id);

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
  update public.admin_users set lead_distribution_position = final_position where id = candidate_id;

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
