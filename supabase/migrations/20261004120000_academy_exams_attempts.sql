-- Academia (F2) 3/4: banco de questões, provas/quizzes, tentativas, respostas e as funções atômicas de gravação.
-- Aditiva e isolada. RLS ligado e sem policy; as funções abaixo só executam com service_role.
-- O gabarito (academy_questions.correct) nunca sai do servidor antes do envio: a correção é feita em lib/.

create table if not exists public.academy_questions (
  id uuid primary key default gen_random_uuid(),
  stable_key uuid not null default gen_random_uuid(),
  qversion integer not null default 1 check (qversion > 0),
  type text not null default 'single' check (type in ('single','multi','true_false')),
  statement text not null check (length(btrim(statement)) > 0),
  options jsonb not null check (jsonb_typeof(options) = 'array'),
  correct jsonb not null check (jsonb_typeof(correct) = 'array' and jsonb_array_length(correct) > 0),
  explanation text,
  topic text,
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now(),
  unique (stable_key, qversion)
);

create table if not exists public.academy_exams (
  id uuid primary key default gen_random_uuid(),
  track_version_id uuid not null references public.academy_track_versions(id) on delete restrict,
  module_id uuid references public.academy_modules(id) on delete restrict,
  lesson_id uuid references public.academy_lessons(id) on delete restrict,
  kind text not null check (kind in ('quiz','module','final')),
  pass_score integer check (pass_score between 0 and 100),
  max_attempts integer check (max_attempts > 0),
  time_limit_min integer check (time_limit_min > 0),
  selection jsonb not null default '{"mode":"fixed"}'::jsonb,
  created_at timestamptz not null default now(),
  check ((kind = 'module' and module_id is not null and lesson_id is null)
      or (kind in ('quiz','final') and lesson_id is not null and module_id is null))
);
create unique index if not exists academy_exams_lesson_idx on public.academy_exams (lesson_id) where lesson_id is not null;
create unique index if not exists academy_exams_module_idx on public.academy_exams (module_id) where module_id is not null;
create index if not exists academy_exams_version_idx on public.academy_exams (track_version_id);

create table if not exists public.academy_exam_questions (
  exam_id uuid not null references public.academy_exams(id) on delete restrict,
  question_id uuid not null references public.academy_questions(id) on delete restrict,
  position integer not null default 1 check (position > 0),
  weight numeric(6,2) not null default 1 check (weight > 0),
  primary key (exam_id, question_id)
);

create table if not exists public.academy_exam_attempts (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.academy_enrollments(id) on delete restrict,
  exam_id uuid not null references public.academy_exams(id) on delete restrict,
  attempt_number integer not null check (attempt_number >= 1),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  score numeric(5,2) check (score between 0 and 100),
  passed boolean,
  status text not null default 'submitted' check (status in ('in_progress','submitted')),
  served jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (enrollment_id, exam_id, attempt_number)
);
create index if not exists academy_exam_attempts_exam_idx on public.academy_exam_attempts (exam_id);

create table if not exists public.academy_attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.academy_exam_attempts(id) on delete restrict,
  question_id uuid not null references public.academy_questions(id) on delete restrict,
  answer jsonb not null default '[]'::jsonb,
  is_correct boolean not null default false,
  points numeric(6,2) not null default 0 check (points >= 0),
  created_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

-- Questão é append-only: editar = nova qversion (o histórico de quem respondeu fica válido).
create or replace function public.academy_guard_question_update()
returns trigger language plpgsql as $$
begin
  if new.stable_key is distinct from old.stable_key or new.qversion is distinct from old.qversion
     or new.type is distinct from old.type or new.statement is distinct from old.statement
     or new.options is distinct from old.options or new.correct is distinct from old.correct then
    raise exception 'academy_question_is_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists academy_questions_guard on public.academy_questions;
create trigger academy_questions_guard before update on public.academy_questions
  for each row execute function public.academy_guard_question_update();

-- Prova da versão publicada é imutável (mesma regra do conteúdo).
create or replace function public.academy_guard_published_exam()
returns trigger language plpgsql as $$
declare v_status text; v_version uuid;
begin
  if tg_table_name = 'academy_exams' then
    v_version := case when tg_op = 'DELETE' then old.track_version_id else new.track_version_id end;
  else
    select e.track_version_id into v_version from public.academy_exams e
      where e.id = case when tg_op = 'DELETE' then old.exam_id else new.exam_id end;
  end if;
  select status into v_status from public.academy_track_versions where id = v_version;
  if v_status is distinct from 'draft' then
    raise exception 'academy_published_content_is_immutable' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists academy_exams_guard on public.academy_exams;
