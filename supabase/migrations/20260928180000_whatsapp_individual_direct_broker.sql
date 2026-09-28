-- Contato novo que chega pelo WhatsApp INDIVIDUAL (número pessoal do
-- corretor, via QR) não passa pela roleta geral: a mensagem já chegou no
-- celular de um corretor específico, então o cliente é dele, sempre —
-- mesma lógica de whatsapp_get_or_create_roulette_client, mas com o
-- corretor FIXO em vez de sorteado.
create or replace function public.whatsapp_get_or_create_client_for_broker(
  p_candidates text[],
  p_full_name text,
  p_phone text,
  p_phone_normalized text,
  p_broker_id uuid,
  p_context jsonb,
  p_conversation_id uuid default null,
  p_history_details jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_existing_id uuid;
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

  select u.name into v_broker_name from public.admin_users u where u.id = p_broker_id;

  insert into public.simulation_registrations (
    simulation_type, full_name, phone, phone_normalized, oldest_birth_date, primary_income_type,
    primary_profession, primary_monthly_income, has_over_three_years_registered_work,
    has_children_under_18, primary_marital_status, has_residential_property,
    status, responsible_user_id, distribution_type, acquisition_context
  ) values (
    'individual', p_full_name, p_phone, p_phone_normalized, date '1900-01-01', 'self_employed_unregistered',
    'Nao informado', 0, false,
    false, 'single', false,
    'automated_service', p_broker_id, 'direct_channel',
    coalesce(p_context, '{}'::jsonb) || jsonb_build_object(
      'metadata', coalesce(p_context->'metadata', '{}'::jsonb) || jsonb_build_object('brokerId', p_broker_id, 'brokerName', coalesce(v_broker_name, ''))
    )
  ) returning id into v_new_id;

  insert into public.lead_distribution_history (registration_id, client_name, event_type, to_user_id, details)
  values (
    v_new_id, p_full_name, 'assigned', p_broker_id,
    coalesce(p_history_details, '{}'::jsonb) || jsonb_build_object('reason', 'whatsapp_individual_direct')
  );

  if p_conversation_id is not null then
    update public.whatsapp_conversations
       set client_id = v_new_id, assigned_user_id = p_broker_id, updated_at = now()
     where id = p_conversation_id;
  end if;

  return jsonb_build_object('registration_id', v_new_id, 'already_existed', false, 'broker_id', p_broker_id);
end;
$function$;
