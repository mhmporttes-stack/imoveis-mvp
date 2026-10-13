-- Regra do dono (2026-10-13, ROL-2f): só fica na roleta quem VEIO À IMOBILIÁRIA. Presença detectada pelo Wi-Fi do
-- escritório (IP público da rede cadastrado pelo dono/gestora) no heartbeat do CRM, ou liberada à mão pelo dono/gestora
-- ("Liberar hoje"). Chegou em qualquer horário -> apto até 9h do dia seguinte; quem chega no SÁBADO fica até 9h de
-- segunda. Vale para toda a roleta e para corretores, gestora e associados. Sem ninguém apto on-line o lead espera na
-- fila (sem prazo). A regra só vale quando LIGADA (crm_settings id 'office_presence', setting_value.enabled = true):
-- desligada, nada muda.

create table if not exists public.office_presence_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete cascade,
  checkin_date date not null,
  first_seen_at timestamptz not null default now(),
  valid_until timestamptz not null,
  source text not null check (source in ('wifi', 'manual')),
  ip text,
  released_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, checkin_date)
);
create index if not exists office_presence_checkins_valid_idx on public.office_presence_checkins (user_id, valid_until desc);
alter table public.office_presence_checkins enable row level security;
revoke all on public.office_presence_checkins from anon, authenticated;
grant all on public.office_presence_checkins to service_role;

-- Até quando vale uma chegada: 9h do dia seguinte (São Paulo); chegada no sábado vale até 9h de segunda.
create or replace function public.office_presence_valid_until(p_at timestamptz)
returns timestamptz
language sql
stable
set search_path to 'public'
as $function$
  select (((p_at at time zone 'America/Sao_Paulo')::date
          + case when extract(dow from (p_at at time zone 'America/Sao_Paulo')) = 6 then 2 else 1 end)::timestamp
          + interval '9 hours') at time zone 'America/Sao_Paulo';
$function$;

-- Registra a chegada do dia (idempotente: a 1ª do dia vale; Wi-Fi e manual no mesmo dia não duplicam).
create or replace function public.register_office_checkin(p_user_id uuid, p_source text, p_ip text default null, p_released_by uuid default null)
returns timestamptz
language plpgsql
set search_path to 'public'
as $function$
declare
  v_now timestamptz := now();
  v_until timestamptz;
begin
  insert into public.office_presence_checkins (user_id, checkin_date, first_seen_at, valid_until, source, ip, released_by)
  values (p_user_id, (v_now at time zone 'America/Sao_Paulo')::date, v_now, public.office_presence_valid_until(v_now), p_source, p_ip, p_released_by)
  on conflict (user_id, checkin_date) do nothing;
  select max(valid_until) into v_until from public.office_presence_checkins where user_id = p_user_id;
  return v_until;
end;
$function$;

create or replace function public.office_presence_rule_enabled()
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select coalesce((select (setting_value->>'enabled')::boolean from public.crm_settings where id = 'office_presence'), false);
$function$;

-- Apto pela regra da imobiliária (sempre true com a regra desligada).
create or replace function public.office_presence_ok(p_user_id uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select not public.office_presence_rule_enabled()
      or exists (select 1 from public.office_presence_checkins c where c.user_id = p_user_id and c.valid_until > now());
$function$;

create or replace function public.office_presence_eligible_ids(p_user_ids uuid[])
returns setof uuid
language sql
stable
set search_path to 'public'
as $function$
  select u from unnest(p_user_ids) as u where public.office_presence_ok(u);
$function$;

-- Requisitos extras da roleta além de on-line/ativo: número do WhatsApp ativo (ROL-2d/2e) + veio à imobiliária (ROL-2f).
create or replace function public.roulette_user_extra_eligible(p_user_id uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select public.whatsapp_user_has_active_number(p_user_id) and public.office_presence_ok(p_user_id);
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
    and public.roulette_user_extra_eligible(u.id);

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

-- Só o servidor (service_role) chama estas funções; nunca pelo navegador.
revoke execute on function public.office_presence_valid_until(timestamptz) from public, anon, authenticated;
revoke execute on function public.register_office_checkin(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.office_presence_rule_enabled() from public, anon, authenticated;
revoke execute on function public.office_presence_ok(uuid) from public, anon, authenticated;
revoke execute on function public.office_presence_eligible_ids(uuid[]) from public, anon, authenticated;
revoke execute on function public.roulette_user_extra_eligible(uuid) from public, anon, authenticated;
grant execute on function public.office_presence_valid_until(timestamptz) to service_role;
grant execute on function public.register_office_checkin(uuid, text, text, uuid) to service_role;
grant execute on function public.office_presence_rule_enabled() to service_role;
grant execute on function public.office_presence_ok(uuid) to service_role;
grant execute on function public.office_presence_eligible_ids(uuid[]) to service_role;
grant execute on function public.roulette_user_extra_eligible(uuid) to service_role;
