-- Excluir usuário (2026-10-09): contato PARTICULAR (simulation_registrations.private_contact_at) não é cliente —
-- não conta, não é transferido nem distribuído e não ganha a tag do corretor anterior. Fica sem responsável e fora das
-- listas (e fora do resgate de órfãos, lib/simulation-registrations.js).
create or replace function public.remove_broker_reassigning_clients(p_broker_id uuid, p_assignments jsonb, p_tag_id uuid, p_audit jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_current integer;
  v_expected integer;
  v_moved integer;
begin
  perform 1 from public.admin_users where id = p_broker_id for update;
  if not found then
    raise exception 'broker_not_found';
  end if;

  select count(*) into v_current from public.simulation_registrations where responsible_user_id = p_broker_id and private_contact_at is null;
  v_expected := coalesce(jsonb_array_length(coalesce(p_assignments, '[]'::jsonb)), 0);
  if v_current <> v_expected then
    raise exception 'clients_changed' using detail = format('esperado %s, encontrado %s', v_expected, v_current);
  end if;

  if v_expected > 0 then
    with moved as (
      update public.simulation_registrations r
         set responsible_user_id = a.to_id
        from jsonb_to_recordset(p_assignments) as a(client_id uuid, to_id uuid)
       where r.id = a.client_id and r.responsible_user_id = p_broker_id and r.private_contact_at is null
      returning r.id
    )
    select count(*) into v_moved from moved;
    if v_moved <> v_expected then
      raise exception 'clients_changed' using detail = format('movidos %s de %s', v_moved, v_expected);
    end if;

    if p_tag_id is not null then
      insert into public.client_tags (client_id, tag_id)
      select a.client_id, p_tag_id
        from jsonb_to_recordset(p_assignments) as a(client_id uuid, to_id uuid)
      on conflict (client_id, tag_id) do nothing;
    end if;
  else
    v_moved := 0;
  end if;

  -- Contatos particulares: ninguém herda.
  update public.simulation_registrations set responsible_user_id = null
   where responsible_user_id = p_broker_id and private_contact_at is not null;

  insert into public.broker_removal_audit (
    removed_by_user_id, removed_by_name, removed_broker_id, removed_broker_name, removed_broker_email,
    strategy, client_count, destinations
  ) values (
    nullif(p_audit->>'removedByUserId', '')::uuid,
    coalesce(p_audit->>'removedByName', ''),
    p_broker_id,
    coalesce(p_audit->>'removedBrokerName', ''),
    coalesce(p_audit->>'removedBrokerEmail', ''),
    coalesce(p_audit->>'strategy', 'none'),
    v_moved,
    coalesce(p_audit->'destinations', '[]'::jsonb)
  );

  delete from public.admin_users where id = p_broker_id;

  return jsonb_build_object('moved', v_moved);
end;
$$;
