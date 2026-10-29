-- [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-29] ROL-2k Roleta só do Marketplace.
-- "Adicione a Caroline Mayumi na roleta dos clientes do Marketplace seguindo as mesmas regras dos corretores" — escolha
-- do dono: SÓ no Marketplace. Opção nova por pessoa admin_users.marketplace_roulette_only: quem tem
-- lead_distribution_enabled = false e marketplace_roulette_only = true entra SÓ no sorteio do Marketplace
-- (lib/marketplace-chat.js distribute → assignRoundRobinLead({ origin: "marketplace" })), com TODAS as regras da roleta
-- (on-line 5 min, WhatsApp conectado/ativo/sem restrição, presença ROL-2f, 10 min ROL-2h, trava ROL-2j). Nunca entra em
-- leads novos, Chat, anúncio, fila de espera comum, Fluxos, Messenger nem clientes frios (essas chamadas não passam
-- origem → 'leads', comportamento idêntico ao anterior).
--
-- pick_round_robin_broker ganha o parâmetro distribution_origin (default 'leads'). Corpo = definição viva em produção
-- (conferida em 2026-10-29, igual à migration 20261019235500) + o filtro de origem + a renumeração da fila incluindo
-- quem está só no Marketplace. A assinatura muda, então a antiga (uuid) é removida para não haver sobrecarga ambígua.
-- Sem esta migration o código JS segue como antes (RPC com origem ausente → chamada sem origem).
-- Aditiva e idempotente. NÃO aplicada automaticamente (DECISÃO NECESSÁRIA).

alter table public.admin_users
  add column if not exists marketplace_roulette_only boolean not null default false;

comment on column public.admin_users.marketplace_roulette_only is
  'ROL-2k (dono, 2026-10-29): com lead_distribution_enabled=false, participa só da roleta do Marketplace.';

drop function if exists public.pick_round_robin_broker(uuid);

create or replace function public.pick_round_robin_broker(excluded_broker_id uuid default null::uuid, distribution_origin text default 'leads')
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
          and r.status in ('pending', 'auto_simulation')
          and r.last_whatsapp_contact_at is null
          and coalesce(r.responsible_changed_at, r.created_at) >= now() - interval '15 minutes'
      ) as has_waiting
    from public.admin_users u
    left join public.admin_presence p on p.user_id = u.id
    where u.status = 'active'
      and u.role in ('admin', 'manager', 'broker', 'associate')
      -- ROL-2k (dono, 2026-10-29): "só Marketplace" entra apenas quando a origem é o Marketplace.
      and (
        u.lead_distribution_enabled = true
        or (distribution_origin = 'marketplace' and u.marketplace_roulette_only = true)
      )
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
      and (lead_distribution_enabled = true or marketplace_roulette_only = true)
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

-- Só o servidor (service_role) chama; nunca pelo navegador.
revoke all on function public.pick_round_robin_broker(uuid, text) from public, anon, authenticated;
grant execute on function public.pick_round_robin_broker(uuid, text) to service_role;

notify pgrst, 'reload schema';
