-- Complete the registry only for standalone legacy simulations with a
-- Filename version matches the applied Supabase migration.
-- recorded phone and no matching client. Reuse the CRM's manual defaults.
alter table public.simulations disable trigger simulations_set_updated_at;
do $$
declare s record; v_client_id uuid; local_phone text;
begin
 for s in select * from public.simulations where registration_id is null loop
  local_phone := right(regexp_replace(substring(s.internal_note from 'WhatsApp do cadastro: *([+0-9 ().-]+)'),'[^0-9]','','g'),11);
  if local_phone is null or length(local_phone) not in (10,11) then continue; end if;
  if exists(select 1 from public.simulation_registrations r
    where lower(trim(r.full_name))=lower(trim(s.client_name))
    or right(regexp_replace(r.phone_normalized,'[^0-9]','','g'),11)=local_phone) then continue; end if;
  insert into public.simulation_registrations(
   simulation_type,full_name,phone,phone_normalized,oldest_birth_date,
   primary_income_type,primary_profession,primary_monthly_income,
   has_over_three_years_registered_work,has_children_under_18,
   primary_marital_status,has_residential_property,available_purchase_resource,
   responsible_user_id,status,created_at,updated_at,acquisition_context)
  values('individual',s.client_name,local_phone,local_phone,'1900-01-01',
   'self_employed_unregistered','Nao informado',0,false,false,'single',false,
   0,s.created_by_user_id,
   case when coalesce(s.financing_value,0)>0 or coalesce(s.total_purchase_power,0)>0 then 'completed' else 'pending' end,
   s.created_at,s.updated_at,
   '{"kind":"unknown","label":"Origem não identificada","metadata":{"backfill":"legacy_simulation"}}')
  returning id into v_client_id;
  update public.simulations set registration_id=v_client_id where id=s.id;
  update public.client_journeys set changed_at=null,previous_progress=progress where client_id=v_client_id;
 end loop;
end $$;
alter table public.simulations enable trigger simulations_set_updated_at;
