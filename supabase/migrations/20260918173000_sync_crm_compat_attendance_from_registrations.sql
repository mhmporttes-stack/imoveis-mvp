-- Keep the compatibility layer synchronized for every legacy write path.
-- The trigger is non-destructive and lets old APIs and new CRM reads coexist.

create or replace function public.sync_crm_compat_from_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
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

drop trigger if exists simulation_registrations_crm_compat_sync on public.simulation_registrations;
create trigger simulation_registrations_crm_compat_sync
after insert or update of phone_normalized, full_name, responsible_user_id, status, acquisition_context
on public.simulation_registrations
for each row execute function public.sync_crm_compat_from_registration();

revoke all on function public.sync_crm_compat_from_registration() from public, anon, authenticated;
grant execute on function public.sync_crm_compat_from_registration() to service_role;
