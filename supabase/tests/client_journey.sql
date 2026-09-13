begin;
do $$
declare r public.simulation_registrations%rowtype; j public.client_journeys%rowtype; old_j public.client_journeys%rowtype; origin_before jsonb; first_time timestamptz; old_token text;
begin
 insert into public.simulation_registrations(simulation_type,full_name,phone,phone_normalized,oldest_birth_date,primary_income_type,primary_profession,primary_monthly_income,has_over_three_years_registered_work,has_children_under_18,primary_marital_status,has_residential_property,status,acquisition_context)
 values('individual','Jornada QA','(11) 99999-0000','11999990000','1990-01-01','self_employed_unregistered','Teste',3000,false,false,'single',false,'completed','{"kind":"manual","label":"Cadastro manual — QA","actor":"QA","destination":"broker"}') returning * into r;
 assert r.client_code like '#C%', 'Code not generated';
 select * into j from public.client_journeys where client_id=r.id;
 assert length(j.token)=64 and j.progress=40, 'Initial journey invalid';
 old_token := j.token;
 select to_jsonb(o) into origin_before from public.client_origins o where client_id=r.id;
 update public.simulation_registrations set status='approval_pending' where id=r.id;
 select * into j from public.client_journeys where client_id=r.id;
 assert j.previous_progress=40 and j.progress=65, '40 to 65 invalid';
 first_time := j.changed_at;
 perform pg_sleep(0.01);
 update public.simulation_registrations set status='restriction' where id=r.id;
 select * into j from public.client_journeys where client_id=r.id;
 assert j.previous_progress=65 and j.progress=65, 'Progress regressed';
 assert j.changed_at > first_time, 'Window not reset';
 old_j := j;
 update public.crm_settings set setting_value=jsonb_set(setting_value,'{restriction,progress}','10') where id='client_journey_statuses';
 select * into j from public.client_journeys where client_id=r.id;
 assert j.progress=65 and j.version=old_j.version, 'Config changed client progress';
 perform public.client_journey_action(r.id,'notify','QA',j.version);
 select * into j from public.client_journeys where client_id=r.id;
 assert j.notified_version=j.version and j.changed_at=old_j.changed_at, 'Notice changed celebration';
 update public.simulation_registrations set status='approved' where id=r.id;
 select * into j from public.client_journeys where client_id=r.id;
 assert j.progress=85 and j.previous_progress=65 and j.notified_version<>j.version, 'New notice not pending';
 begin
  perform public.client_journey_action(r.id,'notify','QA',j.version-1);
  raise exception 'Stale notification accepted';
 exception when raise_exception then
  if sqlerrm='Stale notification accepted' then raise; end if;
 end;
 update public.simulation_registrations set responsible_user_id=(select id from public.admin_users where status='active' limit 1) where id=r.id;
 assert (select token=old_token from public.client_journeys where client_id=r.id), 'Transfer changed token';
 assert (select to_jsonb(o)=origin_before from public.client_origins o where client_id=r.id), 'Transfer changed source';
 perform public.client_journey_action(r.id,'regenerate','QA');
 assert not exists(select 1 from public.client_journeys where token=old_token), 'Old token valid';
 begin
  update public.simulation_registrations set client_code='#WRONG' where id=r.id;
  raise exception 'Code mutation allowed';
 exception when raise_exception then
  if sqlerrm='Code mutation allowed' then raise; end if;
 end;
 begin
  update public.client_origins set source_label='changed' where client_id=r.id;
  raise exception 'Source mutation allowed';
 exception when raise_exception then
  if sqlerrm='Source mutation allowed' then raise; end if;
 end;
 update public.simulation_registrations set status='sale_caixa_signature' where id=r.id;
 assert (select progress=100 from public.client_journeys where client_id=r.id), 'Endpoint not 100';
 update public.simulation_registrations set status='archived' where id=r.id;
 assert (select progress=100 from public.client_journeys where client_id=r.id), 'Archive regressed';
 assert (select to_jsonb(o)=origin_before from public.client_origins o where client_id=r.id), 'Status changed source';
 assert not has_table_privilege('anon','public.client_journeys','select'), 'Public token table exposed';
 assert not has_table_privilege('authenticated','public.client_journeys','select'), 'Authenticated token enumeration allowed';
 assert not has_function_privilege('anon','public.client_journey_action(uuid,text,text,integer)','execute'), 'Public action exposed';
end $$;
rollback;
