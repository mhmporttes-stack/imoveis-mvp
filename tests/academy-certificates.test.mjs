import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN, MANAGER, STUDENT_A, STUDENT_B, answer, buildWorld, student } from "./helpers/academy-world.mjs";
import { buildCertificatePdf } from "../lib/academy-certificate-pdf.mjs";
import { createAcademyCertificates } from "../lib/academy-certificates.mjs";

const rejects = (p, code, status) => assert.rejects(p, (e) => e.code === code && (status == null || e.status === status), `esperava ${code}`);
const NO_SCOPE = { admin: false, ids: [] };

async function finish(w, who) {
  await w.svc.loadStudent(student(who));
  for (const i of [0, 1, 2]) await w.svc.submitAttempt(student(who), w.e[i].x.id, answer(w.e[i], "b"));
  return w.db.tables.academy_enrollments.find((e) => e.user_id === who);
}

test("concluir a formação emite o certificado sozinho (1 só), com código e snapshot; antes disso não existe", async () => {
  const w = buildWorld();
  w.db.tables.admin_users.push({ id: STUDENT_A, name: "Ana Souza", email: "ana@x" });
  await w.svc.loadStudent(student(STUDENT_A));
  await w.svc.submitAttempt(student(STUDENT_A), w.e[0].x.id, answer(w.e[0], "b"));
  assert.equal(w.db.tables.academy_certificates.length, 0);
  assert.equal((await w.svc.loadStudent(student(STUDENT_A))).certificate, null);
  await w.svc.submitAttempt(student(STUDENT_A), w.e[1].x.id, answer(w.e[1], "b"));
  const last = await w.svc.submitAttempt(student(STUDENT_A), w.e[2].x.id, answer(w.e[2], "b"));
  assert.equal(last.enrollmentStatus, "completed");
  assert.equal(w.db.tables.academy_certificates.length, 1);
  const p = await w.svc.loadStudent(student(STUDENT_A));
  assert.match(p.certificate.code, /^MM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.deepEqual([p.certificate.holderName, p.certificate.trackTitle, p.certificate.lessonsTotal, p.certificate.revoked], ["Ana Souza", "Formação Inicial", 3, false]);
  assert.equal(p.certificate.issuedByAdmin, false, "emissão automática");
  await w.svc.loadStudent(student(STUDENT_A));
  assert.equal(w.db.tables.academy_certificates.length, 1, "idempotente");
});

test("matrícula concluída sem certificado (anterior à F5) é regularizada uma vez ao abrir; modo leitura não emite", async () => {
  const w = buildWorld();
  const enr = await finish(w, STUDENT_A);
  w.db.tables.academy_certificates.length = 0;
  const ro = await w.svc.loadStudent(student(STUDENT_A, { readOnly: true, reason: "account_switch" }));
  assert.equal(ro.certificate, null);
  assert.equal(w.db.tables.academy_certificates.length, 0);
  const p = await w.svc.loadStudent(student(STUDENT_A));
  assert.ok(p.certificate.code);
  assert.equal(w.db.tables.academy_certificates.filter((c) => c.enrollment_id === enr.id).length, 1);
});

test("acesso ao certificado: próprio, gestor da equipe, admin; os demais recebem 404", async () => {
  const w = buildWorld();
  await finish(w, STUDENT_A);
  const cert = w.db.tables.academy_certificates[0];
  assert.equal((await w.certificates.getForDownload(student(STUDENT_A), { admin: false, ids: [STUDENT_A] }, cert.id)).code, cert.code);
  await rejects(w.certificates.getForDownload(student(STUDENT_B), { admin: false, ids: [STUDENT_B] }, cert.id), "certificate_not_found", 404);
  assert.ok(await w.certificates.getForDownload(MANAGER, { admin: false, ids: [MANAGER.userId, STUDENT_A] }, cert.id));
  await rejects(w.certificates.getForDownload(MANAGER, { admin: false, ids: [MANAGER.userId] }, cert.id), "certificate_not_found", 404);
  assert.ok(await w.certificates.getForDownload(ADMIN, { admin: true, ids: null }, cert.id));
  await rejects(w.certificates.getForDownload(ADMIN, { admin: true }, "00000000-0000-4000-8000-000000000000"), "certificate_not_found", 404);
  void NO_SCOPE; void createAcademyCertificates;
});

test("verificação interna por código; revogar exige motivo, é auditada e não apaga; reemitir gera código novo", async () => {
  const w = buildWorld();
  const enr = await finish(w, STUDENT_A);
  const cert = w.db.tables.academy_certificates[0];
  const v = await w.certificates.verifyByCode(cert.code.toLowerCase());
  assert.deepEqual([v.valid, v.code], [true, cert.code]);
  await rejects(w.certificates.verifyByCode("abc"), "invalid_code", 400);
  await rejects(w.certificates.verifyByCode("MM-0000-0000-0000"), "certificate_not_found", 404);
  await rejects(w.certificates.revoke(ADMIN, { certificateId: cert.id, reason: "  " }), "reason_required", 400);
  await w.certificates.revoke(ADMIN, { certificateId: cert.id, reason: "emitido por engano" });
  const row = w.db.tables.academy_certificates[0];
  assert.deepEqual([Boolean(row.revoked_at), row.revoked_by, row.revoked_by_email, row.revoked_reason], [true, ADMIN.userId, ADMIN.email, "emitido por engano"]);
  assert.equal((await w.certificates.verifyByCode(cert.code)).valid, false);
  await rejects(w.certificates.revoke(ADMIN, { certificateId: cert.id, reason: "de novo" }), "already_revoked", 409);
  // aluno com certificado só revogado: a tela sabe que está revogado (sem download)
  assert.equal((await w.svc.loadStudent(student(STUDENT_A))).certificate.revoked, true);
  const again = await w.certificates.reissue(ADMIN, { enrollmentId: enr.id });
  assert.equal(again.created, true);
  assert.notEqual(again.code, cert.code);
  assert.equal(w.db.tables.academy_certificates.length, 2, "histórico preservado");
  const p = await w.svc.loadStudent(student(STUDENT_A));
  assert.deepEqual([p.certificate.code, p.certificate.revoked], [again.code, false]);
  assert.equal((await w.certificates.reissue(ADMIN, { enrollmentId: enr.id })).created, false, "idempotente");
});

test("PDF do certificado: válido, com acentos e nome longo/estranho, e marca REVOGADO sem falhar", async () => {
  const base = { code: "MM-ABCD-1234-EF56", holderName: "Maria José da Conceição ✓ Ñandú", trackTitle: "Formação Inicial", lessonsTotal: 18, finalScore: 92.5, completedAt: "2026-10-04T12:00:00Z", issuedAt: "2026-10-04T12:00:01Z" };
  const pdf = await buildCertificatePdf(base);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 1500);
  const long = await buildCertificatePdf({ ...base, holderName: "Nome Muito Comprido ".repeat(6), revoked: true });
  assert.equal(long.subarray(0, 5).toString(), "%PDF-");
});

test("versão parcial (trilha em construção): concluir tudo que existe NÃO conclui a matrícula nem emite certificado", async () => {
  const w = buildWorld();
  const ver = w.db.tables.academy_track_versions.find((v) => v.status === "published");
  ver.settings = { ...(ver.settings || {}), partial: true };
  const enr = await finish(w, STUDENT_A);
  assert.notEqual(enr.status, "completed");
  assert.equal(w.db.tables.academy_certificates.length, 0);
  const p = await w.svc.loadStudent(student(STUDENT_A));
  assert.equal(p.certificate, null);
  assert.equal(p.core.settings.partial, true);
});
