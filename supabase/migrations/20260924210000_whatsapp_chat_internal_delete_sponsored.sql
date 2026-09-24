-- WhatsApp Master > Chat: mensagens internas, exclusão (soft delete) de conversa e lead
-- patrocinado (Click-to-WhatsApp) entrando na roleta de forma atômica. Idempotente.
--
-- 1) MENSAGEM INTERNA: linha própria em whatsapp_messages com direction='internal' e
--    message_type='internal' (separação REAL no banco, não só na tela). Toda leitura que já
--    filtra direction inbound/outbound exclui as internas por padrão; nunca passa pela Meta.
-- 2) EXCLUIR CONVERSA: soft delete (deleted_at/deleted_by) + auditoria. Nada de cascade: o
--    cliente, histórico, funil etc. não são tocados. Mensagem nova do cliente restaura.
-- 3) ROLETA PARA LEAD PATROCINADO: a função de "cliente pela roleta" passa a (a) vincular a
--    conversa ao cliente e atribuir a conversa ao MESMO corretor, (b) gravar o histórico da
--    roleta (lead_distribution_history, o mesmo já existente) — tudo na mesma transação.

-- ---------------------------------------------------------------------------
-- 1) Mensagem interna
-- ---------------------------------------------------------------------------
alter table public.whatsapp_messages drop constraint if exists whatsapp_messages_direction_check;
alter table public.whatsapp_messages
  add constraint whatsapp_messages_direction_check check (direction in ('inbound', 'outbound', 'internal'));

alter table public.whatsapp_messages drop constraint if exists whatsapp_messages_internal_consistency;
alter table public.whatsapp_messages
  add constraint whatsapp_messages_internal_consistency check ((direction = 'internal') = (message_type = 'internal'));

-- ---------------------------------------------------------------------------
-- 2) Excluir conversa (soft delete) + auditoria
-- ---------------------------------------------------------------------------
alter table public.whatsapp_conversations
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.admin_users(id) on delete set null;

-- Auditoria append-only. Sem FK de propósito: o registro sobrevive a qualquer exclusão futura.
create table if not exists public.whatsapp_conversation_audit (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  client_id uuid,
  contact_phone text,
  action text not null check (action in ('deleted', 'restored_by_inbound', 'restored_by_open')),
  actor_user_id uuid,
  actor_name text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_conversation_audit_conversation_idx
  on public.whatsapp_conversation_audit (conversation_id, created_at desc);
alter table public.whatsapp_conversation_audit enable row level security;
revoke all on public.whatsapp_conversation_audit from anon, authenticated;
grant all on public.whatsapp_conversation_audit to service_role;

-- Mensagem nova do cliente numa conversa excluída: ela volta para a caixa (nunca some um
-- cliente que escreveu de novo) e o motivo fica na auditoria. Resto da função igual à original.
create or replace function public.whatsapp_chat_apply_inbound(
  p_conversation_id uuid,
  p_count integer,
  p_at timestamptz,
  p_preview text,
  p_name text,
  p_client_id uuid,
  p_origin jsonb
) returns void
language plpgsql
as $$
declare
  v_was_deleted boolean;
  v_phone text;
  v_client uuid;
begin
  select (c.deleted_at is not null), c.contact_phone into v_was_deleted, v_phone
    from public.whatsapp_conversations c where c.id = p_conversation_id for update;

  update public.whatsapp_conversations c set
    unread_count = c.unread_count + greatest(p_count, 0),
    last_message_preview = case when c.last_message_at is null or p_at >= c.last_message_at then p_preview else c.last_message_preview end,
    last_message_direction = case when c.last_message_at is null or p_at >= c.last_message_at then 'inbound' else c.last_message_direction end,
    last_message_at = case when c.last_message_at is null or p_at >= c.last_message_at then p_at else c.last_message_at end,
    last_inbound_at = greatest(coalesce(c.last_inbound_at, p_at), p_at),
    status = case when c.status = 'finished' then 'open' else c.status end,
    contact_name = coalesce(nullif(c.contact_name, ''), nullif(p_name, '')),
    client_id = coalesce(c.client_id, p_client_id),
    origin = case when c.origin = '{}'::jsonb and p_origin is not null then p_origin else c.origin end,
    deleted_at = null,
    deleted_by = null,
    updated_at = now()
  where c.id = p_conversation_id
  returning c.client_id into v_client;

  if coalesce(v_was_deleted, false) then
    insert into public.whatsapp_conversation_audit (conversation_id, client_id, contact_phone, action, detail)
    values (p_conversation_id, v_client, v_phone, 'restored_by_inbound', jsonb_build_object('reason', 'mensagem nova do cliente'));
  end if;
end;
$$;

revoke all on function public.whatsapp_chat_apply_inbound(uuid, integer, timestamptz, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_chat_apply_inbound(uuid, integer, timestamptz, text, text, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Cliente pela roleta (lead patrocinado / resposta por palavra-chave / Fluxo)
-- ---------------------------------------------------------------------------
-- Substitui a versão anterior (mesmos 5 primeiros parâmetros + 2 opcionais: o código atual em
-- produção continua chamando normalmente).
drop function if exists public.whatsapp_get_or_create_roulette_client(text[], text, text, text, jsonb);

create or replace function public.whatsapp_get_or_create_roulette_client(
  p_candidates text[],
  p_full_name text,
  p_phone text,
  p_phone_normalized text,
  p_context jsonb,
  p_conversation_id uuid default null,
  p_history_details jsonb default '{}'::jsonb
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
  v_skipped_names text[];
  v_broker_name text;
  v_new_id uuid;
begin
  -- Serializa por telefone (todos os formatos do número disputam a MESMA trava).
  perform pg_advisory_xact_lock(hashtext('whatsapp_client_phone:' || public.whatsapp_phone_lock_key(p_phone_normalized)));

  select r.id into v_existing_id
    from public.simulation_registrations r
   where r.phone_normalized = any(p_candidates)
   order by r.created_at desc
   limit 1;
  if v_existing_id is not null then
    -- Cliente já existe: só vincula a conversa. Não mexe no responsável nem na roleta.
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

  -- A tabela exige os campos da simulação (NOT NULL, sem default): mesmos valores padrão do
  -- cadastro manual do CRM.
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
      'metadata', coalesce(p_context->'metadata', '{}'::jsonb) || jsonb_build_object('brokerId', v_broker_id, 'brokerName', coalesce(v_broker_name, ''))
    )
  ) returning id into v_new_id;

  -- Histórico da roleta (o MESMO já existente): entrou, quem foi escolhido, camada de presença e quem foi pulado.
  insert into public.lead_distribution_history (registration_id, client_name, event_type, to_user_id, details)
  values (
    v_new_id, p_full_name, 'assigned', v_broker_id,
    coalesce(p_history_details, '{}'::jsonb) || jsonb_build_object('presenceTier', v_tier, 'skipped', to_jsonb(v_skipped_names))
  );

  -- Responsável do cliente = responsável da conversa (mesmo corretor, na mesma transação).
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
$$;

revoke all on function public.whatsapp_get_or_create_roulette_client(text[], text, text, text, jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_get_or_create_roulette_client(text[], text, text, text, jsonb, uuid, jsonb) to service_role;
