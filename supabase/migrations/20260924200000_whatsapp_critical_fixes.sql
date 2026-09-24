-- WhatsApp — correções dos 4 achados CRÍTICOS da auditoria de 2026-09-24.
-- Idempotente (pode ser reaplicada). Nada aqui apaga, funde ou altera cliente existente.
--
-- 1) ATENDIMENTO HUMANO ATIVO (Chat x redistribuição): sinal PRÓPRIO na conversa,
--    separado de last_whatsapp_contact_at (que alimenta Meta Diária/ranking/desempenho).
-- 2) DISPARO sem duplicidade: mensagem adquirida atomicamente + recuperação segura
--    de mensagens presas em 'processando' (nunca reenvia o que a Meta pode ter aceitado).
-- 3) CLIENTE POR TELEFONE via roleta: "existe? -> escolhe corretor -> cria" numa única
--    transação serializada por telefone (dois "sim" simultâneos = 1 cliente).
-- (O 4º crítico — normalização de telefone — é código: lib/phone-utils.js.)

-- ---------------------------------------------------------------------------
-- 1) Atendimento humano ativo
-- ---------------------------------------------------------------------------
alter table public.whatsapp_conversations
  add column if not exists last_human_reply_at timestamptz;

-- Backfill (só leitura do histórico): última mensagem enviada por PESSOA (não
-- automação) que a Meta aceitou.
update public.whatsapp_conversations c
   set last_human_reply_at = m.last_at
  from (
    select conversation_id, max(message_at) as last_at
      from public.whatsapp_messages
     where sender_type = 'user' and direction = 'outbound' and status <> 'failed'
     group by conversation_id
  ) m
 where m.conversation_id = c.id
   and c.last_human_reply_at is null;

-- ---------------------------------------------------------------------------
-- 2) Disparo: aquisição atômica + recuperação segura
-- ---------------------------------------------------------------------------
alter table public.whatsapp_broadcast_messages
  add column if not exists claim_token uuid,
  add column if not exists processing_started_at timestamptz,
  add column if not exists send_started_at timestamptz,
  add column if not exists audit jsonb not null default '[]'::jsonb;

-- Adquire (com trava de linha) a PRÓXIMA mensagem da fila de um disparo. Duas
-- chamadas simultâneas (Disparar agora, cron, outro worker) nunca recebem a mesma
-- linha: quem chega depois pula a linha travada (skip locked) e pega a seguinte.
create or replace function public.claim_whatsapp_broadcast_message(p_broadcast_id uuid, p_max_attempts integer default 5)
returns setof public.whatsapp_broadcast_messages
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  with picked as (
    select b.id
      from public.whatsapp_broadcast_messages b
     where b.broadcast_id = p_broadcast_id
       and b.status = 'queued'
       and b.attempts < p_max_attempts
     order by b.queued_at, b.id
     limit 1
     for update skip locked
  ), claimed as (
    update public.whatsapp_broadcast_messages m
       set status = 'processing',
           claim_token = gen_random_uuid(),
           processing_started_at = now(),
           send_started_at = null,
           audit = m.audit || jsonb_build_array(jsonb_build_object('at', now(), 'event', 'claimed', 'attempt', m.attempts + 1))
      from picked
     where m.id = picked.id
    returning m.*
  )
  select * from claimed;
end;
$$;

