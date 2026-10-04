-- "Imprimir lista" da Prospecção (pedido do dono, 2026-10-04).
--
-- O administrador/gestor escolhe um corretor ou associado, clica em "Imprimir lista" e o sistema RESERVA até
-- 30 contatos da Base da Imobiliária para prospecção MANUAL (lista em papel) daquela pessoa. Cada contato fica
-- em UMA única lista; reimprimir a lista nunca escolhe outros contatos (o nome e o telefone ficam gravados na
-- hora da geração).
--
-- É ADITIVA e idempotente: 2 tabelas novas + 1 função nova + as 3 funções que hoje entregam contatos da fila
-- (Meta Diária, Prospecção manual e fila extra "Disparar") passam a PULAR contato reservado numa lista manual.
-- NÃO altera nenhum dado existente: a geração não apaga, não atribui, não muda status/etapa/tentativa de
-- prospecting_contacts, não cria cliente, não registra tentativa e não dá pontos. Só grava nas tabelas novas.
--
-- Consequência a conhecer: como não existe "liberar lista", os contatos de uma lista ficam reservados
-- indefinidamente (fora de qualquer outra entrega). Ver docs/BUSINESS_RULES.md (PRO-15).
--
-- Aplicação neste projeto: não é `supabase db push` (ver .claude/rules/database-supabase.md). Aplicar este
-- arquivo uma única vez; rodar de novo não muda nada (create if not exists / create or replace).

-- ---------------------------------------------------------------------------
-- 1) Tabelas novas (RLS ligado, SEM policy pública; só o servidor com a service role acessa)
-- ---------------------------------------------------------------------------

create table if not exists public.prospecting_manual_lists (
  id uuid primary key default gen_random_uuid(),
  -- Número legível para o dono ("Lista nº 12"), sequencial, nunca reaproveitado.
  numero bigint generated always as identity,
  -- Corretor/associado dono da lista. set null: se o usuário for removido, a lista (e o histórico) continua.
  broker_id uuid references public.admin_users(id) on delete set null,
  -- Nome na hora da geração: o cabeçalho do PDF reimpresso é sempre o mesmo.
  broker_name_snapshot text not null default '',
  -- ADMINISTRADOR REAL que gerou (mesmo durante "Alterar conta"): é ação administrativa.
  generated_by_user_id uuid references public.admin_users(id) on delete set null,
  generated_by_email text not null default '',
  -- Chave de idempotência por clique: repetir a mesma chave devolve a MESMA lista (nunca gera outra).
  request_key text,
  label text,
  status text not null default 'active' check (status in ('active')),
  contact_count smallint not null default 0 check (contact_count between 0 and 30),
  created_at timestamptz not null default now()
);

create unique index if not exists prospecting_manual_lists_numero_key on public.prospecting_manual_lists (numero);
create unique index if not exists prospecting_manual_lists_request_key_key on public.prospecting_manual_lists (request_key) where request_key is not null;
create index if not exists prospecting_manual_lists_broker_created_idx on public.prospecting_manual_lists (broker_id, created_at desc);
create index if not exists prospecting_manual_lists_created_idx on public.prospecting_manual_lists (created_at desc);

create table if not exists public.prospecting_manual_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.prospecting_manual_lists(id) on delete cascade,
  -- set null: se alguém excluir o contato da fila, o item (nome/telefone gravados) continua na lista impressa.
  contact_id uuid references public.prospecting_contacts(id) on delete set null,
  position smallint not null check (position between 1 and 30),
  -- Cópia do nome e do telefone (E.164) na hora da geração: a lista nunca muda depois.
  name_snapshot text not null,
  phone_snapshot text not null,
  created_at timestamptz not null default now()
);

-- UM contato em UMA lista manual (impede entrega duplicada). Vários NULL (contato excluído) são permitidos.
create unique index if not exists prospecting_manual_list_items_contact_key on public.prospecting_manual_list_items (contact_id);
create unique index if not exists prospecting_manual_list_items_list_position_key on public.prospecting_manual_list_items (list_id, position);
create index if not exists prospecting_manual_list_items_list_idx on public.prospecting_manual_list_items (list_id);

alter table public.prospecting_manual_lists enable row level security;
alter table public.prospecting_manual_list_items enable row level security;
revoke all on public.prospecting_manual_lists from anon, authenticated;
revoke all on public.prospecting_manual_list_items from anon, authenticated;
grant all on public.prospecting_manual_lists to service_role;
grant all on public.prospecting_manual_list_items to service_role;

