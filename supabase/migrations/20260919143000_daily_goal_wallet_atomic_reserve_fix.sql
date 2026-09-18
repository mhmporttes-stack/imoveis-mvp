-- Corrige uma falha real de concorrência encontrada em teste ao vivo: a
-- versão anterior de claim_daily_goal_contacts/claim_single_prospecting_contact
-- CONSULTAVA a carteira ativa (contagem de daily_goal_rounds) dentro da trava
-- por advisory lock, mas a RODADA em si só era criada DEPOIS, em código JS
-- separado — ou seja, nada dentro da seção travada incrementava a contagem
-- que a própria trava lia. Resultado comprovado em teste: 5 chamadas
-- concorrentes pedindo 1 vaga cada, com limite 3, concederam 5 (deveriam
-- conceder no máximo 3). Corrigido criando a rodada (daily_goal_rounds) DENTRO
-- da mesma função/transação que faz a checagem — agora a contagem que a
-- trava lê realmente muda antes da próxima chamada concorrente conseguir ler.

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
        select id from public.prospecting_contacts
        where assigned_user_id is null
          and (status = 'available' or (status = 'recent_attempt' and available_after <= v_now))
        order by queue_sort_at asc
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

  return query
    with claimed as (
      update public.prospecting_contacts
      set status = 'claimed', assigned_user_id = p_broker_id, last_broker_id = p_broker_id, last_attempt_at = v_now, available_after = null, updated_at = v_now
      where id = p_contact_id
        and assigned_user_id is null
        and (status = 'available' or (status = 'recent_attempt' and available_after <= v_now))
      returning *
    ),
    inserted_round as (
      insert into public.daily_goal_rounds (prospecting_contact_id, client_id, broker_id, round_started_at, attempt_count, status)
      select id, registration_id, p_broker_id, p_today, 1, 'active' from claimed
      returning id
    )
    select claimed.* from claimed;
end;
$function$;