create trigger academy_exams_guard before insert or update or delete on public.academy_exams
  for each row execute function public.academy_guard_published_exam();
drop trigger if exists academy_exam_questions_guard on public.academy_exam_questions;
create trigger academy_exam_questions_guard before insert or update or delete on public.academy_exam_questions
  for each row execute function public.academy_guard_published_exam();

-- Defesa em profundidade: nenhuma tentativa acima do limite da prova, nem por caminho que não seja a função.
create or replace function public.academy_guard_attempt_limit()
returns trigger language plpgsql as $$
declare v_max integer;
begin
  select max_attempts into v_max from public.academy_exams where id = new.exam_id;
  if v_max is not null and new.attempt_number > v_max then
    raise exception 'attempts_exhausted' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists academy_exam_attempts_limit on public.academy_exam_attempts;
create trigger academy_exam_attempts_limit before insert on public.academy_exam_attempts
  for each row execute function public.academy_guard_attempt_limit();

-- Recalcula o estado da matrícula: in_progress ao começar; completed com 100% das aulas e todas as provas
-- de módulo/final aprovadas. Idempotente.
create or replace function public.academy_refresh_enrollment(p_enrollment_id uuid)
returns text language plpgsql as $$
declare e public.academy_enrollments%rowtype; v_total int; v_done int; v_pending_exams int;
begin
  select * into e from public.academy_enrollments where id = p_enrollment_id;
  if not found or e.status in ('cancelled','expired') then return coalesce(e.status, 'missing'); end if;
  select count(*) into v_total from public.academy_lessons l
    join public.academy_modules m on m.id = l.module_id where m.track_version_id = e.track_version_id;
  select count(*) into v_done from public.academy_lesson_progress p
    where p.enrollment_id = e.id and p.status = 'completed';
  select count(*) into v_pending_exams from public.academy_exams x
    where x.track_version_id = e.track_version_id and x.kind in ('module','final')
      and not exists (select 1 from public.academy_exam_attempts a
        where a.enrollment_id = e.id and a.exam_id = x.id and a.passed is true);
  if v_total > 0 and v_done >= v_total and v_pending_exams = 0 then
    update public.academy_enrollments set status = 'completed',
      completed_at = coalesce(completed_at, now()), started_at = coalesce(started_at, now()), updated_at = now()
      where id = e.id and status <> 'completed';
    return 'completed';
  elsif e.status = 'assigned' and v_done > 0 then
    update public.academy_enrollments set status = 'in_progress', started_at = coalesce(started_at, now()), updated_at = now()
      where id = e.id;
    return 'in_progress';
  end if;
  return e.status;
end $$;

-- Concluir aula SEM prova (idempotente). Aula com prova só conclui por academy_record_attempt.
create or replace function public.academy_complete_lesson(p_user_id uuid, p_enrollment_id uuid, p_lesson_id uuid, p_seconds integer default 0)
returns jsonb language plpgsql as $$
declare e public.academy_enrollments%rowtype; v_rows int := 0; v_inserted boolean := false; v_status text; v_at timestamptz;
begin
  select * into e from public.academy_enrollments where id = p_enrollment_id for update;
  if not found or e.user_id <> p_user_id then raise exception 'enrollment_not_found' using errcode = 'P0001'; end if;
  if e.status not in ('assigned','in_progress') then raise exception 'enrollment_not_active' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.academy_lessons l join public.academy_modules m on m.id = l.module_id
                 where l.id = p_lesson_id and m.track_version_id = e.track_version_id) then
    raise exception 'lesson_not_in_enrollment' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.academy_exams x where x.lesson_id = p_lesson_id) then
    raise exception 'exam_required' using errcode = 'P0001';
  end if;
  insert into public.academy_lesson_progress (enrollment_id, lesson_id, status, completed_at, seconds_spent)
    values (e.id, p_lesson_id, 'completed', now(), greatest(coalesce(p_seconds, 0), 0))
    on conflict (enrollment_id, lesson_id) do nothing;
  get diagnostics v_rows = row_count;
  v_inserted := v_rows > 0;
  if v_inserted then
    insert into public.academy_events (actor_user_id, user_id, action, ref, meta)
      values (p_user_id, p_user_id, 'lesson_completed', p_lesson_id, jsonb_build_object('enrollment_id', e.id));
  end if;
  select completed_at into v_at from public.academy_lesson_progress where enrollment_id = e.id and lesson_id = p_lesson_id;
  v_status := public.academy_refresh_enrollment(e.id);
  return jsonb_build_object('lesson_completed', v_inserted, 'completed_at', v_at, 'enrollment_status', v_status);
end $$;

