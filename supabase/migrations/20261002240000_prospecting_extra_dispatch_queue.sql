-- Prospecção extra pelo botão "Disparar" (pedido do dono, 2026-10-02).
-- Aditiva e idempotente. Reaproveita a fila e o motor da automação da Meta
-- Diária (daily_goal_auto_queue + cron whatsapp-meta-diaria-dispatch): o
-- clique NÃO envia — reserva o contato (mesmas travas de
-- claim_single_prospecting_contact), cria a rodada com attempt_count = 0 e
-- põe a 1ª tentativa na fila do corretor, marcada como source = 'extra'.
-- Não existe "lote": cada clique adiciona UM cliente. O ciclo de 10 e o
-- cooldown de 1 h ficam no banco (refresh/logout/troca de aparelho não zeram).

-- 1) Origem do item da fila: 'meta' (Meta Diária, comportamento de sempre)
-- ou 'extra' (botão Disparar). Itens existentes = 'meta'.
alter table public.daily_goal_auto_queue add column if not exists source text not null default 'meta';
alter table public.daily_goal_auto_queue drop constraint if exists daily_goal_auto_queue_source_check;
alter table public.daily_goal_auto_queue add constraint daily_goal_auto_queue_source_check check (source in ('meta', 'extra'));
alter table public.daily_goal_auto_queue add column if not exists extra_cycle_id uuid;

create index if not exists daily_goal_auto_queue_broker_source_idx
  on public.daily_goal_auto_queue (broker_id, source, status, scheduled_for);
create index if not exists daily_goal_auto_queue_extra_cycle_idx
  on public.daily_goal_auto_queue (extra_cycle_id) where extra_cycle_id is not null;
-- "Último envio do número" (cadência entre filas diferentes).
create index if not exists daily_goal_auto_queue_broker_send_started_idx
  on public.daily_goal_auto_queue (broker_id, send_started_at desc) where send_started_at is not null;

-- 2) Origem da rodada. NULL = Meta Diária/prospecção manual (como sempre);
-- 'extra_dispatch' = criada pelo botão Disparar (a 1ª tentativa pertence à
-- fila extra; 2ª/3ª seguem a cadência normal da Meta Diária).
alter table public.daily_goal_rounds add column if not exists origin text;

-- 3) Ciclo de até 10 clientes por corretor.
create table if not exists public.prospecting_extra_dispatch_state (
  broker_id uuid primary key references public.admin_users(id) on delete cascade,
  cycle_id uuid not null default gen_random_uuid(),
  cycle_count integer not null default 0 check (cycle_count >= 0),
  updated_at timestamptz not null default now()
);
alter table public.prospecting_extra_dispatch_state enable row level security;
revoke all on public.prospecting_extra_dispatch_state from anon, authenticated;

-- Estado EFETIVO do ciclo, calculado sempre a partir da fila (nunca de um
-- contador de tela). Cooldown = 1 h depois do último item do ciclo
-- PROCESSADO (enviado ou descartado), só quando o ciclo chegou ao limite e
-- não tem mais nada aguardando envio. Terminado o cooldown, o ciclo vale 0.
create or replace function public.prospecting_extra_dispatch_effective_state(p_broker_id uuid, p_limit integer, p_cooldown_minutes integer)
returns table (cycle_id uuid, cycle_count integer, open_count integer, cooldown_until timestamptz, needs_reset boolean)
language plpgsql stable
set search_path to 'public'
as $$
declare
  v_state public.prospecting_extra_dispatch_state;
  v_open integer;
  v_last timestamptz;
  v_cooldown timestamptz;