-- ---------------------------------------------------------------------------
-- 2) Geração atômica da lista (só o servidor chama)
-- ---------------------------------------------------------------------------
-- Elegibilidade = a MESMA que a Prospecção já usa para entregar contato (claim_daily_goal_contacts /
-- claim_single_prospecting_contact / enqueue_extra_prospecting_dispatch), na mesma ordem da fila
-- (queue_sort_at, a mais antiga primeiro):
--   * Base da Imobiliária (owner_user_id nulo), sem responsável, 'available' ou 'recent_attempt' já vencido;
--   * nome usável (is_usable_contact_name) e telefone de celular brasileiro válido;
--   * sem vínculo (registration_id OU telefone) com cliente 'do_not_contact'/'sale_completed' e sem linha
--     irmã (mesmo telefone) marcada 'do_not_contact';
--   * nenhuma rodada ativa da mesma pessoa na Meta Diária/fila extra;
--   * sem cliente existente (mesmo cadastro ou telefone) com OUTRO corretor responsável;
--   * não reservado em nenhuma lista manual.
-- FOR UPDATE SKIP LOCKED + UNIQUE(contact_id): duas gerações simultâneas nunca entregam o mesmo contato.
-- Menos de 30 elegíveis: gera com o que houver; nenhum elegível: erro MANUAL_LIST_NO_CONTACTS (nada é gravado).
create or replace function public.create_prospecting_manual_list(
  p_broker_id uuid,
  p_limit integer,
  p_generated_by_user_id uuid,
  p_generated_by_email text,
  p_request_key text,
  p_broker_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 30);
  v_now timestamptz := now();
  v_key text := nullif(btrim(coalesce(p_request_key, '')), '');
  v_existing public.prospecting_manual_lists;
  v_broker_name text;
  v_list public.prospecting_manual_lists;
  v_row record;
  v_count integer := 0;
  v_inserted integer;
  v_found integer;
  v_pass integer := 0;
begin
  if v_key is not null then
    perform pg_advisory_xact_lock(hashtext('manual_list_key:' || v_key));
    select * into v_existing from public.prospecting_manual_lists l where l.request_key = v_key;
    if found then
      return jsonb_build_object('already', true, 'list_id', v_existing.id, 'numero', v_existing.numero, 'contact_count', v_existing.contact_count);
    end if;
  end if;

  select u.name into v_broker_name from public.admin_users u where u.id = p_broker_id and u.status = 'active';
  if not found then
    raise exception 'MANUAL_LIST_BROKER_INVALID' using errcode = 'P0001';
  end if;

  loop
    v_pass := v_pass + 1;
    exit when v_pass > 5 or v_count >= v_limit;
    v_found := 0;

    for v_row in
      select p.id, p.name, p.phone_normalized
        from public.prospecting_contacts p
       where p.owner_user_id is null
         and p.assigned_user_id is null
         and (p.status = 'available' or (p.status = 'recent_attempt' and p.available_after <= v_now))
         and public.is_usable_contact_name(p.name)
         and p.phone_normalized ~ '^\+55[0-9]{2}9[0-9]{8}$'
         and not exists (select 1 from public.prospecting_manual_list_items mli where mli.contact_id = p.id)
         and not exists (
           select 1 from public.simulation_registrations r
            where (r.id = p.registration_id or r.phone_normalized = p.phone_normalized)
              and r.status in ('do_not_contact', 'sale_completed')
         )
         and not exists (
           select 1 from public.prospecting_contacts x
            where x.phone_normalized = p.phone_normalized and x.status = 'do_not_contact'
         )
         and not exists (
           select 1 from public.daily_goal_rounds dr
             join public.prospecting_contacts c2 on c2.id = dr.prospecting_contact_id
            where dr.status = 'active'
              and (c2.phone_normalized = p.phone_normalized or (p.registration_id is not null and c2.registration_id = p.registration_id))
         )
         and not exists (
           select 1 from public.simulation_registrations r
            where (r.id = p.registration_id or r.phone_normalized = p.phone_normalized)
              and r.responsible_user_id is not null
              and r.responsible_user_id <> p_broker_id
         )
       order by p.queue_sort_at asc, p.id asc
       limit (v_limit - v_count)
       for update of p skip locked
    loop
      v_found := v_found + 1;
      if v_list.id is null then
        insert into public.prospecting_manual_lists (broker_id, broker_name_snapshot, generated_by_user_id, generated_by_email, request_key)
        values (p_broker_id, coalesce(nullif(btrim(coalesce(p_broker_name, '')), ''), v_broker_name), p_generated_by_user_id, coalesce(p_generated_by_email, ''), v_key)
        returning * into v_list;
      end if;
      insert into public.prospecting_manual_list_items (list_id, contact_id, position, name_snapshot, phone_snapshot)
      values (v_list.id, v_row.id, v_count + 1, v_row.name, v_row.phone_normalized)
      on conflict (contact_id) do nothing;
      get diagnostics v_inserted = row_count;
      v_count := v_count + v_inserted;
    end loop;

    exit when v_found = 0;
  end loop;

  if v_list.id is null or v_count = 0 then
    raise exception 'MANUAL_LIST_NO_CONTACTS' using errcode = 'P0001';
  end if;

  update public.prospecting_manual_lists set contact_count = v_count where id = v_list.id;

  return jsonb_build_object('already', false, 'list_id', v_list.id, 'numero', v_list.numero, 'contact_count', v_count);
