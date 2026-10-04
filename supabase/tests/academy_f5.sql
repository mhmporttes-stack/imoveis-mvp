-- Teste da Academia F5 (rollback no fim): emissão automática e idempotente, código, snapshot, revogação auditada, reemissão.
begin;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
do $$
declare ua uuid; ver uuid; trk uuid; e1 uuid; e2 uuid; c1 jsonb; c2 jsonb; r jsonb; m text; cid uuid; fin_exam uuid;
begin
  select id into ua from public.admin_users order by id limit 1;
  select t.id, v.id into trk, ver from public.academy_tracks t join public.academy_track_versions v on v.track_id = t.id and v.status = 'published' where t.slug = 'formacao-inicial';
  set local role service_role;
  insert into public.academy_enrollments (user_id, track_id, track_version_id, started_at) values (ua, trk, ver, now()) returning id into e1;
  begin perform public.academy_issue_certificate(e1, null, null); assert false, 'emitiu sem concluir';
  exception when others then get stacked diagnostics m = message_text; assert m = 'enrollment_not_completed', 'msg: ' || m; end;
  -- conclui tudo: todas as aulas + prova final aprovada => certificado automático
  insert into public.academy_lesson_progress (enrollment_id, lesson_id, status, completed_at)
    select e1, l.id, 'completed', now() from public.academy_lessons l join public.academy_modules m on m.id = l.module_id where m.track_version_id = ver and l.kind <> 'final_exam';
  select x.id into fin_exam from public.academy_exams x where x.track_version_id = ver and x.kind = 'final';
  r := public.academy_record_attempt(ua, e1, fin_exam, '[]', '[]', 90, true);
  assert r->>'enrollment_status' = 'completed', 'conclusão: ' || r::text;
  assert (select count(*) from public.academy_certificates where enrollment_id = e1 and revoked_at is null) = 1, 'certificado automático';
  select id into cid from public.academy_certificates where enrollment_id = e1;
  assert (select code ~ '^MM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$' and issued_by is null and (snapshot->>'lessons_total')::int = 18 and (snapshot->>'final_score')::numeric = 90 and snapshot->>'track_title' = 'Formação Inicial' from public.academy_certificates where id = cid), 'código/snapshot';
  assert (select count(*) from public.academy_events where action = 'certificate_issued' and ref = cid and (meta->>'automatic')::boolean) = 1, 'evento automático';
  -- idempotente
  c1 := public.academy_issue_certificate(e1, ua, 'a@x');
  assert (c1->>'created')::boolean = false and (c1->>'certificate_id')::uuid = cid, 'idempotente: ' || c1::text;
  perform public.academy_refresh_enrollment(e1);
  assert (select count(*) from public.academy_certificates where enrollment_id = e1) = 1, 'refresh não duplica';
  -- revogar exige motivo; auditado; não apaga
  begin perform public.academy_revoke_certificate(cid, ua, 'a@x', '  '); assert false, 'revogou sem motivo';
  exception when others then get stacked diagnostics m = message_text; assert m = 'reason_required', 'msg motivo: ' || m; end;
  perform public.academy_revoke_certificate(cid, ua, 'a@x', 'emitido por engano');
  assert (select revoked_at is not null and revoked_by = ua and revoked_by_email = 'a@x' and revoked_reason = 'emitido por engano' from public.academy_certificates where id = cid), 'revogação auditada';
  assert (select count(*) from public.academy_certificates where id = cid) = 1, 'não apagou';
  begin perform public.academy_revoke_certificate(cid, ua, 'a@x', 'de novo'); assert false, 'revogou duas vezes';
  exception when others then get stacked diagnostics m = message_text; assert m = 'already_revoked', 'msg 2x: ' || m; end;
  -- reemitir gera código novo (admin) e mantém só 1 válido
  c2 := public.academy_issue_certificate(e1, ua, 'a@x');
  assert (c2->>'created')::boolean and c2->>'code' <> (select code from public.academy_certificates where id = cid), 'novo código: ' || c2::text;
  assert (select count(*) from public.academy_certificates where enrollment_id = e1 and revoked_at is null) = 1, 'um válido';
  assert (select count(*) from public.academy_certificates where enrollment_id = e1) = 2, 'histórico preservado';
  begin update public.academy_certificates set revoked_at = now() where id = (c2->>'certificate_id')::uuid; assert false, 'revogação sem motivo por update direto';
  exception when check_violation then null; end;
  -- RLS
  reset role; set local role anon;
  begin perform count(*) from public.academy_certificates; assert false, 'anon leu certificados'; exception when insufficient_privilege then null; end;
  set local role authenticated;
  begin perform public.academy_issue_certificate(e1, ua, 'a@x'); assert false, 'authenticated emitiu'; exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'academy_f5: OK';
end $$;
rollback;
