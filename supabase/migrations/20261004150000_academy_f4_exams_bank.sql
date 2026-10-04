-- Academia (F4): avaliações completas. Provas com várias questões (fixas ou sorteadas do banco), prova de módulo e banco de
-- questões não precisam de tabela nova (academy_exams/academy_exam_questions/academy_questions já suportam). Esta migration só:
-- (1) faz a publicação exigir que módulo com prova obrigatória tenha a prova; (2) índice por tema no banco de questões.
-- Aditiva; substitui apenas a função academy_publish_version.

create index if not exists academy_questions_topic_idx on public.academy_questions (topic);

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
  if exists (select 1 from public.academy_modules m where m.track_version_id = v.id and m.requires_exam
             and not exists (select 1 from public.academy_exams x where x.module_id = m.id and x.kind = 'module')) then
    raise exception 'publish_invalid_module_exam_missing' using errcode = 'P0001';
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

revoke all on function public.academy_publish_version(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.academy_publish_version(uuid, uuid, text, text) to service_role;
