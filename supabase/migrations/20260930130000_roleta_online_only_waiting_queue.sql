-- Roleta passa a distribuir SÓ entre corretores on-line (regra do dono,
-- 2026-09-30). Quando ninguém está on-line, o cliente/cadastro é criado
-- mesmo assim, sem responsável (pending_distribution_at marca "aguardando
-- distribuição") — o cron de reconciliação (lib/lead-distribution.js
-- reassignPendingRouletteLeads, chamado em app/api/cron/scheduled-activities)
-- distribui assim que o primeiro corretor fica on-line, respeitando a
-- mesma ordem de fila de sempre (lead_distribution_position).
--
-- "On-line" aqui é estritamente a mesma janela de 5 min já usada em outros
-- lugares do sistema (lib/admin-presence.js) — NÃO inclui "ausente" (5-30
-- min). As camadas 3 (ausente) e 4 (qualquer elegível) da função anterior
-- são removidas; a função já tinha o caminho "ninguém encontrado -> não
-- retorna linha" pronto, só nunca era alcançado antes.

-- ---------------------------------------------------------------------------
-- PARTE 1 — marca de "aguardando distribuição pela roleta"
-- ---------------------------------------------------------------------------
alter table public.simulation_registrations
  add column if not exists pending_distribution_at timestamptz;

comment on column public.simulation_registrations.pending_distribution_at is
  'Setado quando a roleta não achou corretor on-line no momento da criação (fila "aguardando"); limpo assim que um corretor é atribuído pela reconciliação (lib/lead-distribution.js reassignPendingRouletteLeads).';

create index if not exists simulation_registrations_pending_distribution_idx
  on public.simulation_registrations (pending_distribution_at)
  where pending_distribution_at is not null;

-- ---------------------------------------------------------------------------
-- PARTE 2 — pick_round_robin_broker: só tiers 1/2 (on-line), sem fallback
-- ---------------------------------------------------------------------------
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
      and p.last_activity_at >= now() - interval '5 minutes'
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
$$;

-- ---------------------------------------------------------------------------
-- PARTE 3 — whatsapp_get_or_create_roulette_client: cria o cliente mesmo
-- sem corretor disponível (antes retornava sem criar nada)
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_get_or_create_roulette_client(
  p_candidates text[], p_full_name text, p_phone text, p_phone_normalized text, p_context jsonb,
  p_conversation_id uuid default null::uuid, p_history_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_existing_id uuid;
  v_broker_id uuid;
  v_tier text;
  v_skipped uuid[];
  v_skipped_names text[];
  v_broker_name text;
  v_new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('whatsapp_client_phone:' || public.whatsapp_phone_lock_key(p_phone_normalized)));
  select r.id into v_existing_id
    from public.simulation_registrations r
   where r.phone_normalized = any(p_candidates)
   order by r.created_at desc
   limit 1;
  if v_existing_id is not null then
    if p_conversation_id is not null then
      update public.whatsapp_conversations set client_id = v_existing_id, updated_at = now()
       where id = p_conversation_id and client_id is null;
    end if;
    return jsonb_build_object('registration_id', v_existing_id, 'already_existed', true, 'broker_id', null);
  end if;
  begin
    select p.picked_broker_id, p.picked_tier, p.skipped_ids
      into v_broker_id, v_tier, v_skipped
      from public.pick_round_robin_broker(null) p;
  exception when others then
    v_broker_id := null;
    v_tier := null;
    v_skipped := '{}'::uuid[];
  end;
  if v_broker_id is not null then
    select u.name into v_broker_name from public.admin_users u where u.id = v_broker_id;
    select coalesce(array_agg(u.name order by u.name), '{}'::text[]) into v_skipped_names
      from public.admin_users u where u.id = any(coalesce(v_skipped, '{}'::uuid[]));
  end if;
  insert into public.simulation_registrations (
    simulation_type, full_name, phone, phone_normalized, oldest_birth_date, primary_income_type,
    primary_profession, primary_monthly_income, has_over_three_years_registered_work,
    has_children_under_18, primary_marital_status, has_residential_property,
    status, responsible_user_id, distribution_type, pending_distribution_at, acquisition_context
  ) values (
    'individual', p_full_name, p_phone, p_phone_normalized, date '1900-01-01', 'self_employed_unregistered',
    'Nao informado', 0, false,
    false, 'single', false,
    'automated_service', v_broker_id, 'round_robin',
    case when v_broker_id is null then now() else null end,
    coalesce(p_context, '{}'::jsonb) || jsonb_build_object(
      'metadata', coalesce(p_context->'metadata', '{}'::jsonb) || jsonb_build_object('brokerId', v_broker_id, 'brokerName', coalesce(v_broker_name, ''))
    )
  ) returning id into v_new_id;
  insert into public.lead_distribution_history (registration_id, client_name, event_type, to_user_id, details)
  values (
    v_new_id, p_full_name, 'assigned', v_broker_id,
    coalesce(p_history_details, '{}'::jsonb) || jsonb_build_object('presenceTier', v_tier, 'skipped', to_jsonb(v_skipped_names))
  );
  if p_conversation_id is not null then
    update public.whatsapp_conversations
       set client_id = v_new_id, assigned_user_id = v_broker_id, updated_at = now()
     where id = p_conversation_id;
  end if;
  return jsonb_build_object(
    'registration_id', v_new_id,
    'already_existed', false,
    'broker_id', v_broker_id,
    'tier', v_tier,
    'skipped_ids', to_jsonb(coalesce(v_skipped, '{}'::uuid[]))
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- PARTE 4 — rede de segurança "nenhum cliente sem responsável" nunca deve
-- "resgatar" quem está de propósito aguardando a roleta
-- ---------------------------------------------------------------------------
-- (sem alteração de schema aqui — o filtro fica no lado JS,
-- lib/simulation-registrations.js reassignOrphanedClientsToOwner, que passa
-- a excluir pending_distribution_at is not null)
