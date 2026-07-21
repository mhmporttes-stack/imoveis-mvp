alter table if exists public.simulation_registrations
  alter column primary_profession drop not null;

alter table if exists public.simulation_registrations
  drop constraint if exists simulation_registrations_primary_profession_check,
  drop constraint if exists simulation_registrations_secondary_fields_match_type;

alter table if exists public.simulation_registrations
  add constraint simulation_registrations_secondary_fields_match_type
  check (
    (
      simulation_type = 'joint'
      and secondary_income_type is not null
      and secondary_monthly_income is not null
      and secondary_marital_status is not null
    )
    or
    (
      simulation_type = 'individual'
      and secondary_income_type is null
      and secondary_profession is null
      and secondary_monthly_income is null
      and secondary_marital_status is null
    )
  );
