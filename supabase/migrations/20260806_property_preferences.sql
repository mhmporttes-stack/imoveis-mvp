alter table public.simulation_registrations
add column if not exists preferences_access_token text,
add column if not exists property_preferences_status text not null default 'nao_iniciado',
add column if not exists property_preferences_started_at timestamptz,
add column if not exists property_preferences_completed_at timestamptz,
add column if not exists property_preferences_updated_at timestamptz,
add column if not exists preferred_property_type text,
add column if not exists preferred_regions jsonb not null default '[]'::jsonb,
add column if not exists preferred_property_stage text,
add column if not exists preferred_bedrooms text,
add column if not exists rents_currently boolean,
add column if not exists rent_price_range text,
add column if not exists purchase_timeline text,
add column if not exists property_priorities jsonb not null default '[]'::jsonb,
add column if not exists must_have_features text;

update public.simulation_registrations
set preferences_access_token = gen_random_uuid()::text
where preferences_access_token is null;

create unique index if not exists simulation_registrations_preferences_access_token_idx
  on public.simulation_registrations (preferences_access_token)
  where preferences_access_token is not null;

create index if not exists simulation_registrations_property_preferences_status_idx
  on public.simulation_registrations (property_preferences_status);

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'simulation_registrations_property_preferences_status_check'
  ) then
    alter table public.simulation_registrations
    drop constraint simulation_registrations_property_preferences_status_check;
  end if;
end $$;

alter table public.simulation_registrations
add constraint simulation_registrations_property_preferences_status_check
check (property_preferences_status in ('nao_iniciado', 'iniciado', 'concluido', 'ignorado'));

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'simulation_registrations_property_preferences_values_check'
  ) then
    alter table public.simulation_registrations
    drop constraint simulation_registrations_property_preferences_values_check;
  end if;
end $$;

alter table public.simulation_registrations
add constraint simulation_registrations_property_preferences_values_check
check (
  (preferred_property_type is null or preferred_property_type in ('casa', 'apartamento', 'sem_preferencia'))
  and (preferred_property_stage is null or preferred_property_stage in ('pronto', 'em_construcao', 'na_planta', 'sem_preferencia'))
  and (preferred_bedrooms is null or preferred_bedrooms in ('um', 'dois', 'tres_ou_mais', 'sem_preferencia'))
  and (rent_price_range is null or rent_price_range in ('ate_500', 'de_501_a_1000', 'de_1001_a_1500', 'de_1501_a_2000', 'acima_de_2000'))
  and (purchase_timeline is null or purchase_timeline in ('imediato', 'proximos_3_meses', 'entre_3_e_6_meses', 'mais_de_6_meses', 'ainda_nao_sei'))
  and jsonb_typeof(preferred_regions) = 'array'
  and jsonb_typeof(property_priorities) = 'array'
  and jsonb_array_length(property_priorities) <= 2
  and (
    rents_currently is distinct from false
    or rent_price_range is null
  )
  and (
    must_have_features is null
    or length(must_have_features) <= 500
  )
);