begin
  select * into v_state from public.prospecting_extra_dispatch_state s where s.broker_id = p_broker_id;
  if not found then
    return query select null::uuid, 0, 0, null::timestamptz, false;
    return;
  end if;

  select count(*) filter (where q.status in ('pending', 'sending')),
         max(coalesce(q.sent_at, q.updated_at))
    into v_open, v_last
    from public.daily_goal_auto_queue q
   where q.extra_cycle_id = v_state.cycle_id;

  if v_state.cycle_count >= p_limit and coalesce(v_open, 0) = 0 then
    v_cooldown := coalesce(v_last, now()) + make_interval(mins => p_cooldown_minutes);
    if v_cooldown <= now() then
      return query select v_state.cycle_id, 0, 0, null::timestamptz, true;
      return;
    end if;
    return query select v_state.cycle_id, v_state.cycle_count, 0, v_cooldown, false;
    return;
  end if;

  return query select v_state.cycle_id, v_state.cycle_count, coalesce(v_open, 0), null::timestamptz, false;
end;
$$;

create or replace function public.get_extra_prospecting_dispatch_state(p_broker_id uuid, p_limit integer, p_cooldown_minutes integer)
returns jsonb
language sql stable
set search_path to 'public'
as $$
  select jsonb_build_object('cycle_count', e.cycle_count, 'open_count', e.open_count, 'cooldown_until', e.cooldown_until)
    from public.prospecting_extra_dispatch_effective_state(p_broker_id, p_limit, p_cooldown_minutes) e;
$$;

-- 4) Disparar: tudo numa transação, serializado por corretor (advisory lock)
-- — duplo clique e dois requests simultâneos nunca passam de p_limit nem
-- colocam o mesmo cliente duas vezes.
create or replace function public.enqueue_extra_prospecting_dispatch(
  p_contact_id uuid,
  p_broker_id uuid,
  p_today date,
  p_limit integer,
  p_cooldown_minutes integer,
  p_message_text text,
  p_variant_index integer
)
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_now timestamptz := now();
  v_effective record;
  v_existing record;
  v_contact public.prospecting_contacts;
  v_round_id uuid;
  v_queue_id uuid;
  v_cycle_id uuid;
  v_count integer;
