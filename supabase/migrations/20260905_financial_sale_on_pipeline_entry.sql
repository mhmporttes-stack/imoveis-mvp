create or replace function public.create_financial_sale_on_pipeline_entry()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  broker record;
begin
  if new.status in (
    'sale_completed', 'sale_forms', 'sale_reservation', 'sale_contract',
    'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment'
  ) and old.status not in (
    'sale_completed', 'sale_forms', 'sale_reservation', 'sale_contract',
    'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment'
  ) then
    select name, email into broker
    from public.admin_users
    where id = new.responsible_user_id;

    insert into public.financial_sales (
      client_id, broker_email, broker_name, sale_date,
      created_by_email, updated_by_email, notes
    ) values (
      new.id,
      coalesce(broker.email, new.last_admin_email, ''),
      coalesce(broker.name, ''),
      (coalesce(new.last_status_change_at, now()) at time zone 'America/Sao_Paulo')::date,
      coalesce(new.last_admin_email, broker.email, ''),
      coalesce(new.last_admin_email, broker.email, ''),
      'Venda criada automaticamente para ' || new.full_name || '.'
    ) on conflict (client_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists simulation_registration_create_financial_sale on public.simulation_registrations;
create trigger simulation_registration_create_financial_sale
after update of status on public.simulation_registrations
for each row execute function public.create_financial_sale_on_pipeline_entry();

with sale_entry as (
  select client_id, min(changed_at) as entered_at
  from public.client_status_history
  where new_status in (
    'sale_completed', 'sale_forms', 'sale_reservation', 'sale_contract',
    'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment'
  )
  group by client_id
)
update public.financial_sales as sale
set sale_date = (entry.entered_at at time zone 'America/Sao_Paulo')::date
from sale_entry as entry
where sale.client_id = entry.client_id
  and sale.notes like 'Venda criada automaticamente para %';

with sale_entry as (
  select client_id, min(changed_at) as entered_at
  from public.client_status_history
  where new_status in (
    'sale_completed', 'sale_forms', 'sale_reservation', 'sale_contract',
    'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment'
  )
  group by client_id
)
insert into public.financial_sales (
  client_id, broker_email, broker_name, sale_date,
  created_by_email, updated_by_email, notes
)
select
  registration.id,
  coalesce(broker.email, registration.last_admin_email, ''),
  coalesce(broker.name, ''),
  (coalesce(entry.entered_at, registration.last_status_change_at, registration.created_at) at time zone 'America/Sao_Paulo')::date,
  coalesce(registration.last_admin_email, broker.email, ''),
  coalesce(registration.last_admin_email, broker.email, ''),
  'Venda criada automaticamente para ' || registration.full_name || '.'
from public.simulation_registrations as registration
left join public.admin_users as broker on broker.id = registration.responsible_user_id
left join sale_entry as entry on entry.client_id = registration.id
left join public.financial_sales as existing on existing.client_id = registration.id
where registration.status in (
  'sale_completed', 'sale_forms', 'sale_reservation', 'sale_contract',
  'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment'
)
and existing.id is null;

revoke all on function public.create_financial_sale_on_pipeline_entry() from public, anon, authenticated;
grant execute on function public.create_financial_sale_on_pipeline_entry() to service_role;
