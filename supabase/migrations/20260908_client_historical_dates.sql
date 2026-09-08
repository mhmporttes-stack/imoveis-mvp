alter table public.simulation_registrations
  add column if not exists service_started_at date,
  add column if not exists sale_completed_at date;

update public.simulation_registrations
set service_started_at = (last_whatsapp_contact_at at time zone 'America/Sao_Paulo')::date
where service_started_at is null
  and last_whatsapp_contact_at is not null;

update public.simulation_registrations as registration
set sale_completed_at = sale.sale_date
from public.financial_sales as sale
where sale.client_id = registration.id
  and registration.sale_completed_at is null;