begin
  if coalesce(btrim(p_message_text), '') = '' then
    raise exception 'EXTRA_MESSAGE_EMPTY' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('extra_dispatch:' || p_broker_id::text));

  -- Idempotência: o mesmo contato já está na fila extra deste corretor.
  select q.id, q.round_id into v_existing
    from public.daily_goal_auto_queue q
    join public.daily_goal_rounds r on r.id = q.round_id
   where q.contact_id = p_contact_id and q.broker_id = p_broker_id and q.source = 'extra'
     and q.status in ('pending', 'sending', 'sent') and r.status = 'active'
   limit 1;
  if found then
    select s.cycle_count into v_count from public.prospecting_extra_dispatch_state s where s.broker_id = p_broker_id;
    return jsonb_build_object('already', true, 'queue_id', v_existing.id, 'round_id', v_existing.round_id, 'cycle_count', coalesce(v_count, 0));
  end if;

  select * into v_effective from public.prospecting_extra_dispatch_effective_state(p_broker_id, p_limit, p_cooldown_minutes);
  if v_effective.cooldown_until is not null then
    raise exception 'EXTRA_COOLDOWN:%', greatest(1, ceil(extract(epoch from (v_effective.cooldown_until - v_now)) / 60))::integer using errcode = 'P0001';
  end if;
  if not v_effective.needs_reset and v_effective.cycle_count >= p_limit then
    raise exception 'EXTRA_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  insert into public.prospecting_extra_dispatch_state (broker_id) values (p_broker_id)
  on conflict (broker_id) do nothing;
  if v_effective.needs_reset then
    update public.prospecting_extra_dispatch_state
       set cycle_id = gen_random_uuid(), cycle_count = 0, updated_at = v_now
     where broker_id = p_broker_id;
  end if;

  if public.daily_goal_reserve_wallet_slots(p_broker_id, 1) <= 0 then
    raise exception 'WALLET_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  -- Mesmas travas de claim_single_prospecting_contact + base individual só
  -- do próprio dono + nenhuma rodada ativa da mesma pessoa (telefone ou
  -- cadastro) — Meta Diária e fila extra nunca agendam o mesmo cliente.
  update public.prospecting_contacts p
     set status = 'claimed', assigned_user_id = p_broker_id, last_broker_id = p_broker_id,
         last_attempt_at = v_now, available_after = null, updated_at = v_now
   where p.id = p_contact_id
     and p.assigned_user_id is null
     and (p.status = 'available' or (p.status = 'recent_attempt' and p.available_after <= v_now))
     and (p.owner_user_id is null or p.owner_user_id = p_broker_id)
     and public.is_usable_contact_name(p.name)
     and not exists (
       select 1 from public.simulation_registrations r
        where (r.id = p.registration_id or r.phone_normalized = p.phone_normalized)
          and r.status in ('do_not_contact', 'sale_completed')
     )
     and not exists (
       select 1 from public.daily_goal_rounds dr
         join public.prospecting_contacts c2 on c2.id = dr.prospecting_contact_id
        where dr.status = 'active'
          and (c2.phone_normalized = p.phone_normalized or (p.registration_id is not null and c2.registration_id = p.registration_id))
     )
  returning p.* into v_contact;
  if not found then
    raise exception 'CONTACT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  insert into public.daily_goal_rounds (prospecting_contact_id, client_id, broker_id, round_started_at, attempt_count, status, origin)
  values (v_contact.id, v_contact.registration_id, p_broker_id, p_today, 0, 'active', 'extra_dispatch')
  returning id into v_round_id;

  select s.cycle_id into v_cycle_id from public.prospecting_extra_dispatch_state s where s.broker_id = p_broker_id;

  -- +1 min: o servidor termina de vincular o cliente antes do cron pegar o item.
  insert into public.daily_goal_auto_queue (round_id, broker_id, contact_id, attempt_number, message_text, scheduled_for, status, variant_index, source, extra_cycle_id)
  values (v_round_id, p_broker_id, v_contact.id, 1, p_message_text, v_now + interval '1 minute', 'pending', p_variant_index, 'extra', v_cycle_id)
  returning id into v_queue_id;

  update public.prospecting_extra_dispatch_state
     set cycle_count = cycle_count + 1, updated_at = v_now
   where broker_id = p_broker_id
  returning cycle_count into v_count;

  return jsonb_build_object('already', false, 'queue_id', v_queue_id, 'round_id', v_round_id, 'cycle_count', v_count, 'contact', to_jsonb(v_contact));
end;
$$;

-- Desfaz um Disparar cuja preparação do cliente falhou depois da reserva
-- (mesma ideia do catch de claimProspectingContact), devolvendo a vaga do ciclo.
create or replace function public.revert_extra_prospecting_dispatch(p_queue_id uuid)
returns boolean
language plpgsql
set search_path to 'public'
as $$
declare
  v_item public.daily_goal_auto_queue;
  v_now timestamptz := now();
begin
  select * into v_item from public.daily_goal_auto_queue where id = p_queue_id and source = 'extra';
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtext('extra_dispatch:' || v_item.broker_id::text));
  update public.daily_goal_auto_queue set status = 'canceled', skip_reason = 'falha_ao_preparar_cliente', updated_at = v_now
   where id = p_queue_id and status = 'pending';
  if not found then return false; end if;
  update public.daily_goal_rounds set status = 'ended_no_conversion', ended_at = v_now
   where id = v_item.round_id and status = 'active' and attempt_count = 0;
  update public.prospecting_contacts set status = 'available', assigned_user_id = null, updated_at = v_now
   where id = v_item.contact_id and assigned_user_id = v_item.broker_id;
  update public.prospecting_extra_dispatch_state set cycle_count = greatest(cycle_count - 1, 0), updated_at = v_now
   where broker_id = v_item.broker_id and cycle_id = v_item.extra_cycle_id;
  return true;
end;
$$;

-- 5) Um envio por vez por número: as duas filas (meta e extra) reivindicam
-- sob o mesmo lock por corretor e nunca enquanto outro item dele está em
-- 'sending' — cron duplicado/sobreposto não gera dois envios colados.
create or replace function public.claim_next_daily_goal_auto_item(p_broker_id uuid)
returns public.daily_goal_auto_queue
language plpgsql
as $$
declare
  v_id uuid;
  v_row public.daily_goal_auto_queue;
