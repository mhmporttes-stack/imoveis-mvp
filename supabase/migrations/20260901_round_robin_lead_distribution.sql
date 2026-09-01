alter table public.admin_users
  add column if not exists lead_distribution_enabled boolean not null default false;

alter table public.simulation_registrations
  add column if not exists distribution_type text not null default '';

create table if not exists public.lead_distribution_state (
  id text primary key,
  last_broker_id uuid references public.admin_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.lead_distribution_state enable row level security;
revoke all on public.lead_distribution_state from anon, authenticated;
grant all on public.lead_distribution_state to service_role;

create or replace function public.assign_round_robin_lead()
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  broker_ids uuid[];
  last_id uuid;
  last_position integer;
  selected_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('lead_distribution_round_robin'));

  select array_agg(id order by lower(name), id)
    into broker_ids
  from public.admin_users
  where status = 'active'
    and role in ('admin', 'broker')
    and lead_distribution_enabled = true;

  if broker_ids is null or array_length(broker_ids, 1) is null then return null; end if;

  select last_broker_id into last_id
  from public.lead_distribution_state
  where id = 'default';

  last_position := array_position(broker_ids, last_id);
  selected_id := broker_ids[case
    when last_position is null or last_position >= array_length(broker_ids, 1) then 1
    else last_position + 1
  end];

  insert into public.lead_distribution_state (id, last_broker_id, updated_at)
  values ('default', selected_id, now())
  on conflict (id) do update
    set last_broker_id = excluded.last_broker_id,
        updated_at = excluded.updated_at;

  return selected_id;
end;
$$;

revoke all on function public.assign_round_robin_lead() from public, anon, authenticated;
grant execute on function public.assign_round_robin_lead() to service_role;
