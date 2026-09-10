-- A repeat enquiry is a new registration, potentially for a different broker.
drop index if exists public.simulation_registrations_phone_normalized_unique;
create index if not exists simulation_registrations_phone_normalized_idx
  on public.simulation_registrations(phone_normalized);
