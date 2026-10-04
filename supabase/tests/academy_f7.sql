-- Teste da Academia F7 (rollback no fim): restrições das regras e das recomendações; regra inicial semeada.
begin;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
do $$
declare ua uuid; trk uuid; t2 uuid; m text; r uuid;
begin
  select id into ua from public.admin_users order by id limit 1;
  select id into trk from public.academy_tracks where slug = 'formacao-inicial';
  set local role service_role;
  assert (select active and due_days = 30 and audience_roles = array['broker','associate'] from public.academy_assignment_rules where track_id = trk and kind = 'new_user'), 'regra inicial da Formação Inicial';
  insert into public.academy_tracks (slug, title, kind) values ('trilha-f7', 'Trilha F7', 'reciclagem') returning id into t2;
  begin insert into public.academy_assignment_rules (track_id, kind) values (t2, 'recycle'); assert false, 'reciclagem sem intervalo';
  exception when check_violation then null; end;
  begin insert into public.academy_assignment_rules (track_id, kind, every_days) values (t2, 'recycle', 10); assert false, 'intervalo < 30 dias';
  exception when check_violation then null; end;
  begin insert into public.academy_assignment_rules (track_id, kind, audience_roles) values (t2, 'new_user', array['dono']); assert false, 'papel inválido';
  exception when check_violation then null; end;
  insert into public.academy_assignment_rules (track_id, kind, every_days, due_days) values (t2, 'recycle', 365, 30);
  assert (select active = false from public.academy_assignment_rules where track_id = t2), 'regra nova nasce DESLIGADA';
  begin insert into public.academy_assignment_rules (track_id, kind, every_days) values (t2, 'recycle', 90); assert false, 'regra duplicada';
  exception when unique_violation then null; end;
  insert into public.academy_recommendations (user_id, track_id, reason, created_by) values (ua, t2, 'Atendimento com vácuo', ua) returning id into r;
  begin insert into public.academy_recommendations (user_id, track_id, reason) values (ua, t2, 'de novo'); assert false, 'duas abertas';
  exception when unique_violation then null; end;
  begin insert into public.academy_recommendations (user_id, track_id, reason) values (ua, trk, '   '); assert false, 'motivo vazio';
  exception when check_violation then null; end;
  begin update public.academy_recommendations set status = 'dismissed' where id = r; assert false, 'decidida sem data';
  exception when check_violation then null; end;
  update public.academy_recommendations set status = 'dismissed', decided_at = now(), decided_by = ua where id = r;
  insert into public.academy_recommendations (user_id, track_id, reason) values (ua, t2, 'nova depois de dispensada');
  reset role; set local role anon;
  begin perform count(*) from public.academy_recommendations; assert false, 'anon leu'; exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'academy_f7: OK';
end $$;
rollback;