end;
$$;

revoke all on function public.create_prospecting_manual_list(uuid, integer, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_prospecting_manual_list(uuid, integer, uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Os seletores que entregam contato da fila passam a PULAR contato reservado numa lista manual.
--    Mesmo corpo de produção de cada função (conferido em 2026-10-04), só com a condição nova.
--    Estas funções só são substituídas AQUI, depois de a tabela existir: sem esta migration nada muda.
-- ---------------------------------------------------------------------------

-- Meta Diária (fila automática): migration 20260928200000.
create or replace function public.claim_daily_goal_contacts(p_broker_id uuid, p_quota integer, p_today date)
returns setof prospecting_contacts
language plpgsql
set search_path to 'public'
as $function$
declare
  v_now timestamptz := now();
  v_grant integer;
begin
  v_grant := public.daily_goal_reserve_wallet_slots(p_broker_id, p_quota);
  if v_grant <= 0 then
    return;
  end if;

  return query
    with claimed as (
      update public.prospecting_contacts
      set status = 'claimed', assigned_user_id = p_broker_id, last_broker_id = p_broker_id, updated_at = v_now
      where id in (
        select p.id from public.prospecting_contacts p
        where p.assigned_user_id is null
          and (p.status = 'available' or (p.status = 'recent_attempt' and p.available_after <= v_now))
          and public.is_usable_contact_name(p.name)
          and not exists (
            select 1 from public.simulation_registrations r
            where (r.id = p.registration_id or r.phone_normalized = p.phone_normalized)
              and r.status in ('do_not_contact', 'sale_completed')
          )
          and not exists (select 1 from public.prospecting_manual_list_items mli where mli.contact_id = p.id)
        order by p.queue_sort_at asc
        limit v_grant
        for update skip locked
      )
      returning *
    ),
    inserted_rounds as (
      insert into public.daily_goal_rounds (prospecting_contact_id, client_id, broker_id, round_started_at, attempt_count, status)
      select id, null, p_broker_id, p_today, 0, 'active' from claimed
      returning id
    )
    select claimed.* from claimed;
end;
$function$;

-- Prospecção manual (reivindicar um contato): migration 20260928200000.
-- O "perform ... for update" espera uma geração de lista que esteja terminando nesse mesmo contato e só
-- então reavalia a condição (nova instrução = nova leitura do banco).
create or replace function public.claim_single_prospecting_contact(p_contact_id uuid, p_broker_id uuid, p_today date)
returns setof prospecting_contacts
language plpgsql
set search_path to 'public'
as $function$
declare
  v_now timestamptz := now();
  v_grant integer;
begin
  v_grant := public.daily_goal_reserve_wallet_slots(p_broker_id, 1);
  if v_grant <= 0 then
    raise exception 'WALLET_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  perform 1 from public.prospecting_contacts where id = p_contact_id for update;

  return query
    with claimed as (
      update public.prospecting_contacts p
      set status = 'claimed', assigned_user_id = p_broker_id, last_broker_id = p_broker_id, last_attempt_at = v_now, available_after = null, updated_at = v_now
      where p.id = p_contact_id
        and p.assigned_user_id is null
        and (p.status = 'available' or (p.status = 'recent_attempt' and p.available_after <= v_now))
        and public.is_usable_contact_name(p.name)
        and not exists (
          select 1 from public.simulation_registrations r
          where (r.id = p.registration_id or r.phone_normalized = p.phone_normalized)
            and r.status in ('do_not_contact', 'sale_completed')
        )
        and not exists (select 1 from public.prospecting_manual_list_items mli where mli.contact_id = p.id)
      returning p.*
    ),
    inserted_round as (
      insert into public.daily_goal_rounds (prospecting_contact_id, client_id, broker_id, round_started_at, attempt_count, status)
      select id, registration_id, p_broker_id, p_today, 1, 'active' from claimed
      returning id
    )
    select claimed.* from claimed;
end;
$function$;

-- Fila extra "Disparar": migration 20261002240000.
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

  -- Espera uma geração de lista manual que esteja terminando neste contato (ver claim_single_prospecting_contact).
  perform 1 from public.prospecting_contacts where id = p_contact_id for update;

  -- Mesmas travas de claim_single_prospecting_contact + base individual só
  -- do próprio dono + nenhuma rodada ativa da mesma pessoa (telefone ou
  -- cadastro) — Meta Diária e fila extra nunca agendam o mesmo cliente.
  -- Contato reservado numa lista manual (impressa) também não entra.
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
     and not exists (select 1 from public.prospecting_manual_list_items mli where mli.contact_id = p.id)
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
