-- Academia: versão PARCIAL (trilha em construção). Quando o conteúdo publicado ainda não é a formação inteira
-- (`academy_track_versions.settings.partial = true`), concluir todas as aulas e provas disponíveis NÃO conclui a
-- matrícula nem emite certificado (regra do dono: certificado só com 100% da formação). Sem esse marcador, nada muda.
-- Só substitui a função (mesma assinatura, mesmos grants); nenhuma tabela é alterada.
create or replace function public.academy_refresh_enrollment(p_enrollment_id uuid)
returns text language plpgsql as $fn$
declare e public.academy_enrollments%rowtype; v_total int; v_done int; v_pending_exams int; v_rows int := 0; v_partial boolean := false;
begin
  select * into e from public.academy_enrollments where id = p_enrollment_id;
  if not found or e.status in ('cancelled','expired') then return coalesce(e.status, 'missing'); end if;
  select coalesce(v.settings->>'partial', 'false') = 'true' into v_partial
    from public.academy_track_versions v where v.id = e.track_version_id;
  select count(*) into v_total from public.academy_lessons l
    join public.academy_modules m on m.id = l.module_id where m.track_version_id = e.track_version_id;
  select count(*) into v_done from public.academy_lesson_progress p
    where p.enrollment_id = e.id and p.status = 'completed';
  select count(*) into v_pending_exams from public.academy_exams x
    where x.track_version_id = e.track_version_id and x.kind in ('module','final')
      and not exists (select 1 from public.academy_exam_attempts a
        where a.enrollment_id = e.id and a.exam_id = x.id and a.passed is true);
  if v_total > 0 and v_done >= v_total and v_pending_exams = 0 and not coalesce(v_partial, false) then
    update public.academy_enrollments set status = 'completed',
      completed_at = coalesce(completed_at, now()), started_at = coalesce(started_at, now()), updated_at = now()
      where id = e.id and status <> 'completed';
    get diagnostics v_rows = row_count;
    if v_rows > 0 then perform public.academy_issue_certificate(e.id, null, null); end if;
    return 'completed';
  elsif e.status = 'assigned' and v_done > 0 then
    update public.academy_enrollments set status = 'in_progress', started_at = coalesce(started_at, now()), updated_at = now()
      where id = e.id;
    return 'in_progress';
  end if;
  return e.status;
end $fn$;