-- Marca "vou chamar a Meta agora". Só a posse (claim_token) atual consegue. A
-- partir deste ponto a mensagem PODE ter sido aceita pela Meta, então uma
-- interrupção nunca a devolve para a fila (ver recover_stuck_whatsapp_broadcast_messages).
create or replace function public.begin_whatsapp_broadcast_send(p_id uuid, p_token uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.whatsapp_broadcast_messages
     set send_started_at = now(),
         audit = audit || jsonb_build_array(jsonb_build_object('at', now(), 'event', 'send_started'))
   where id = p_id
     and claim_token = p_token
     and status = 'processing'
     and send_started_at is null;
  return found;
end;
$$;

-- Recuperação de mensagens presas em 'processing' (processo que caiu no meio):
--  * nunca chegou a chamar a Meta (send_started_at nulo)   -> volta para 'queued';
--  * já tinha chamado a Meta e o ID não foi gravado        -> 'failed' com
--    error_code 'delivery_unknown' (NÃO reenvia: a Meta pode ter aceitado; se o
--    webhook de status chegar depois, o código promove a linha — ver
--    lib/whatsapp-master.js, biz_opaque_callback_data);
--  * já tem whatsapp_message_id (só faltou gravar o status) -> 'sent'.
create or replace function public.recover_stuck_whatsapp_broadcast_messages(p_older_than_seconds integer default 300)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  cutoff timestamptz := now() - make_interval(secs => greatest(p_older_than_seconds, 30));
  requeued integer := 0;
  unknown_count integer := 0;
  promoted integer := 0;
begin
  with promoted_rows as (
    update public.whatsapp_broadcast_messages
       set status = 'sent',
           sent_at = coalesce(sent_at, now()),
           claim_token = null,
           audit = audit || jsonb_build_array(jsonb_build_object('at', now(), 'event', 'recovered_as_sent'))
     where status = 'processing'
       and coalesce(processing_started_at, queued_at) < cutoff
       and whatsapp_message_id is not null
    returning 1
  ) select count(*) into promoted from promoted_rows;

  with requeued_rows as (
    update public.whatsapp_broadcast_messages
       set status = 'queued',
           claim_token = null,
           processing_started_at = null,
           audit = audit || jsonb_build_array(jsonb_build_object('at', now(), 'event', 'recovered_before_send'))
     where status = 'processing'
       and coalesce(processing_started_at, queued_at) < cutoff
       and whatsapp_message_id is null
       and send_started_at is null
    returning 1
  ) select count(*) into requeued from requeued_rows;

  with unknown_rows as (
    update public.whatsapp_broadcast_messages
       set status = 'failed',
           failed_at = now(),
           error_code = 'delivery_unknown',
           error_message = 'Envio interrompido no meio: a Meta pode ter aceitado a mensagem. Não foi reenviada automaticamente para evitar duplicidade.',
           claim_token = null,
           audit = audit || jsonb_build_array(jsonb_build_object('at', now(), 'event', 'recovered_delivery_unknown'))
     where status = 'processing'
       and coalesce(processing_started_at, queued_at) < cutoff
       and whatsapp_message_id is null
       and send_started_at is not null
    returning 1
  ) select count(*) into unknown_count from unknown_rows;

  return jsonb_build_object('requeued', requeued, 'delivery_unknown', unknown_count, 'promoted_sent', promoted);
end;
$$;

revoke all on function public.claim_whatsapp_broadcast_message(uuid, integer) from public, anon, authenticated;
revoke all on function public.begin_whatsapp_broadcast_send(uuid, uuid) from public, anon, authenticated;
revoke all on function public.recover_stuck_whatsapp_broadcast_messages(integer) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_broadcast_message(uuid, integer) to service_role;
grant execute on function public.begin_whatsapp_broadcast_send(uuid, uuid) to service_role;
grant execute on function public.recover_stuck_whatsapp_broadcast_messages(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Cliente pela roleta, atômico e serializado por telefone
-- ---------------------------------------------------------------------------
-- Chave do telefone SEM o 9º dígito / DDI, só para serializar (advisory lock): os
-- vários formatos do mesmo número disputam a MESMA trava.
create or replace function public.whatsapp_phone_lock_key(p_phone text)
returns text
language plpgsql
immutable
as $$
declare
  d text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if d like '00%' then d := substr(d, 3); end if;
  if d like '55%' and length(d) >= 12 then d := substr(d, 3); end if;
  if length(d) = 11 and substr(d, 3, 1) = '9' then d := substr(d, 1, 2) || substr(d, 4); end if;
  return d;
end;
$$;

-- Cliente já existe (em qualquer formato do número)? Devolve o cadastro mais
-- recente, SEM criar nada nem trocar de responsável. Se não existe: escolhe o
-- corretor da roleta (por presença; cai na fila simples se a regra nova falhar) e
-- cria o cliente na MESMA transação — se o insert falhar, a escolha do corretor
-- (a vez na fila) é desfeita junto.
create or replace function public.whatsapp_get_or_create_roulette_client(
  p_candidates text[],
  p_full_name text,
  p_phone text,
  p_phone_normalized text,
  p_context jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_broker_id uuid;
  v_tier text;
  v_skipped uuid[];
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
    return jsonb_build_object('registration_id', v_existing_id, 'already_existed', true, 'broker_id', null);
  end if;

  begin
    select p.picked_broker_id, p.picked_tier, p.skipped_ids
      into v_broker_id, v_tier, v_skipped
      from public.pick_round_robin_broker(null) p;
  exception when others then
    -- Regra por presença indisponível: fila simples (mesmo fallback de lib/lead-distribution.js).
    v_broker_id := public.assign_round_robin_lead(null);
    v_tier := null;
    v_skipped := '{}'::uuid[];
  end;

  if v_broker_id is null then
    return jsonb_build_object('registration_id', null, 'already_existed', false, 'broker_id', null);
  end if;

  select u.name into v_broker_name from public.admin_users u where u.id = v_broker_id;

  -- A tabela exige os campos da simulação (NOT NULL, sem default): mesmos valores padrão do
  -- cadastro manual do CRM (lib/simulation-registrations.js, MANUAL_DEFAULT_* /
  -- LEGACY_PROFESSION_PLACEHOLDER). O insert antigo (feito no código) nunca os enviava e
  -- falharia sempre que o telefone fosse desconhecido.
  insert into public.simulation_registrations (
    simulation_type, full_name, phone, phone_normalized, oldest_birth_date, primary_income_type,
    primary_profession, primary_monthly_income, has_over_three_years_registered_work,
    has_children_under_18, primary_marital_status, has_residential_property,
    status, responsible_user_id, distribution_type, acquisition_context
  ) values (
    'individual', p_full_name, p_phone, p_phone_normalized, date '1900-01-01', 'self_employed_unregistered',
    'Nao informado', 0, false,
    false, 'single', false,
    'pending', v_broker_id, 'round_robin',
    coalesce(p_context, '{}'::jsonb) || jsonb_build_object(
      'metadata', jsonb_build_object('brokerId', v_broker_id, 'brokerName', coalesce(v_broker_name, ''))
    )
  ) returning id into v_new_id;

  return jsonb_build_object(
    'registration_id', v_new_id,
    'already_existed', false,
    'broker_id', v_broker_id,
    'tier', v_tier,
    'skipped_ids', to_jsonb(coalesce(v_skipped, '{}'::uuid[]))
  );
end;
$$;

revoke all on function public.whatsapp_phone_lock_key(text) from public, anon, authenticated;
revoke all on function public.whatsapp_get_or_create_roulette_client(text[], text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_phone_lock_key(text) to service_role;
grant execute on function public.whatsapp_get_or_create_roulette_client(text[], text, text, text, jsonb) to service_role;
