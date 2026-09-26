-- Novo status de cliente: "Atendimento automático" (automated_service) — regra do dono (2026-09-26).
--
-- Cliente que veio pelo WhatsApp (anúncio, contato direto, palavra-chave, Fluxo) e AINDA NÃO
-- preencheu o formulário não pode ficar em "Aguardando simulação": só interagiu com as
-- automações do Chat. Fluxo do status (feito pelo código, ver lib/whatsapp-client-status-core.mjs):
--   nasce "Atendimento automático" -> corretor responde no Chat -> "Em atendimento"
--   preenche o link do formulário  -> "Aguardando simulação" (createSimulationRegistration)
--
-- Idempotente. Ordem de aplicação usada em produção: PARTE 1 (restrições) antes do deploy do
-- código; PARTES 2 e 3 depois do deploy.

-- ---------------------------------------------------------------------------
-- PARTE 1 — restrições de status (cadastro e histórico) passam a aceitar o valor novo
-- ---------------------------------------------------------------------------
alter table public.simulation_registrations drop constraint if exists simulation_registrations_status_check;
alter table public.simulation_registrations add constraint simulation_registrations_status_check check (status = any (array[
  'automated_service', 'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
  'documentation_pending', 'documents_pending', 'approval_pending', 'restriction', 'shielding', 'approved',
  'rejected', 'meeting_pending', 'meeting_done', 'sale_completed', 'sale_forms', 'sale_reservation',
  'sale_contract', 'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'archived', 'do_not_contact'
]::text[]));

alter table public.client_status_history drop constraint if exists client_status_history_new_status_check;
alter table public.client_status_history add constraint client_status_history_new_status_check check (new_status = any (array[
  'automated_service', 'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
  'documentation_pending', 'documents_pending', 'approval_pending', 'restriction', 'shielding', 'approved',
  'rejected', 'meeting_pending', 'meeting_done', 'sale_completed', 'sale_forms', 'sale_reservation',
  'sale_contract', 'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'archived', 'do_not_contact'
]::text[]));

alter table public.client_status_history drop constraint if exists client_status_history_previous_status_check;
alter table public.client_status_history add constraint client_status_history_previous_status_check check (previous_status is null or previous_status = any (array[
  'automated_service', 'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
  'documentation_pending', 'documents_pending', 'approval_pending', 'restriction', 'shielding', 'approved',
  'rejected', 'meeting_pending', 'meeting_done', 'sale_completed', 'sale_forms', 'sale_reservation',
  'sale_contract', 'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'archived', 'do_not_contact'
]::text[]));

-- ---------------------------------------------------------------------------
-- PARTE 2 — a roleta do WhatsApp cria o cliente em "Atendimento automático"
-- (única mudança em relação à versão anterior: status inicial 'pending' -> 'automated_service')
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
    v_broker_id := public.assign_round_robin_lead(null);
    v_tier := null;
    v_skipped := '{}'::uuid[];
  end;
  if v_broker_id is null then
    return jsonb_build_object('registration_id', null, 'already_existed', false, 'broker_id', null);
  end if;
  select u.name into v_broker_name from public.admin_users u where u.id = v_broker_id;
  select coalesce(array_agg(u.name order by u.name), '{}'::text[]) into v_skipped_names
    from public.admin_users u where u.id = any(coalesce(v_skipped, '{}'::uuid[]));
  insert into public.simulation_registrations (
    simulation_type, full_name, phone, phone_normalized, oldest_birth_date, primary_income_type,
    primary_profession, primary_monthly_income, has_over_three_years_registered_work,
    has_children_under_18, primary_marital_status, has_residential_property,
    status, responsible_user_id, distribution_type, acquisition_context
  ) values (
    'individual', p_full_name, p_phone, p_phone_normalized, date '1900-01-01', 'self_employed_unregistered',
    'Nao informado', 0, false,
    false, 'single', false,
    'automated_service', v_broker_id, 'round_robin',
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
-- PARTE 3 — correção dos clientes do WhatsApp que já existem sem formulário preenchido
-- (valores padrão: nascimento 1900-01-01 e renda/recurso 0 — mesmo critério de hasSimulationData)
-- ---------------------------------------------------------------------------

-- 3a) ainda ninguém da equipe respondeu: "Aguardando simulação" -> "Atendimento automático"
with alvo as (
  select r.id
    from public.simulation_registrations r
   where r.status = 'pending'
     and coalesce(r.acquisition_context->>'kind', '') like 'whatsapp%'
     and r.oldest_birth_date = date '1900-01-01'
     and coalesce(r.primary_monthly_income, 0) = 0
     and coalesce(r.secondary_monthly_income, 0) = 0
     and coalesce(r.available_purchase_resource, 0) = 0
     and not exists (
       select 1 from public.whatsapp_conversations c
         join public.whatsapp_messages m on m.conversation_id = c.id
        where c.client_id = r.id and m.direction = 'outbound' and m.sender_type = 'user'
     )
), atualizados as (
  update public.simulation_registrations r
     set status = 'automated_service', last_status_change_at = now()
    from alvo
   where r.id = alvo.id and r.status = 'pending'
  returning r.id
)
insert into public.client_status_history (client_id, previous_status, new_status, changed_at, changed_by, source)
select id, 'pending', 'automated_service', now(), 'sistema', 'whatsapp_status_backfill' from atualizados;

-- 3b) um corretor já respondeu no Chat: -> "Em atendimento", na data da primeira resposta e no nome do
--     corretor responsável (mesma regra do código; o marco de atendimento cai no dia certo)
with primeira as (
  select c.client_id, min(m.message_at) as first_reply
    from public.whatsapp_conversations c
    join public.whatsapp_messages m on m.conversation_id = c.id
   where c.client_id is not null and m.direction = 'outbound' and m.sender_type = 'user'
   group by c.client_id
), alvo as (
  select r.id, r.status as prev, p.first_reply, u.email
    from public.simulation_registrations r
    join primeira p on p.client_id = r.id
    left join public.admin_users u on u.id = r.responsible_user_id
   where r.status in ('pending', 'awaiting_return')
     and coalesce(r.acquisition_context->>'kind', '') like 'whatsapp%'
     and r.oldest_birth_date = date '1900-01-01'
     and coalesce(r.primary_monthly_income, 0) = 0
     and coalesce(r.secondary_monthly_income, 0) = 0
     and coalesce(r.available_purchase_resource, 0) = 0
), atualizados as (
  update public.simulation_registrations r
     set status = 'in_service', last_status_change_at = alvo.first_reply
    from alvo
   where r.id = alvo.id and r.status = alvo.prev
  returning r.id, alvo.prev, alvo.first_reply, alvo.email
)
insert into public.client_status_history (client_id, previous_status, new_status, changed_at, changed_by, source)
select id, prev, 'in_service', first_reply, lower(coalesce(email, 'sistema')), 'whatsapp_status_backfill' from atualizados;
