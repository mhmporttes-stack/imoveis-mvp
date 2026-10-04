-- Teste da Academia F4 (rollback no fim): módulo com prova obrigatória sem prova não publica; com prova publica.
begin;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
do $$
declare ua uuid; trk uuid; v uuid; m1 uuid; ex uuid; q uuid; msg text; r jsonb;
begin
  select id into ua from public.admin_users order by id limit 1;
  select id into trk from public.academy_tracks where slug = 'formacao-inicial';
  set local role service_role;
  v := public.academy_create_draft(trk, null, ua, 'a@x', 'f4');
  select id into m1 from public.academy_modules where track_version_id = v order by position limit 1;
  update public.academy_modules set requires_exam = true where id = m1;
  begin perform public.academy_publish_version(v, ua, 'a@x'); assert false, 'publicou sem prova de módulo';
  exception when others then get stacked diagnostics msg = message_text; assert msg = 'publish_invalid_module_exam_missing', 'msg: ' || msg; end;
  insert into public.academy_exams (track_version_id, module_id, kind, max_attempts, selection)
    values (v, m1, 'module', 3, '{"mode":"random","count":1}') returning id into ex;
  begin perform public.academy_publish_version(v, ua, 'a@x'); assert false, 'publicou prova sem questão';
  exception when others then get stacked diagnostics msg = message_text; assert msg = 'publish_invalid_exam_without_question', 'msg2: ' || msg; end;
  select id into q from public.academy_questions limit 1;
  insert into public.academy_exam_questions (exam_id, question_id, position) values (ex, q, 1);
  r := public.academy_publish_version(v, ua, 'a@x');
  assert (r->>'version_number')::int = 2, 'publicou: ' || r::text;
  assert (select count(*) from public.academy_exams where module_id = m1 and kind = 'module') = 1, 'prova do módulo ficou na versão publicada';
  reset role;
  raise notice 'academy_f4: OK';
end $$;
rollback;
