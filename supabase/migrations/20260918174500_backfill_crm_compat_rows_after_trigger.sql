-- Catch registrations created between the initial compatibility backfill and
-- the trigger installation. Idempotent and non-destructive.

insert into public.crm_clients (canonical_phone, full_name, created_at, updated_at)
select distinct on (phone_normalized)
  phone_normalized, full_name, created_at, updated_at
from public.simulation_registrations
where phone_normalized is not null and phone_normalized <> ''
order by phone_normalized, created_at, id
on conflict (canonical_phone) do nothing;

insert into public.crm_attendances (
  client_id, legacy_registration_id, responsible_user_id, status,
  source_kind, source_label, created_at, updated_at, closed_at
)
select
  c.id, r.id, r.responsible_user_id, r.status,
  r.acquisition_context->>'kind', r.acquisition_context->>'label',
  r.created_at, r.updated_at,
  case when r.status in ('completed','sale_completed','archived','do_not_contact')
    then r.updated_at else null end
from public.simulation_registrations r
join public.crm_clients c on c.canonical_phone = r.phone_normalized
on conflict (legacy_registration_id) do nothing;
