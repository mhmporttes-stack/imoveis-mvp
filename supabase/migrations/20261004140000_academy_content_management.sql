-- Academia (F3): gestão de conteúdo (atividades, rascunho/publicação/versões) e liberação de tentativa extra.
-- Aditiva: 2 tabelas novas + funções novas; substitui só funções academy_* (guarda de imutabilidade, limite e gravação
-- de tentativa) criadas na F2. Não toca nenhuma tabela fora do prefixo academy_. RLS ligado e sem policy.
-- Regra do dono (2026-10-04): após as 3 tentativas, Admin/Gerente liberam +1 manualmente (por aluno e prova), com
-- registro de quem e quando; nunca automática nem ilimitada => 1 liberação por (matrícula, prova) e limite = max + 1.

create table if not exists public.academy_activities (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.academy_lessons(id) on delete restrict,
  position integer not null check (position > 0),
  kind text not null check (kind in ('tip','example','checklist')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists academy_activities_lesson_idx on public.academy_activities (lesson_id, position);

create table if not exists public.academy_attempt_grants (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.academy_enrollments(id) on delete restrict,
  exam_id uuid not null references public.academy_exams(id) on delete restrict,
  granted_by uuid references public.admin_users(id) on delete set null,
  granted_by_email text,
  reason text,
  granted_at timestamptz not null default now(),
  unique (enrollment_id, exam_id)
);

-- Imutabilidade da versão publicada, agora também para atividades; em UPDATE confere a versão antiga e a nova.
create or replace function public.academy_guard_published_content()
returns trigger language plpgsql as $$
declare v_old uuid; v_new uuid; v_status text;
begin
  if tg_table_name = 'academy_modules' then
    if tg_op <> 'INSERT' then v_old := old.track_version_id; end if;
    if tg_op <> 'DELETE' then v_new := new.track_version_id; end if;
  elsif tg_table_name = 'academy_lessons' then
    if tg_op <> 'INSERT' then select track_version_id into v_old from public.academy_modules where id = old.module_id; end if;
    if tg_op <> 'DELETE' then select track_version_id into v_new from public.academy_modules where id = new.module_id; end if;
  else
    if tg_op <> 'INSERT' then
      select m.track_version_id into v_old from public.academy_lessons l join public.academy_modules m on m.id = l.module_id where l.id = old.lesson_id;
    end if;
    if tg_op <> 'DELETE' then
      select m.track_version_id into v_new from public.academy_lessons l join public.academy_modules m on m.id = l.module_id where l.id = new.lesson_id;
    end if;
  end if;
  if tg_op <> 'INSERT' then
    select status into v_status from public.academy_track_versions where id = v_old;
    if v_status is distinct from 'draft' then raise exception 'academy_published_content_is_immutable' using errcode = 'P0001'; end if;
  end if;
  if tg_op <> 'DELETE' then
    select status into v_status from public.academy_track_versions where id = v_new;
    if v_status is distinct from 'draft' then raise exception 'academy_published_content_is_immutable' using errcode = 'P0001'; end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists academy_activities_guard on public.academy_activities;
create trigger academy_activities_guard before insert or update or delete on public.academy_activities
  for each row execute function public.academy_guard_published_content();

-- Limite de tentativas = max_attempts da prova + 1 se houver liberação manual para essa matrícula/prova.
create or replace function public.academy_guard_attempt_limit()
returns trigger language plpgsql as $$
declare v_max integer;
begin
  select max_attempts into v_max from public.academy_exams where id = new.exam_id;
  if v_max is not null then
    if exists (select 1 from public.academy_attempt_grants g where g.enrollment_id = new.enrollment_id and g.exam_id = new.exam_id) then
      v_max := v_max + 1;
    end if;
    if new.attempt_number > v_max then raise exception 'attempts_exhausted' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;

-- Mesma função da F2, com o limite ampliado pela liberação manual (+1) e devolvendo o limite efetivo.
create or replace function public.academy_record_attempt(
  p_user_id uuid, p_enrollment_id uuid, p_exam_id uuid, p_served jsonb, p_answers jsonb, p_score numeric, p_passed boolean
) returns jsonb language plpgsql as $$
declare e public.academy_enrollments%rowtype; x public.academy_exams%rowtype;
  v_count int; v_allowed int; v_attempt uuid; v_number int; v_rows int := 0; v_inserted boolean := false; v_status text; v_at timestamptz;
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
  v_allowed := x.max_attempts;
  if v_allowed is not null and exists (select 1 from public.academy_attempt_grants g where g.enrollment_id = e.id and g.exam_id = x.id) then
    v_allowed := v_allowed + 1;
  end if;
  if v_allowed is not null and v_count >= v_allowed then raise exception 'attempts_exhausted' using errcode = 'P0001'; end if;
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
    select completed_at into v_at from public.academy_lesson_progress where enrollment_id = e.id and lesson_id = x.lesson_id;
  end if;
  v_status := public.academy_refresh_enrollment(e.id);
  return jsonb_build_object('attempt_id', v_attempt, 'completed_at', v_at, 'attempt_number', v_number, 'max_attempts', v_allowed,
    'passed', p_passed, 'lesson_completed', v_inserted, 'enrollment_status', v_status);
end $$;

-- Liberação manual de +1 tentativa (Admin/Gerente; o escopo de equipe do gestor é conferido em lib/ antes da chamada).
create or replace function public.academy_grant_extra_attempt(
  p_enrollment_id uuid, p_exam_id uuid, p_actor uuid, p_actor_email text, p_reason text default null
) returns jsonb language plpgsql as $$
declare e public.academy_enrollments%rowtype; x public.academy_exams%rowtype; v_count int; v_grant uuid; v_at timestamptz;
begin
  select * into e from public.academy_enrollments where id = p_enrollment_id for update;
  if not found then raise exception 'enrollment_not_found' using errcode = 'P0001'; end if;
  if e.status not in ('assigned','in_progress') then raise exception 'enrollment_not_active' using errcode = 'P0001'; end if;
  select * into x from public.academy_exams where id = p_exam_id;
  if not found or x.track_version_id <> e.track_version_id then raise exception 'exam_not_in_enrollment' using errcode = 'P0001'; end if;
  if x.max_attempts is null then raise exception 'exam_without_limit' using errcode = 'P0001'; end if;
  if exists (select 1 from public.academy_exam_attempts a where a.enrollment_id = e.id and a.exam_id = x.id and a.passed is true) then
    raise exception 'already_passed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.academy_attempt_grants g where g.enrollment_id = e.id and g.exam_id = x.id) then
    raise exception 'grant_already_given' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.academy_exam_attempts a where a.enrollment_id = e.id and a.exam_id = x.id;
  if v_count < x.max_attempts then raise exception 'attempts_not_exhausted' using errcode = 'P0001'; end if;
  insert into public.academy_attempt_grants (enrollment_id, exam_id, granted_by, granted_by_email, reason)
    values (e.id, x.id, p_actor, nullif(btrim(coalesce(p_actor_email, '')), ''), nullif(btrim(coalesce(p_reason, '')), ''))
    returning id, granted_at into v_grant, v_at;
  insert into public.academy_events (actor_user_id, real_actor_email, user_id, action, ref, meta)
    values (p_actor, p_actor_email, e.user_id, 'attempt_granted', v_grant,
      jsonb_build_object('enrollment_id', e.id, 'exam_id', x.id, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  return jsonb_build_object('grant_id', v_grant, 'granted_at', v_at, 'max_attempts', x.max_attempts + 1);
end $$;

-- Cria um rascunho (nova versão) clonando uma versão existente (padrão: a publicada). Ids novos derivados do id da versão
-- (md5), stable_key preservado: "a mesma aula" é reconhecível entre versões. Uma única versão em rascunho por trilha.
create or replace function public.academy_create_draft(p_track_id uuid, p_from_version_id uuid, p_actor uuid, p_actor_email text, p_note text default null)
returns uuid language plpgsql as $$
declare v_src uuid; v_new uuid; v_number int; v_settings jsonb;
begin
  perform 1 from public.academy_tracks where id = p_track_id for update;
  if not found then raise exception 'track_not_found' using errcode = 'P0001'; end if;
  if exists (select 1 from public.academy_track_versions where track_id = p_track_id and status = 'draft') then
    raise exception 'draft_exists' using errcode = 'P0001';
  end if;
  v_src := p_from_version_id;
  if v_src is null then
    select id into v_src from public.academy_track_versions where track_id = p_track_id and status = 'published';
  end if;
  if v_src is not null and not exists (select 1 from public.academy_track_versions where id = v_src and track_id = p_track_id) then
    raise exception 'version_not_in_track' using errcode = 'P0001';
  end if;
  select coalesce(max(version_number), 0) + 1 into v_number from public.academy_track_versions where track_id = p_track_id;
  select settings into v_settings from public.academy_track_versions where id = v_src;
  insert into public.academy_track_versions (track_id, version_number, status, change_note, settings)
    values (p_track_id, v_number, 'draft', nullif(btrim(coalesce(p_note, '')), ''),
      coalesce(v_settings, '{"unlock_mode":"sequential","pass_score":70,"max_attempts":3,"quiz_max_attempts":null,"certificate_rule":"all_lessons_and_final_exam"}'::jsonb))
    returning id into v_new;
  if v_src is not null then
    insert into public.academy_modules (id, track_version_id, stable_key, position, title, summary, unlock_rule, is_final, requires_exam)
      select md5(m.id::text || v_new::text)::uuid, v_new, m.stable_key, m.position, m.title, m.summary, m.unlock_rule, m.is_final, m.requires_exam
      from public.academy_modules m where m.track_version_id = v_src;
    insert into public.academy_lessons (id, module_id, stable_key, position, title, est_minutes, kind, body)
      select md5(l.id::text || v_new::text)::uuid, md5(l.module_id::text || v_new::text)::uuid, l.stable_key, l.position, l.title, l.est_minutes, l.kind, l.body
      from public.academy_lessons l join public.academy_modules m on m.id = l.module_id where m.track_version_id = v_src;
    insert into public.academy_activities (id, lesson_id, position, kind, config)
      select md5(a.id::text || v_new::text)::uuid, md5(a.lesson_id::text || v_new::text)::uuid, a.position, a.kind, a.config
      from public.academy_activities a join public.academy_lessons l on l.id = a.lesson_id
      join public.academy_modules m on m.id = l.module_id where m.track_version_id = v_src;
    insert into public.academy_exams (id, track_version_id, module_id, lesson_id, kind, pass_score, max_attempts, time_limit_min, selection)
      select md5(x.id::text || v_new::text)::uuid, v_new,
        case when x.module_id is null then null else md5(x.module_id::text || v_new::text)::uuid end,
        case when x.lesson_id is null then null else md5(x.lesson_id::text || v_new::text)::uuid end,
        x.kind, x.pass_score, x.max_attempts, x.time_limit_min, x.selection
      from public.academy_exams x where x.track_version_id = v_src;
    insert into public.academy_exam_questions (exam_id, question_id, position, weight)
      select md5(q.exam_id::text || v_new::text)::uuid, q.question_id, q.position, q.weight
      from public.academy_exam_questions q join public.academy_exams x on x.id = q.exam_id where x.track_version_id = v_src;
  end if;
  insert into public.academy_events (actor_user_id, real_actor_email, action, ref, meta)
    values (p_actor, p_actor_email, 'draft_created', v_new, jsonb_build_object('track_id', p_track_id, 'from_version_id', v_src, 'version_number', v_number));
  return v_new;
end $$;

-- (Descartar um rascunho é feito por lib/academy-content-repo.mjs com apagamentos ordenados; os triggers de imutabilidade
-- garantem que só rascunho possa ser apagado. Nenhuma função SQL de DELETE aqui.)

-- Publica o rascunho: valida, aposenta a versão publicada atual e publica esta (uma transação). Matrículas existentes
-- continuam presas à versão em que começaram.
create or replace function public.academy_publish_version(p_version_id uuid, p_actor uuid, p_actor_email text, p_note text default null)
returns jsonb language plpgsql as $$
declare v public.academy_track_versions%rowtype; v_prev uuid;
begin
  select * into v from public.academy_track_versions where id = p_version_id for update;
  if not found then raise exception 'version_not_found' using errcode = 'P0001'; end if;
  perform 1 from public.academy_tracks where id = v.track_id for update;
  if v.status <> 'draft' then raise exception 'not_a_draft' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.academy_modules where track_version_id = v.id) then
    raise exception 'publish_invalid_empty' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.academy_modules m where m.track_version_id = v.id
             and not exists (select 1 from public.academy_lessons l where l.module_id = m.id)) then
    raise exception 'publish_invalid_module_without_lessons' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.academy_lessons l join public.academy_modules m on m.id = l.module_id
             where m.track_version_id = v.id and l.kind = 'final_exam'
               and not exists (select 1 from public.academy_exams x where x.lesson_id = l.id)) then
    raise exception 'publish_invalid_final_without_exam' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.academy_exams x where x.track_version_id = v.id
             and not exists (select 1 from public.academy_exam_questions q where q.exam_id = x.id)) then
    raise exception 'publish_invalid_exam_without_question' using errcode = 'P0001';
  end if;
  select id into v_prev from public.academy_track_versions where track_id = v.track_id and status = 'published';
  if v_prev is not null then
    update public.academy_track_versions set status = 'retired' where id = v_prev;
  end if;
  update public.academy_track_versions set status = 'published', published_at = now(), published_by = p_actor,
    change_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), change_note) where id = v.id;
  update public.academy_tracks set status = 'active', updated_at = now() where id = v.track_id and status <> 'archived';
  insert into public.academy_events (actor_user_id, real_actor_email, action, ref, meta)
    values (p_actor, p_actor_email, 'version_published', v.id,
      jsonb_build_object('track_id', v.track_id, 'version_number', v.version_number, 'previous_version_id', v_prev));
  return jsonb_build_object('version_id', v.id, 'version_number', v.version_number, 'previous_version_id', v_prev);
end $$;

alter table public.academy_activities enable row level security;
alter table public.academy_attempt_grants enable row level security;
revoke all on table public.academy_activities, public.academy_attempt_grants from anon, authenticated;
revoke all on function public.academy_grant_extra_attempt(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.academy_create_draft(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.academy_publish_version(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.academy_record_attempt(uuid, uuid, uuid, jsonb, jsonb, numeric, boolean) from public, anon, authenticated;
revoke all on function public.academy_guard_published_content() from public, anon, authenticated;
revoke all on function public.academy_guard_attempt_limit() from public, anon, authenticated;
grant execute on function public.academy_grant_extra_attempt(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.academy_create_draft(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.academy_publish_version(uuid, uuid, text, text) to service_role;
grant execute on function public.academy_record_attempt(uuid, uuid, uuid, jsonb, jsonb, numeric, boolean) to service_role;