-- Registrar tentativa corrigida (a nota vem de lib/; aqui só se grava, com trava e limite atômicos).
-- p_answers: [{question_id, answer, is_correct, points}]
create or replace function public.academy_record_attempt(
  p_user_id uuid, p_enrollment_id uuid, p_exam_id uuid, p_served jsonb, p_answers jsonb, p_score numeric, p_passed boolean
) returns jsonb language plpgsql as $$
declare e public.academy_enrollments%rowtype; x public.academy_exams%rowtype;
  v_count int; v_attempt uuid; v_number int; v_rows int := 0; v_inserted boolean := false; v_status text; v_at timestamptz;
begin
  select * into e from public.academy_enrollments where id = p_enrollment_id for update;
  if not found or e.user_id <> p_user_id then raise exception 'enrollment_not_found' using errcode = 'P0001'; end if;
  if e.status not in ('assigned','in_progress') then raise exception 'enrollment_not_active' using errcode = 'P0001'; end if;
  select * into x from public.academy_exams where id = p_exam_id;
  if not found or x.track_version_id <> e.track_version_id then raise exception 'exam_not_in_enrollment' using errcode = 'P0001'; end if;
  if exists (select 1 from public.academy_exam_attempts a where a.enrollment_id = e.id and a.exam_id = x.id and a.passed is true) then
    raise exception 'already_passed' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.academy_exam_attempts a where a.enrollment_id = e.id and a.exam_id = x.id;
  if x.max_attempts is not null and v_count >= x.max_attempts then raise exception 'attempts_exhausted' using errcode = 'P0001'; end if;
  v_number := v_count + 1;
  insert into public.academy_exam_attempts (enrollment_id, exam_id, attempt_number, submitted_at, score, passed, status, served)
    values (e.id, x.id, v_number, now(), p_score, p_passed, 'submitted', coalesce(p_served, '[]'::jsonb))
    returning id into v_attempt;
  insert into public.academy_attempt_answers (attempt_id, question_id, answer, is_correct, points)
    select v_attempt, (r->>'question_id')::uuid, coalesce(r->'answer', '[]'::jsonb), coalesce((r->>'is_correct')::boolean, false), coalesce((r->>'points')::numeric, 0)
    from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) r;
  insert into public.academy_events (actor_user_id, user_id, action, ref, meta)
    values (p_user_id, p_user_id, 'attempt_submitted', v_attempt,
      jsonb_build_object('exam_id', x.id, 'attempt_number', v_number, 'score', p_score, 'passed', p_passed));
  if p_passed and x.lesson_id is not null then
    insert into public.academy_lesson_progress (enrollment_id, lesson_id, status, completed_at)
      values (e.id, x.lesson_id, 'completed', now()) on conflict (enrollment_id, lesson_id) do nothing;
    get diagnostics v_rows = row_count;
    v_inserted := v_rows > 0;
    if v_inserted then
      insert into public.academy_events (actor_user_id, user_id, action, ref, meta)
        values (p_user_id, p_user_id, 'lesson_completed', x.lesson_id, jsonb_build_object('enrollment_id', e.id, 'via_exam', x.id));
    end if;
  end if;
  if p_passed and x.lesson_id is not null then
    select completed_at into v_at from public.academy_lesson_progress where enrollment_id = e.id and lesson_id = x.lesson_id;
  end if;
  v_status := public.academy_refresh_enrollment(e.id);
  return jsonb_build_object('attempt_id', v_attempt, 'completed_at', v_at, 'attempt_number', v_number, 'max_attempts', x.max_attempts,
    'passed', p_passed, 'lesson_completed', v_inserted, 'enrollment_status', v_status);
end $$;

alter table public.academy_questions enable row level security;
alter table public.academy_exams enable row level security;
alter table public.academy_exam_questions enable row level security;
alter table public.academy_exam_attempts enable row level security;
alter table public.academy_attempt_answers enable row level security;
revoke all on table public.academy_questions, public.academy_exams, public.academy_exam_questions,
  public.academy_exam_attempts, public.academy_attempt_answers from anon, authenticated;
revoke all on function public.academy_guard_question_update() from public, anon, authenticated;
revoke all on function public.academy_guard_published_exam() from public, anon, authenticated;
revoke all on function public.academy_guard_attempt_limit() from public, anon, authenticated;
revoke all on function public.academy_refresh_enrollment(uuid) from public, anon, authenticated;
revoke all on function public.academy_complete_lesson(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.academy_record_attempt(uuid, uuid, uuid, jsonb, jsonb, numeric, boolean) from public, anon, authenticated;
grant execute on function public.academy_refresh_enrollment(uuid) to service_role;
grant execute on function public.academy_complete_lesson(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.academy_record_attempt(uuid, uuid, uuid, jsonb, jsonb, numeric, boolean) to service_role;