begin
  perform pg_advisory_xact_lock(hashtext('dispatch_send:' || p_broker_id::text));
  if exists (select 1 from public.daily_goal_auto_queue where broker_id = p_broker_id and status = 'sending') then
    return null;
  end if;

  select id into v_id
  from public.daily_goal_auto_queue
  where broker_id = p_broker_id
    and status = 'pending'
    and source = 'meta'
    and scheduled_for <= now()
  order by scheduled_for asc
  limit 1
  for update skip locked;

  if v_id is null then
    return null;
  end if;

  update public.daily_goal_auto_queue
  set status = 'sending', updated_at = now()
  where id = v_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.claim_next_extra_dispatch_item(p_broker_id uuid)
returns public.daily_goal_auto_queue
language plpgsql
as $$
declare
  v_id uuid;
  v_row public.daily_goal_auto_queue;
begin
  perform pg_advisory_xact_lock(hashtext('dispatch_send:' || p_broker_id::text));
  if exists (select 1 from public.daily_goal_auto_queue where broker_id = p_broker_id and status = 'sending') then
    return null;
  end if;

  select id into v_id
  from public.daily_goal_auto_queue
  where broker_id = p_broker_id
    and status = 'pending'
    and source = 'extra'
    and scheduled_for <= now()
  order by scheduled_for asc, created_at asc
  limit 1
  for update skip locked;

  if v_id is null then
    return null;
  end if;

  update public.daily_goal_auto_queue
  set status = 'sending', updated_at = now()
  where id = v_id
  returning * into v_row;

  return v_row;
end;
$$;

-- 6) Retry técnico preserva a fila de origem (um retry da fila extra
-- continua extra e no mesmo ciclo).
create or replace function public.insert_daily_goal_auto_queue_items(items jsonb)
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  inserted_count integer;
begin
  with input_rows as (
    select * from jsonb_to_recordset(items) as x(
      round_id uuid, broker_id uuid, contact_id uuid, attempt_number integer,
      message_text text, scheduled_for timestamptz, status text, variant_index integer,
      source text, extra_cycle_id uuid
    )
  ), inserted as (
    insert into public.daily_goal_auto_queue (round_id, broker_id, contact_id, attempt_number, message_text, scheduled_for, status, variant_index, source, extra_cycle_id)
    select round_id, broker_id, contact_id, attempt_number, message_text, scheduled_for, status, variant_index, coalesce(source, 'meta'), extra_cycle_id
    from input_rows
    on conflict (round_id, attempt_number) where status = any(array['pending','sending','sent']) do nothing
    returning 1
  )
  select count(*) into inserted_count from inserted;
  return inserted_count;
end;
$$;

-- 7) Só o servidor (service role) chama estas funções — nunca anon/authenticated.
revoke execute on function public.prospecting_extra_dispatch_effective_state(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.get_extra_prospecting_dispatch_state(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.enqueue_extra_prospecting_dispatch(uuid, uuid, date, integer, integer, text, integer) from public, anon, authenticated;
revoke execute on function public.revert_extra_prospecting_dispatch(uuid) from public, anon, authenticated;
revoke execute on function public.claim_next_extra_dispatch_item(uuid) from public, anon, authenticated;
revoke execute on function public.claim_next_daily_goal_auto_item(uuid) from public, anon, authenticated;
grant execute on function public.prospecting_extra_dispatch_effective_state(uuid, integer, integer) to service_role;
grant execute on function public.get_extra_prospecting_dispatch_state(uuid, integer, integer) to service_role;
grant execute on function public.enqueue_extra_prospecting_dispatch(uuid, uuid, date, integer, integer, text, integer) to service_role;
grant execute on function public.revert_extra_prospecting_dispatch(uuid) to service_role;
grant execute on function public.claim_next_extra_dispatch_item(uuid) to service_role;
grant execute on function public.claim_next_daily_goal_auto_item(uuid) to service_role;
