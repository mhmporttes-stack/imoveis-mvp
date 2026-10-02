-- Remoção de corretor com redistribuição de clientes, ATÔMICA.
-- Tudo numa única transação: trocar o responsável dos clientes + tag do corretor anterior +
-- auditoria + excluir o corretor. Se qualquer passo falhar, nada é aplicado (nem metade dos clientes).
-- Só troca responsible_user_id (o trigger existente já leva a conversa de Chat junto);
-- etapa/status, histórico, atividades, documentos etc. permanecem intactos.

create table if not exists public.broker_removal_audit (
  id uuid primary key default gen_random_uuid(),
  removed_by_user_id uuid,
  removed_by_name text not null default '',
  removed_broker_id uuid not null,
  removed_broker_name text not null default '',
  removed_broker_email text not null default '',
  strategy text not null check (strategy in ('none', 'transfer', 'distribute')),
  client_count integer not null default 0,
  destinations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists broker_removal_audit_created_idx on public.broker_removal_audit (created_at desc);
alter table public.broker_removal_audit enable row level security;

create or replace function public.remove_broker_reassigning_clients(
  p_broker_id uuid,
  p_assignments jsonb,
  p_tag_id uuid,
  p_audit jsonb
) returns jsonb
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

  select count(*) into v_current from public.simulation_registrations where responsible_user_id = p_broker_id;
  v_expected := coalesce(jsonb_array_length(coalesce(p_assignments, '[]'::jsonb)), 0);
  if v_current <> v_expected then
    raise exception 'clients_changed' using detail = format('esperado %s, encontrado %s', v_expected, v_current);
  end if;

  if v_expected > 0 then
    with moved as (
      update public.simulation_registrations r
         set responsible_user_id = a.to_id
        from jsonb_to_recordset(p_assignments) as a(client_id uuid, to_id uuid)
       where r.id = a.client_id and r.responsible_user_id = p_broker_id
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

revoke all on function public.remove_broker_reassigning_clients(uuid, jsonb, uuid, jsonb) from public, anon, authenticated;
