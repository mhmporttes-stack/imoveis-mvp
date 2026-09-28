-- Duas falhas reais reportadas pelo dono em 2026-09-28, as duas no mesmo motor de
-- reivindicação da fila (claim_daily_goal_contacts / claim_single_prospecting_contact):
--
-- 1) Contato sem nome de verdade ("Sem Nome", faxina de 2026-09-27) continuava caindo na
--    Meta Diária dos corretores — a regra "nunca sortear contato sem nome" só tinha sido
--    aplicada em pick_broadcast_base_contacts (Disparo, migration 20260927090000), nunca
--    nas duas funções que alimentam a Meta Diária/Prospecção manual.
-- 2) Cliente marcado "Não contactar novamente" (ex.: já comprou, pediu pra parar) reapareceu
--    na Meta Diária da Jennyfer horas depois — causa raiz: a MESMA pessoa tinha 5 linhas
--    diferentes em prospecting_contacts (5 números de telefone distintos, todas com o mesmo
--    registration_id, provavelmente da importação). Marcar "não contactar" numa dessas linhas
--    (ou no cadastro do cliente) nunca propagava pras OUTRAS linhas do mesmo cliente, então elas
--    continuavam 'available'/'recent_attempt' e eram reivindicadas de novo — mandando mensagem
--    pra quem já pediu pra não ser contactado, o que está por trás dos números da imobiliária
--    sendo banidos pelo WhatsApp.
--
-- Corrige as duas nas mesmas 2 funções (nunca reivindicar nome inutilizável OU contato ligado a
-- um cliente do_not_contact/sale_completed, casando por registration_id OU phone_normalized —
-- cobre tanto a linha "oficial" do cliente quanto as duplicatas por outro telefone) e faz a
-- faxina retroativa: qualquer linha de prospecting_contacts hoje presa nessa situação vira
-- do_not_contact de vez, e qualquer rodada ativa presa num contato agora inelegível é encerrada
-- (o próximo carregamento da Meta Diária do corretor já completa a cota automaticamente com
-- contatos válidos, mesmo mecanismo de sempre — não precisa de escolha manual).
--
-- Aplicado direto em produção em 2026-09-28 (ver .claude/rules/database-supabase.md para o
-- fluxo real de aplicação deste projeto). Idempotente: rodar de novo não muda nada além de
-- recriar as mesmas 2 funções.

-- ---------------------------------------------------------------------------
-- PARTE 1 — faxina retroativa: qualquer prospecting_contacts ligado (por
-- registration_id OU telefone) a um cliente do_not_contact/sale_completed
-- que ainda não está com esse status vira do_not_contact agora.
-- ---------------------------------------------------------------------------
update public.prospecting_contacts p
set status = 'do_not_contact', assigned_user_id = null, available_after = null, updated_at = now()
where p.status <> 'do_not_contact'
  and exists (
    select 1 from public.simulation_registrations r
    where (r.id = p.registration_id or r.phone_normalized = p.phone_normalized)
      and r.status in ('do_not_contact', 'sale_completed')
  );

-- ---------------------------------------------------------------------------
-- PARTE 2 — encerra qualquer rodada ATIVA hoje presa num contato agora
-- inelegível (sem nome usável, OU do_not_contact após a faxina acima).
-- ---------------------------------------------------------------------------
update public.daily_goal_rounds r
set status = 'ended_no_conversion', ended_at = now()
where r.status = 'active'
  and exists (
    select 1 from public.prospecting_contacts p
    where p.id = r.prospecting_contact_id
      and (p.status = 'do_not_contact' or not public.is_usable_contact_name(p.name))
  );

-- Contato sem nome (não é do_not_contact de verdade, só dado ruim) libera de
-- volta pra 'available' já sem responsável — nunca mais será reivindicado por
-- causa do filtro de nome nas duas funções abaixo, mas o status não precisa
-- ficar preso em 'claimed' indicando um corretor que já não trabalha mais nele.
update public.prospecting_contacts
set status = 'available', assigned_user_id = null, available_after = null, updated_at = now()
where status = 'claimed'
  and not public.is_usable_contact_name(name);

-- ---------------------------------------------------------------------------
-- PARTE 3 — as duas funções de reivindicação passam a exigir nome usável E
-- ausência de vínculo (por registration_id OU telefone) com um cliente
-- do_not_contact/sale_completed. Mesmo corpo de antes (migration 20260919143000),
-- só com as duas condições novas acrescentadas ao WHERE do UPDATE.
-- ---------------------------------------------------------------------------
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
