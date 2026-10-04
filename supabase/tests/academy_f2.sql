-- Teste da Academia F2 (rollback no fim: não deixa nada). Pré-requisito: as 4 migrations 20261004* aplicadas
-- e >= 2 linhas em admin_users. Rodar SEMPRE contra um banco local/de teste; em produção só como leitura não faz sentido
-- (grava dentro da transação e desfaz). Uso: psql -v ON_ERROR_STOP=1 -f supabase/tests/academy_f2.sql
begin;
-- imita os privilégios padrão do Supabase para tabelas (as funções NÃO são concedidas aqui: valem os grants das migrations)
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
do $$
declare
  ua uuid; ub uuid; ver uuid; ea uuid; eb uuid; fin_lesson uuid; fin_exam uuid; quiz_lesson uuid; quiz_exam uuid;
  r jsonb; ok boolean; msg text;
begin
  select id into ua from public.admin_users order by id limit 1;
  select id into ub from public.admin_users order by id offset 1 limit 1;
  assert ua is not null and ub is not null, 'precisa de 2 admin_users';
  select id into ver from public.academy_track_versions where status = 'published' and track_id = (select id from public.academy_tracks where slug = 'formacao-inicial');
  assert ver is not null, 'versão publicada da Formação Inicial ausente';

  -- seed: 6 módulos, 18 aulas, 18 provas (17 quiz + 1 final), 18 questões ligadas
  assert (select count(*) from public.academy_modules where track_version_id = ver) = 6, 'módulos';
  assert (select count(*) from public.academy_lessons l join public.academy_modules m on m.id = l.module_id where m.track_version_id = ver) = 18, 'aulas';
  assert (select count(*) from public.academy_exams where track_version_id = ver and kind = 'quiz') = 17, 'quizzes';
  assert (select count(*) from public.academy_exams where track_version_id = ver and kind = 'final' and max_attempts = 3) = 1, 'prova final com 3 tentativas';

  -- imutabilidade da versão publicada
  begin
    update public.academy_lessons set title = 'x' where id = (select l.id from public.academy_lessons l join public.academy_modules m on m.id = l.module_id where m.track_version_id = ver limit 1);
    assert false, 'aula publicada foi editada';
  exception when others then get stacked diagnostics msg = message_text; assert msg = 'academy_published_content_is_immutable', 'msg imutável: ' || msg; end;
  begin
    update public.academy_track_versions set settings = '{}' where id = ver;
    assert false, 'settings publicados foram editados';
  exception when others then get stacked diagnostics msg = message_text; assert msg = 'academy_published_version_is_immutable', 'msg versão: ' || msg; end;
  begin
    update public.academy_questions set correct = '["a"]' where id = (select id from public.academy_questions limit 1);
    assert false, 'questão foi editada';
  exception when others then get stacked diagnostics msg = message_text; assert msg = 'academy_question_is_immutable', 'msg questão: ' || msg; end;

  -- daqui até o RLS, tudo roda como service_role (o papel real do servidor): provam-se grants e triggers nesse papel
  set local role service_role;

  -- matrículas dos 2 alunos (uma ativa por aluno/trilha)
  insert into public.academy_enrollments (user_id, track_id, track_version_id, started_at)
    select ua, track_id, id, now() from public.academy_track_versions where id = ver returning id into ea;
  insert into public.academy_enrollments (user_id, track_id, track_version_id, started_at)
    select ub, track_id, id, now() from public.academy_track_versions where id = ver returning id into eb;
  begin
    insert into public.academy_enrollments (user_id, track_id, track_version_id) select ua, track_id, id from public.academy_track_versions where id = ver;
    assert false, 'matrícula ativa duplicada';
  exception when unique_violation then null; end;

  -- isolamento: aluno B não consegue registrar nada na matrícula do aluno A
  select e.id, e.lesson_id into quiz_exam, quiz_lesson from public.academy_exams e where e.kind = 'quiz' and e.track_version_id = ver limit 1;
  begin
    perform public.academy_record_attempt(ub, ea, quiz_exam, '[]', '[]', 100, true);
    assert false, 'aluno B gravou na matrícula de A';
  exception when others then get stacked diagnostics msg = message_text; assert msg = 'enrollment_not_found', 'msg isolamento: ' || msg; end;

  -- quiz: errar não conclui (sem limite), acertar conclui a aula, idempotente
  for i in 1..5 loop
    r := public.academy_record_attempt(ua, ea, quiz_exam, '[]', '[]', 0, false);
    assert (r->>'lesson_completed')::boolean = false, 'errou e concluiu';
  end loop;
  assert (select count(*) from public.academy_exam_attempts where enrollment_id = ea and exam_id = quiz_exam) = 5, '5 tentativas de quiz';
  r := public.academy_record_attempt(ua, ea, quiz_exam, '[]', '[{"question_id":"a0000000-0000-4000-8000-000900000001","answer":["b"],"is_correct":true,"points":1}]', 100, true);
  assert (r->>'passed')::boolean and (r->>'lesson_completed')::boolean and (r->>'attempt_number')::int = 6, 'acertou: ' || r::text;
  assert (select count(*) from public.academy_lesson_progress where enrollment_id = ea and lesson_id = quiz_lesson) = 1, 'progresso';
  begin
    perform public.academy_record_attempt(ua, ea, quiz_exam, '[]', '[]', 100, true);
    assert false, 'tentou de novo após aprovado';
  exception when others then get stacked diagnostics msg = message_text; assert msg = 'already_passed', 'msg already_passed: ' || msg; end;
  assert (select count(*) from public.academy_lesson_progress where enrollment_id = eb) = 0, 'progresso de B intacto';

  -- prova final: máximo de 3 tentativas
  select e.id, e.lesson_id into fin_exam, fin_lesson from public.academy_exams e where e.kind = 'final' and e.track_version_id = ver;
  for i in 1..3 loop
    r := public.academy_record_attempt(ub, eb, fin_exam, '[]', '[]', 0, false);
    assert (r->>'attempt_number')::int = i and (r->>'max_attempts')::int = 3, 'tentativa ' || i;
  end loop;
  begin
    perform public.academy_record_attempt(ub, eb, fin_exam, '[]', '[]', 100, true);
    assert false, 'quarta tentativa aceita';
  exception when others then get stacked diagnostics msg = message_text; assert msg = 'attempts_exhausted', 'msg esgotada: ' || msg; end;
  begin
    insert into public.academy_exam_attempts (enrollment_id, exam_id, attempt_number) values (eb, fin_exam, 4);
    assert false, 'trigger não barrou tentativa 4';
  exception when others then get stacked diagnostics msg = message_text; assert msg = 'attempts_exhausted', 'msg trigger: ' || msg; end;
  assert (select count(*) from public.academy_exam_attempts where enrollment_id = eb and exam_id = fin_exam) = 3, 'exatamente 3';

  -- concluir aula com prova pela via sem prova é recusado; aula sem prova conclui (idempotente)
  begin
    perform public.academy_complete_lesson(ua, ea, fin_lesson);
    assert false, 'concluiu aula que exige prova';
  exception when others then get stacked diagnostics msg = message_text; assert msg = 'exam_required', 'msg exam_required: ' || msg; end;

  -- conclusão da matrícula: todas as aulas + final aprovada => completed
  insert into public.academy_lesson_progress (enrollment_id, lesson_id, status, completed_at)
    select ea, l.id, 'completed', now() from public.academy_lessons l join public.academy_modules m on m.id = l.module_id
    where m.track_version_id = ver and l.id <> fin_lesson on conflict do nothing;
  assert public.academy_refresh_enrollment(ea) = 'in_progress', 'sem a final não conclui';
  r := public.academy_record_attempt(ua, ea, fin_exam, '[]', '[]', 100, true);
  assert r->>'enrollment_status' = 'completed', 'conclusão: ' || r::text;
  assert (select completed_at is not null from public.academy_enrollments where id = ea), 'completed_at';

  -- RLS: anon/authenticated não leem nem escrevem
  reset role;
  set local role anon;
  begin perform count(*) from public.academy_questions; assert false, 'anon leu gabarito'; exception when insufficient_privilege then null; end;
  set local role authenticated;
  begin perform count(*) from public.academy_exam_attempts; assert false, 'authenticated leu tentativas'; exception when insufficient_privilege then null; end;
  begin perform public.academy_record_attempt(ua, ea, quiz_exam, '[]', '[]', 0, false); assert false, 'authenticated executou função'; exception when insufficient_privilege then null; end;
  reset role;
  assert (select count(*) from pg_tables where schemaname = 'public' and tablename like 'academy\_%' and not rowsecurity) = 0, 'toda tabela academy_ com RLS';
  raise notice 'academy_f2: OK';
end $$;
rollback;
