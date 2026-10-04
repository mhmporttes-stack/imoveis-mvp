// Certificados (F5) — regras de acesso e operações sobre `repo`. Regra do dono (2026-10-04): certificado só com 100% da formação
// + nota mínima cumprida (emissão automática no banco, ao concluir a matrícula); verificação PÚBLICA fica para fase posterior —
// aqui só há verificação por código para Admin/Gerente (interna). Revogar e reemitir: só Admin, com motivo e registro.
import { AcademyError } from "./academy-access-core.mjs";

export const certView = (c) => (c ? {
  id: c.id, code: c.code, issuedAt: c.issued_at, holderName: c.snapshot?.holder_name || "", trackTitle: c.snapshot?.track_title || "",
  versionNumber: c.snapshot?.version_number ?? null, lessonsTotal: c.snapshot?.lessons_total ?? null, finalScore: c.snapshot?.final_score ?? null,
  completedAt: c.snapshot?.completed_at || null, issuedByAdmin: Boolean(c.issued_by || c.issued_by_email),
  revoked: Boolean(c.revoked_at), revokedAt: c.revoked_at || null, revokedReason: c.revoked_reason || null
} : null);

// scope = { admin:true } | { admin:false, ids:[...] }. Aluno vê o próprio; gestor, o da equipe; admin, todos.
const canSee = (c, actor, scope) => c.user_id === actor.userId || Boolean(scope?.admin) || (scope?.ids || []).includes(c.user_id);

export function createAcademyCertificates(repo) {
  async function getForDownload(actor, scope, certificateId) {
    const c = await repo.getCertificateById(certificateId);
    if (!c || !canSee(c, actor, scope)) throw new AcademyError("certificate_not_found", 404); // não revela que existe
    return certView(c);
  }
  async function verifyByCode(code) {
    const clean = String(code || "").trim().toUpperCase();
    if (!/^MM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(clean)) throw new AcademyError("invalid_code", 400);
    const c = await repo.getCertificateByCode(clean);
    if (!c) throw new AcademyError("certificate_not_found", 404);
    const names = await repo.getAdminNames([c.user_id]);
    return { ...certView(c), holderName: c.snapshot?.holder_name || names[c.user_id] || "", valid: !c.revoked_at };
  }
  async function revoke(actor, { certificateId, reason }) {
    return repo.revokeCertificate({ certificateId, actor, reason });
  }
  // Reemitir: só para matrícula concluída (emissão manual por Admin, depois de revogar o anterior). Idempotente.
  async function reissue(actor, { enrollmentId }) {
    const r = await repo.issueCertificate({ enrollmentId, actor });
    return { certificateId: r.certificate_id, code: r.code, created: Boolean(r.created) };
  }
  return { getForDownload, verifyByCode, revoke, reissue };
}
