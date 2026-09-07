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

create or replace function public.assign_round_robin_lead(excluded_broker_id uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  broker_ids uuid[];
  last_id uuid;
  start_position integer;
  candidate_id uuid;
  candidate_offset integer;
  final_position integer;
begin
  perform pg_advisory_xact_lock(hashtext('lead_distribution_round_robin'));

  select array_agg(id order by lead_distribution_position nulls last, lower(name), id)
    into broker_ids
  from public.admin_users
  where status = 'active'
    and role in ('admin', 'manager', 'broker', 'associate')
    and lead_distribution_enabled = true;

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
  set lead_distribution_position = final_position
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
$$;

revoke all on function public.assign_round_robin_lead(uuid) from public, anon, authenticated;
grant execute on function public.assign_round_robin_lead(uuid) to service_role;
