-- A função assign_round_robin_lead (sem presença) NÃO é alterada: continua como
-- reserva usada por lib/lead-distribution.js se esta função falhar por qualquer motivo.
--
-- Roleta por presença: só quem está online (admin_presence) recebe o lead,
-- em ordem de fila; quem está offline é PULADO sem perder o lugar (só quem
-- recebe vai para o fim da fila — regra que já existia). Ver
-- lib/lead-distribution.js (assignRoundRobinLead) e
-- .claude/rules/roleta-prospeccao-campanhas.md.
--
-- Camadas (nunca deixa o lead sem dono):
--   1 online e sem lead novo aguardando 1º contato
--   2 online (já tem lead novo aguardando)
--   3 ausente (interagiu nos últimos 30 min)
--   4 qualquer elegível (comportamento anterior)
-- Dentro de cada camada vale a ordem da fila (lead_distribution_position).
-- "Online" = mesma janela da tela Online: last_activity_at >= agora - 5 min
-- (inclui a tolerância de quem acabou de clicar em WhatsApp, gravada no
-- futuro). "Lead novo aguardando contato" = distribuído pela roleta, ainda
-- 'pending', sem contato de WhatsApp, nos últimos 15 min.

create or replace function public.pick_round_robin_broker(excluded_broker_id uuid default null)
returns table (picked_broker_id uuid, picked_tier text, skipped_ids uuid[])
language plpgsql
security invoker
set search_path = public
as $$
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
  ), ranked as (
    select
      id, pos, lname,
      case
        when last_activity_at >= now() - interval '5 minutes' and not has_waiting then 1
        when last_activity_at >= now() - interval '5 minutes' then 2
        when last_activity_at >= now() - interval '30 minutes' then 3
        else 4
      end as tier_rank
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
    case chosen_rank when 1 then 'online' when 2 then 'online_ocupado' when 3 then 'ausente' else 'offline' end,
    coalesce(ordered_ids[1:chosen_index - 1], '{}'::uuid[]);
end;
$$;

revoke all on function public.pick_round_robin_broker(uuid) from public, anon, authenticated;
grant execute on function public.pick_round_robin_broker(uuid) to service_role;
