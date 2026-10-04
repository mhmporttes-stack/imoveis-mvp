-- Teste da Academia F3 (rollback no fim). Pré-requisito: migrations 20261004* aplicadas e >= 2 linhas em admin_users.
-- Rodar só em banco local/de teste: grava dentro da transação e desfaz. Uso: psql -v ON_ERROR_STOP=1 -f supabase/tests/academy_f3.sql
begin;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
do $$
declare
  ua uuid; ub uuid; trk uuid; v1 uuid; v2 uuid; vx uuid; t2 uuid; v_empty uuid; ea uuid; eb uuid;
  fin_exam uuid; fin_lesson uuid; r jsonb; m text; n int; k uuid; mod2 uuid; les2 uuid;
begin
  select id into ua from public.admin_users order by id limit 1;
  select id into ub from public.admin_users order by id offset 1 limit 1;
  select t.id, v.id into trk, v1 from public.academy_tracks t join public.academy_track_versions v on v.track_id = t.id and v.status = 'published' where t.slug = 'formacao-inicial';
  assert v1 is not null, 'versão publicada';
  set local role service_role;

  -- rascunho: clona tudo, preserva stable_key, uma só por trilha
  v2 := public.academy_create_draft(trk, null, ua, 'a@x', 'rascunho de teste');
  assert (select version_number from public.academy_track_versions where id = v2) = 2, 'número 2';
  assert (select status from public.academy_track_versions where id = v2) = 'draft', 'draft';
  assert (select count(*) from public.academy_modules where track_version_id = v2) = 6, 'módulos clonados';
  assert (select count(*) from public.academy_lessons l join public.academy_modules m on m.id = l.module_id where m.track_version_id = v2) = 18, 'aulas clonadas';
  assert (select count(*) from public.academy_exams where track_version_id = v2) = 18, 'provas clonadas';
  assert (select count(*) from public.academy_exam_questions q join public.academy_exams x on x.id = q.exam_id where x.track_version_id = v2) = 18, 'questões vinculadas';
  assert (select count(*) from public.academy_lessons l join public.academy_modules m on m.id = l.module_id join public.academy_lessons o on o.stable_key = l.stable_key and o.id <> l.id where m.track_version_id = v2) = 18, 'stable_key preservado';
  assert (select count(*) from public.academy_exams x join public.academy_lessons l on l.id = x.lesson_id join public.academy_modules m on m.id = l.module_id where x.track_version_id = v2 and m.track_version_id = v2) = 18, 'provas apontam para aulas do rascunho';
  begin perform public.academy_create_draft(trk, null, ua, 'a@x'); assert false, 'segundo rascunho';
  exception when others then get stacked diagnostics m = message_text; assert m = 'draft_exists', 'msg draft_exists: ' || m; end;

  -- edição no rascunho é livre; a versão publicada continua imutável (inclusive atividades)
  update public.academy_lessons set title = 'Aula editada' where id = (select l.id from public.academy_lessons l join public.academy_modules m on m.id = l.module_id where m.track_version_id = v2 order by m.position, l.position limit 1);
  assert (select l.title from public.academy_lessons l join public.academy_modules m on m.id = l.module_id where m.track_version_id = v1 order by m.position, l.position limit 1) <> 'Aula editada', 'publicada intacta';
  select l.id into les2 from public.academy_lessons l join public.academy_modules m on m.id = l.module_id where m.track_version_id = v2 order by m.position, l.position limit 1;
  insert into public.academy_activities (lesson_id, position, kind, config) values (les2, 1, 'tip', '{"text":"dica"}');
  begin
    insert into public.academy_activities (lesson_id, position, kind, config)
      select l.id, 1, 'tip', '{}' from public.academy_lessons l join public.academy_modules m on m.id = l.module_id where m.track_version_id = v1 limit 1;
    assert false, 'atividade em versão publicada';
  exception when others then get stacked diagnostics m = message_text; assert m = 'academy_published_content_is_immutable', 'msg atividade: ' || m; end;
  begin
    update public.academy_lessons set module_id = (select id from public.academy_modules where track_version_id = v1 limit 1) where id = les2;
    assert false, 'mover aula do rascunho para versão publicada';
  exception when others then get stacked diagnostics m = message_text; assert m = 'academy_published_content_is_immutable', 'msg mover: ' || m; end;

  -- publicação: valida
  update public.academy_modules set title = title where track_version_id = v2;
  select id into mod2 from public.academy_modules where track_version_id = v2 order by position limit 1;
  insert into public.academy_modules (track_version_id, position, title) values (v2, 99, 'Módulo vazio');
  begin perform public.academy_publish_version(v2, ua, 'a@x'); assert false, 'publicou módulo sem aulas';
  exception when others then get stacked diagnostics m = message_text; assert m = 'publish_invalid_module_without_lessons', 'msg vazio: ' || m; end;
  delete from public.academy_modules where track_version_id = v2 and position = 99;
  insert into public.academy_lessons (module_id, position, title, kind) values (mod2, 99, 'Final sem prova', 'final_exam');
  begin perform public.academy_publish_version(v2, ua, 'a@x'); assert false, 'publicou final sem prova';
  exception when others then get stacked diagnostics m = message_text; assert m = 'publish_invalid_final_without_exam', 'msg final: ' || m; end;
  delete from public.academy_lessons where module_id = mod2 and position = 99;

  -- matrícula antiga fica presa à v1 mesmo após publicar a v2
  insert into public.academy_enrollments (user_id, track_id, track_version_id, started_at) values (ua, trk, v1, now()) returning id into ea;
  r := public.academy_publish_version(v2, ua, 'a@x', 'v2 de teste');
  assert (r->>'version_number')::int = 2 and (r->>'previous_version_id')::uuid = v1, 'publish: ' || r::text;
  assert (select status from public.academy_track_versions where id = v1) = 'retired', 'v1 aposentada';
  assert (select status from public.academy_track_versions where id = v2) = 'published' and (select published_by from public.academy_track_versions where id = v2) = ua, 'v2 publicada por ua';
  assert (select count(*) from public.academy_track_versions where track_id = trk and status = 'published') = 1, 'uma publicada';
  assert (select track_version_id from public.academy_enrollments where id = ea) = v1, 'matrícula presa à v1';
  assert (select count(*) from public.academy_events where action in ('draft_created','version_published') and real_actor_email = 'a@x') = 2, 'eventos';
  begin update public.academy_lessons set title = 'x' where id = les2; assert false, 'editou v2 publicada';
  exception when others then get stacked diagnostics m = message_text; assert m = 'academy_published_content_is_immutable', 'msg v2: ' || m; end;
  begin perform public.academy_publish_version(v2, ua, 'a@x'); assert false, 'publicou de novo';
  exception when others then get stacked diagnostics m = message_text; assert m = 'not_a_draft', 'msg not_a_draft: ' || m; end;

  -- restaurar versão antiga = novo rascunho a partir da v1 (aposentada)
  vx := public.academy_create_draft(trk, v1, ua, 'a@x', 'restaurar v1');
  assert (select version_number from public.academy_track_versions where id = vx) = 3, 'v3';
  assert (select l.title from public.academy_lessons l join public.academy_modules m on m.id = l.module_id where m.track_version_id = vx order by m.position, l.position limit 1) <> 'Aula editada', 'v3 vem da v1';
  -- descartar (feito pelo app com apagamentos ordenados): só rascunho pode ser apagado
  delete from public.academy_exam_questions where exam_id in (select id from public.academy_exams where track_version_id = vx);
  delete from public.academy_exams where track_version_id = vx;
  delete from public.academy_lessons where module_id in (select id from public.academy_modules where track_version_id = vx);
  delete from public.academy_modules where track_version_id = vx;
  delete from public.academy_track_versions where id = vx;
  assert not exists (select 1 from public.academy_track_versions where id = vx), 'rascunho descartado';
  assert (select count(*) from public.academy_modules where track_version_id = v2) = 6, 'v2 intacta após descartar';
  begin delete from public.academy_lessons where module_id in (select id from public.academy_modules where track_version_id = v2); assert false, 'apagou aulas de versão publicada';
  exception when others then get stacked diagnostics m = message_text; assert m = 'academy_published_content_is_immutable', 'msg apagar publicada: ' || m; end;

  -- trilha nova: rascunho vazio não publica
  insert into public.academy_tracks (slug, title, kind) values ('trilha-teste', 'Trilha teste', 'aperfeicoamento') returning id into t2;
  v_empty := public.academy_create_draft(t2, null, ua, 'a@x');
  begin perform public.academy_publish_version(v_empty, ua, 'a@x'); assert false, 'publicou vazio';
  exception when others then get stacked diagnostics m = message_text; assert m = 'publish_invalid_empty', 'msg vazio2: ' || m; end;

  -- liberação de +1 tentativa: só depois das 3, uma vez, com registro; limite = 4
  insert into public.academy_enrollments (user_id, track_id, track_version_id, started_at) values (ub, trk, v2, now()) returning id into eb;
  select x.id, x.lesson_id into fin_exam, fin_lesson from public.academy_exams x where x.track_version_id = v2 and x.kind = 'final';
  begin perform public.academy_grant_extra_attempt(eb, fin_exam, ua, 'a@x'); assert false, 'liberou antes de esgotar';
  exception when others then get stacked diagnostics m = message_text; assert m = 'attempts_not_exhausted', 'msg antes: ' || m; end;
  for i in 1..3 loop perform public.academy_record_attempt(ub, eb, fin_exam, '[]', '[]', 0, false); end loop;
  begin perform public.academy_record_attempt(ub, eb, fin_exam, '[]', '[]', 0, false); assert false, '4ª sem liberação';
  exception when others then get stacked diagnostics m = message_text; assert m = 'attempts_exhausted', 'msg 4a: ' || m; end;
  r := public.academy_grant_extra_attempt(eb, fin_exam, ua, 'a@x', 'motivo teste');
  assert (r->>'max_attempts')::int = 4, 'limite efetivo 4: ' || r::text;
  assert (select granted_by = ua and granted_by_email = 'a@x' and granted_at is not null and reason = 'motivo teste' from public.academy_attempt_grants where enrollment_id = eb and exam_id = fin_exam), 'registro de quem/quando';
  assert (select count(*) from public.academy_events where action = 'attempt_granted' and user_id = ub and actor_user_id = ua) = 1, 'evento da liberação';
  begin perform public.academy_grant_extra_attempt(eb, fin_exam, ua, 'a@x'); assert false, 'segunda liberação';
  exception when others then get stacked diagnostics m = message_text; assert m = 'grant_already_given', 'msg 2a: ' || m; end;
  r := public.academy_record_attempt(ub, eb, fin_exam, '[]', '[]', 0, false);
  assert (r->>'attempt_number')::int = 4 and (r->>'max_attempts')::int = 4, 'quarta tentativa permitida: ' || r::text;
  begin perform public.academy_record_attempt(ub, eb, fin_exam, '[]', '[]', 100, true); assert false, '5ª tentativa';
  exception when others then get stacked diagnostics m = message_text; assert m = 'attempts_exhausted', 'msg 5a: ' || m; end;
  begin insert into public.academy_exam_attempts (enrollment_id, exam_id, attempt_number) values (eb, fin_exam, 5); assert false, 'trigger não barrou a 5ª';
  exception when others then get stacked diagnostics m = message_text; assert m = 'attempts_exhausted', 'msg trigger 5a: ' || m; end;
  -- prova sem limite (quiz) não aceita liberação
  begin perform public.academy_grant_extra_attempt(eb, (select id from public.academy_exams where track_version_id = v2 and kind = 'quiz' limit 1), ua, 'a@x'); assert false, 'liberou quiz';
  exception when others then get stacked diagnostics m = message_text; assert m = 'exam_without_limit', 'msg quiz: ' || m; end;

  -- RLS/privilégios das tabelas novas
  reset role;
  set local role anon;
  begin perform count(*) from public.academy_attempt_grants; assert false, 'anon leu liberações'; exception when insufficient_privilege then null; end;
  set local role authenticated;
  begin perform public.academy_publish_version(v2, ua, 'a@x'); assert false, 'authenticated publicou'; exception when insufficient_privilege then null; end;
  begin perform public.academy_grant_extra_attempt(eb, fin_exam, ua, 'a@x'); assert false, 'authenticated liberou'; exception when insufficient_privilege then null; end;
  reset role;
  assert (select count(*) from pg_tables where schemaname = 'public' and tablename like 'academy\_%' and not rowsecurity) = 0, 'RLS em todas';
  raise notice 'academy_f3: OK';
end $$;
rollback;
