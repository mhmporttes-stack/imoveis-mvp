-- Academia (F5): certificados internos. Emitido AUTOMATICAMENTE quando a matrícula conclui (100% das aulas + todas as provas de
-- módulo/final aprovadas: regra do dono, 2026-10-04), idempotente (1 certificado válido por matrícula), com código aleatório e
-- snapshot do que foi concluído (o certificado não muda se a trilha mudar depois). Revogar é auditado (quem, quando, motivo) e
-- nunca apaga; reemitir gera um novo código. Verificação pública fica para fase posterior (decisão do dono): não há leitura anônima.
-- Aditiva. RLS ligado e sem policy (só service_role).

create table if not exists public.academy_certificates (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.academy_enrollments(id) on delete restrict,
  user_id uuid not null references public.admin_users(id) on delete restrict,
  track_version_id uuid not null references public.academy_track_versions(id) on delete restrict,
  code text not null unique check (code ~ '^MM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'),
  issued_at timestamptz not null default now(),
  issued_by uuid references public.admin_users(id) on delete set null,
  issued_by_email text,
  snapshot jsonb not null,
  revoked_at timestamptz,
  revoked_by uuid references public.admin_users(id) on delete set null,
  revoked_by_email text,
  revoked_reason text,
  created_at timestamptz not null default now(),
  check ((revoked_at is null) = (revoked_reason is null))
);
create unique index if not exists academy_certificates_one_valid_idx on public.academy_certificates (enrollment_id) where revoked_at is null;
create index if not exists academy_certificates_user_idx on public.academy_certificates (user_id);

-- Emite (ou devolve) o certificado válido da matrícula concluída. issued_by nulo = emissão automática.
create or replace function public.academy_issue_certificate(p_enrollment_id uuid, p_actor uuid, p_actor_email text)
returns jsonb language plpgsql as $$
declare e public.academy_enrollments%rowtype; c public.academy_certificates%rowtype;
  v_code text; v_h text; v_try int := 0; v_id uuid; v_at timestamptz; v_name text; v_track text; v_slug text; v_vnum int; v_total int; v_score numeric; v_snap jsonb;
begin
  select * into e from public.academy_enrollments where id = p_enrollment_id;
  if not found then raise exception 'enrollment_not_found' using errcode = 'P0001'; end if;
  if e.status <> 'completed' then raise exception 'enrollment_not_completed' using errcode = 'P0001'; end if;
  select * into c from public.academy_certificates where enrollment_id = e.id and revoked_at is null;
  if found then return jsonb_build_object('certificate_id', c.id, 'code', c.code, 'issued_at', c.issued_at, 'created', false); end if;
  select coalesce(nullif(btrim(u.name), ''), u.email) into v_name from public.admin_users u where u.id = e.user_id;
  select t.title, t.slug into v_track, v_slug from public.academy_tracks t where t.id = e.track_id;
  select v.version_number into v_vnum from public.academy_track_versions v where v.id = e.track_version_id;
  select count(*) into v_total from public.academy_lessons l join public.academy_modules m on m.id = l.module_id where m.track_version_id = e.track_version_id;
  select max(a.score) into v_score from public.academy_exam_attempts a join public.academy_exams x on x.id = a.exam_id
    where a.enrollment_id = e.id and x.kind = 'final' and a.passed is true;
  v_snap := jsonb_build_object('holder_name', v_name, 'track_title', v_track, 'track_slug', v_slug, 'version_number', v_vnum,
    'lessons_total', v_total, 'final_score', v_score, 'completed_at', e.completed_at);
  loop
    v_h := upper(encode(gen_random_bytes(6), 'hex'));
    v_code := 'MM-' || substr(v_h, 1, 4) || '-' || substr(v_h, 5, 4) || '-' || substr(v_h, 9, 4);
    begin
      insert into public.academy_certificates (enrollment_id, user_id, track_version_id, code, issued_by, issued_by_email, snapshot)
        values (e.id, e.user_id, e.track_version_id, v_code, p_actor, nullif(btrim(coalesce(p_actor_email, '')), ''), v_snap)
        returning id, issued_at into v_id, v_at;
      exit;
    exception when unique_violation then
      select * into c from public.academy_certificates where enrollment_id = e.id and revoked_at is null;
      if found then return jsonb_build_object('certificate_id', c.id, 'code', c.code, 'issued_at', c.issued_at, 'created', false); end if;
      v_try := v_try + 1;
      if v_try > 5 then raise; end if;
    end;
  end loop;
  insert into public.academy_events (actor_user_id, real_actor_email, user_id, action, ref, meta)
    values (p_actor, p_actor_email, e.user_id, 'certificate_issued', v_id,
      jsonb_build_object('enrollment_id', e.id, 'code', v_code, 'automatic', p_actor is null and p_actor_email is null));
  return jsonb_build_object('certificate_id', v_id, 'code', v_code, 'issued_at', v_at, 'created', true);
end $$;

create or replace function public.academy_revoke_certificate(p_certificate_id uuid, p_actor uuid, p_actor_email text, p_reason text)
returns jsonb language plpgsql as $$
declare c public.academy_certificates%rowtype; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into c from public.academy_certificates where id = p_certificate_id for update;
  if not found then raise exception 'certificate_not_found' using errcode = 'P0001'; end if;
  if c.revoked_at is not null then raise exception 'already_revoked' using errcode = 'P0001'; end if;
  if v_reason is null then raise exception 'reason_required' using errcode = 'P0001'; end if;
  update public.academy_certificates set revoked_at = now(), revoked_by = p_actor, revoked_by_email = nullif(btrim(coalesce(p_actor_email, '')), ''), revoked_reason = v_reason
    where id = c.id;
  insert into public.academy_events (actor_user_id, real_actor_email, user_id, action, ref, meta)
    values (p_actor, p_actor_email, c.user_id, 'certificate_revoked', c.id, jsonb_build_object('code', c.code, 'reason', v_reason));
  return jsonb_build_object('certificate_id', c.id, 'code', c.code);
end $$;

-- Conclusão da matrícula agora também emite o certificado (mesma transação). Mesma função da F2 + emissão.
create or replace function public.academy_refresh_enrollment(p_enrollment_id uuid)
returns text language plpgsql as $$
declare e public.academy_enrollments%rowtype; v_total int; v_done int; v_pending_exams int; v_rows int := 0;
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
    get diagnostics v_rows = row_count;
    if v_rows > 0 then perform public.academy_issue_certificate(e.id, null, null); end if;
    return 'completed';
  elsif e.status = 'assigned' and v_done > 0 then
    update public.academy_enrollments set status = 'in_progress', started_at = coalesce(started_at, now()), updated_at = now()
      where id = e.id;
    return 'in_progress';
  end if;
  return e.status;
end $$;

alter table public.academy_certificates enable row level security;
revoke all on table public.academy_certificates from anon, authenticated;
revoke all on function public.academy_issue_certificate(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.academy_revoke_certificate(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.academy_refresh_enrollment(uuid) from public, anon, authenticated;
grant execute on function public.academy_issue_certificate(uuid, uuid, text) to service_role;
grant execute on function public.academy_revoke_certificate(uuid, uuid, text, text) to service_role;
grant execute on function public.academy_refresh_enrollment(uuid) to service_role;
