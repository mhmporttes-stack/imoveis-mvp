-- Cliente do Facebook Marketplace sem telefone (MKT-2, dono, 2026-10-20: "toda conversa do Marketplace distribuída vira
-- cliente automaticamente, só com o nome"; o WhatsApp é preenchido depois pelo corretor). Idempotente; não apaga dado.
--
-- 1) A checagem de formato do telefone passa a aceitar vazio (''): só o FORMATO muda; todo telefone preenchido continua
--    exigindo +55 + 11 dígitos (ou 10–11 dígitos legados). Trocar uma CHECK exige remover a antiga e criar a nova — é
--    só a regra de validação, nenhuma linha é alterada. Feito só se a regra ainda não aceita vazio.
-- 2) A ponte de compatibilidade (crm_clients/crm_attendances, chave = telefone) ignora cadastro sem telefone — senão
--    todos os clientes sem telefone virariam UM só cliente canônico. Mesmo critério de syncCrmClientAttendance
--    (lib/crm-clients.js), que já ignora telefone vazio. Quando o corretor preencher o WhatsApp, o gatilho sincroniza.

do $$
declare
  current_def text;
begin
  select pg_get_constraintdef(oid) into current_def
  from pg_constraint
  where conname = 'simulation_registrations_phone_normalized_compat_check'
    and conrelid = 'public.simulation_registrations'::regclass;

  if current_def is null or position('''''' in current_def) = 0 then
    alter table public.simulation_registrations
      drop constraint if exists simulation_registrations_phone_normalized_compat_check;
    alter table public.simulation_registrations
      add constraint simulation_registrations_phone_normalized_compat_check
      check (
        phone_normalized = ''
        or phone_normalized ~ '^\+55[0-9]{11}$'
        or phone_normalized ~ '^[0-9]{10,11}$'
      );
  end if;
end $$;

create or replace function public.sync_crm_compat_from_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  -- Sem telefone (cliente do Marketplace ainda sem WhatsApp): nada a sincronizar até o telefone ser preenchido.
  if coalesce(btrim(new.phone_normalized), '') = '' then
    return new;
  end if;

  insert into public.crm_clients (canonical_phone, full_name, created_at, updated_at)
  values (new.phone_normalized, new.full_name, new.created_at, now())
  on conflict (canonical_phone) do update
    set full_name = excluded.full_name, updated_at = now()
  returning id into v_client_id;

  insert into public.crm_attendances (
    client_id, legacy_registration_id, responsible_user_id, status,
    source_kind, source_label, created_at, updated_at, closed_at
  )
  values (
    v_client_id, new.id, new.responsible_user_id, new.status,
    new.acquisition_context->>'kind',
    new.acquisition_context->>'label',
    new.created_at, now(),
    case when new.status in ('completed','sale_completed','archived','do_not_contact')
      then coalesce(new.updated_at, now()) else null end
  )
  on conflict (legacy_registration_id) do update
    set client_id = excluded.client_id,
        responsible_user_id = excluded.responsible_user_id,
        status = excluded.status,
        source_kind = coalesce(excluded.source_kind, public.crm_attendances.source_kind),
        source_label = coalesce(excluded.source_label, public.crm_attendances.source_label),
        updated_at = now(),
        closed_at = excluded.closed_at;
  return new;
end;
$$;

revoke all on function public.sync_crm_compat_from_registration() from public, anon, authenticated;
grant execute on function public.sync_crm_compat_from_registration() to service_role;
