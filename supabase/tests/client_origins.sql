begin;
do $$
declare c record; source jsonb; r public.simulation_registrations%rowtype; assigned uuid; before_count bigint;
begin
 select count(*) into before_count from public.simulation_registrations;
 select id,name into c from public.campaigns order by created_at limit 1;
 for source in select value from jsonb_array_elements(jsonb_build_array(
  '{"kind":"site","label":"Link Geral do Site","destination":"broker"}'::jsonb,
  '{"kind":"broker_link","label":"Link pessoal — QA","destination":"broker"}'::jsonb,
  '{"kind":"roulette_link","label":"Link da Roleta","destination":"roulette"}'::jsonb,
  jsonb_build_object('kind','campaign','label',c.name,'campaign_id',c.id,'campaign_name',c.name,'destination','roulette'),
  '{"kind":"manual","label":"Cadastro manual — QA","actor":"QA","destination":"broker"}'::jsonb
 )) loop
  insert into public.simulation_registrations(simulation_type,full_name,phone,phone_normalized,oldest_birth_date,primary_income_type,primary_profession,primary_monthly_income,has_over_three_years_registered_work,has_children_under_18,primary_marital_status,has_residential_property,status,acquisition_context)
  values('individual','Origem QA','11999990000','11999990000','1990-01-01','self_employed_unregistered','Teste',3000,false,false,'single',false,'completed',source) returning * into r;
  assert (select count(*)=1 from public.client_origins where client_id=r.id), 'Duplicate original source';
  assert (select source_kind=source->>'kind' and source_label=source->>'label' from public.client_origins where client_id=r.id), 'Source not captured';
  assert (select initial_destination=source->>'destination' from public.client_origins where client_id=r.id), 'Initial destination lost';
 end loop;
 assert (select count(*)=before_count+5 from public.simulation_registrations), 'Unexpected client duplication';
 assigned := public.assign_round_robin_lead();
 assert assigned is not null, 'Roulette has no recipient';
 assert exists(select 1 from public.admin_users where id=assigned and status='active' and lead_distribution_enabled), 'Invalid roulette recipient';
 assert (select last_broker_id=assigned from public.lead_distribution_state where id='default'), 'Roulette state not advanced';
end $$;
rollback;
