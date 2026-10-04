// Regras de matrícula automática e recomendações (F7). PREPARAM matrículas: nenhuma mensagem, push ou WhatsApp é enviado
// (decisão do plano; só com decisão do dono depois). Recebe `repo` (merge de academy-repo + academy-content-repo).
//  - new_user: Formação Inicial obrigatória para NOVOS corretores/associados (regra do dono, 2026-10-04): vale para quem foi
//    criado a partir de `starts_at`; quem já existia não é afetado. Prazo = matrícula + due_days.
//  - recycle: refazer a trilha `every_days` dias depois de concluir (reciclagem), com novo prazo.
// Escopo: regras = só Admin (afetam todos). Recomendação: Admin para qualquer um; Gerente só para a própria equipe.
import { AcademyError } from "./academy-access-core.mjs";

const DAY = 24 * 3600 * 1000;
const LIVE = new Set(["assigned", "in_progress"]);
const ROLES = ["admin", "manager", "broker", "associate"];
const inScope = (scope, userId) => scope.admin || (scope.ids || []).includes(userId);

// Quem entra agora (puro). rule + usuários + matrículas da trilha + agora => [{userId, source}]
export function planRuleEnrollments(rule, users, enrollments, nowMs) {
  const out = [];
  for (const u of users) {
    if (u.status === "inactive" || !rule.audience_roles.includes(u.role)) continue;
    const mine = enrollments.filter((e) => e.user_id === u.id);
    if (mine.some((e) => LIVE.has(e.status))) continue;
    if (rule.kind === "new_user") {
      if (mine.length === 0 && Date.parse(u.created_at) >= Date.parse(rule.starts_at)) out.push({ userId: u.id, source: "auto_new_broker" });
    } else if (rule.kind === "recycle") {
      const done = mine.filter((e) => e.status === "completed" && e.completed_at).map((e) => Date.parse(e.completed_at));
      if (done.length && Math.max(...done) + rule.every_days * DAY <= nowMs && Date.parse(rule.starts_at) <= nowMs) out.push({ userId: u.id, source: "recycle" });
    }
  }
  return out;
}

export function createAcademyRules(repo, { now = () => new Date().toISOString() } = {}) {
  async function list() {
    const [rules, tracks] = await Promise.all([repo.listRules(), repo.listTracks()]);
    const title = new Map(tracks.map((t) => [t.id, t.title]));
    return { rules: rules.map((r) => ({ id: r.id, trackId: r.track_id, trackTitle: title.get(r.track_id) || "Trilha", kind: r.kind, audienceRoles: r.audience_roles, dueDays: r.due_days, everyDays: r.every_days, startsAt: r.starts_at, active: r.active })), tracks: tracks.map((t) => ({ id: t.id, title: t.title, status: t.status })) };
  }

  // Cria ou atualiza a regra (trilha + tipo). Regra NOVA nasce DESLIGADA (banco); ligar é decisão explícita (active: true).
  async function save(actor, { trackId, kind, audienceRoles, dueDays, everyDays, active }) {
    if (!["new_user", "recycle"].includes(kind)) throw new AcademyError("invalid_rule", 400);
    const roles = Array.isArray(audienceRoles) && audienceRoles.length && audienceRoles.every((r) => ROLES.includes(r)) ? [...new Set(audienceRoles)] : null;
    if (!roles) throw new AcademyError("invalid_rule", 400);
    const due = dueDays == null || dueDays === "" ? null : Number(dueDays);
    const every = everyDays == null || everyDays === "" ? null : Number(everyDays);
    if (due != null && (!Number.isInteger(due) || due < 1 || due > 730)) throw new AcademyError("invalid_rule", 400);
    if (kind === "recycle" && (!Number.isInteger(every) || every < 30 || every > 1825)) throw new AcademyError("invalid_rule", 400);
    const track = (await repo.listTracks()).find((t) => t.id === trackId);
    if (!track) throw new AcademyError("track_not_found", 404);
    const patch = { audience_roles: roles, due_days: due, every_days: kind === "recycle" ? every : null, updated_at: now() };
    if (typeof active === "boolean") patch.active = active;
    const existing = await repo.getRule({ trackId, kind });
    if (existing) { await repo.updateRule(existing.id, patch); return { id: existing.id, created: false }; }
    const row = await repo.insertRule({ track_id: trackId, kind, ...patch, active: Boolean(active), starts_at: now(), created_by: actor?.userId || null });
    return { id: row.id, created: true };
  }

  // Aplica as regras ATIVAS (dryRun só conta). `onlyUserId` = matrícula preguiçosa do próprio aluno ao abrir a Academia.
  async function apply(actor, { dryRun = false, onlyUserId = null } = {}) {
    const rules = (await repo.listRules()).filter((r) => r.active);
    const nowMs = Date.parse(now());
    const tracks = await repo.listTracks();
    const result = { planned: 0, created: 0, details: [] };
    if (!rules.length) return result;
    const users = (await repo.listUsers(onlyUserId ? [onlyUserId] : null));
    for (const rule of rules) {
      const track = tracks.find((t) => t.id === rule.track_id);
      if (!track || track.status !== "active") continue;
      const version = await repo.getPublishedVersion(rule.track_id);
      if (!version) continue;
      const enrollments = await repo.listEnrollmentsFor(onlyUserId ? [onlyUserId] : null, { trackId: rule.track_id });
      const plan = planRuleEnrollments(rule, users, enrollments, nowMs);
      result.planned += plan.length;
      for (const item of plan) {
        if (dryRun) { result.details.push({ userId: item.userId, trackId: rule.track_id, source: item.source }); continue; }
        try {
          const due = rule.due_days ? new Date(nowMs + rule.due_days * DAY).toISOString() : null;
          const e = await repo.insertEnrollment({ user_id: item.userId, track_id: rule.track_id, track_version_id: version.id, source: item.source, required: true, due_at: due, status: "assigned", assigned_by: actor?.userId || null });
          await repo.logEvent({ actor_user_id: actor?.userId || null, real_actor_email: actor?.email || null, user_id: item.userId, action: "enrollment_auto", ref: e.id, meta: { rule_id: rule.id, kind: rule.kind, track_id: rule.track_id } });
          result.created += 1;
          result.details.push({ userId: item.userId, trackId: rule.track_id, source: item.source });
        } catch (e) { if (!(e instanceof AcademyError && e.code === "already_enrolled")) throw e; }
      }
    }
    return result;
  }

  return { list, save, apply };
}

export function createAcademyRecommendations(repo, { now = () => new Date().toISOString() } = {}) {
  async function list(scope, { status } = {}) {
    const recs = await repo.listRecommendations(scope.admin ? null : scope.ids || [], status || null);
    const [users, tracks] = await Promise.all([repo.listUsers([...new Set(recs.map((r) => r.user_id))]), repo.listTracks()]);
    const name = new Map(users.map((u) => [u.id, u.name || u.email]));
    const title = new Map(tracks.map((t) => [t.id, t.title]));
    return { recommendations: recs.map((r) => ({ id: r.id, userId: r.user_id, userName: name.get(r.user_id) || "Pessoa", trackId: r.track_id, trackTitle: title.get(r.track_id) || "Trilha", source: r.source, reason: r.reason, status: r.status, createdBy: r.created_by_email, createdAt: r.created_at, decidedAt: r.decided_at, decidedBy: r.decided_by_email })) };
  }

  async function create(actor, scope, { userId, trackId, reason, source = "manual" }) {
    if (!inScope(scope, userId)) throw new AcademyError("out_of_scope", 403);
    if (!["manual", "atendimento_audit"].includes(source)) throw new AcademyError("invalid_recommendation", 400);
    const text = typeof reason === "string" ? reason.trim() : "";
    if (!text || text.length > 500) throw new AcademyError("invalid_recommendation", 400);
    const track = (await repo.listTracks()).find((t) => t.id === trackId);
    if (!track || track.status !== "active") throw new AcademyError("track_not_found", 404);
    const [user] = await repo.listUsers([userId]);
    if (!user || user.status === "inactive") throw new AcademyError("student_not_found", 404);
    const row = await repo.insertRecommendation({ user_id: userId, track_id: trackId, source, reason: text, created_by: actor.userId, created_by_email: actor.email || null });
    return { id: row.id };
  }

  async function load(scope, id, { open = true } = {}) {
    const rec = await repo.getRecommendation(id);
    if (!rec || !inScope(scope, rec.user_id)) throw new AcademyError("recommendation_not_found", 404);
    if (open && rec.status !== "open") throw new AcademyError("recommendation_closed", 409);
    return rec;
  }

  // Aceitar = matricular a pessoa na trilha (origem "recommendation"); se já estiver em andamento, só vincula a matrícula existente.
  async function accept(actor, scope, { recommendationId, dueAt = null }) {
    const rec = await load(scope, recommendationId);
    const version = await repo.getPublishedVersion(rec.track_id);
    if (!version) throw new AcademyError("track_not_published", 409);
    const due = dueAt ? new Date(dueAt) : null;
    if (due && Number.isNaN(due.getTime())) throw new AcademyError("invalid_due_date", 400);
    let enrollment;
    try {
      enrollment = await repo.insertEnrollment({ user_id: rec.user_id, track_id: rec.track_id, track_version_id: version.id, source: "recommendation", required: false, due_at: due ? due.toISOString() : null, status: "assigned", assigned_by: actor.userId });
      await repo.logEvent({ actor_user_id: actor.userId, real_actor_email: actor.email || null, user_id: rec.user_id, action: "enrollment_assigned", ref: enrollment.id, meta: { track_id: rec.track_id, recommendation_id: rec.id } });
    } catch (e) {
      if (!(e instanceof AcademyError && e.code === "already_enrolled")) throw e;
      enrollment = await repo.findLiveEnrollment(rec.user_id, rec.track_id);
    }
    await repo.updateRecommendation(rec.id, { status: "accepted", decided_by: actor.userId, decided_by_email: actor.email || null, decided_at: now(), enrollment_id: enrollment?.id || null });
    return { enrollmentId: enrollment?.id || null };
  }

  async function dismiss(actor, scope, { recommendationId }) {
    const rec = await load(scope, recommendationId);
    await repo.updateRecommendation(rec.id, { status: "dismissed", decided_by: actor.userId, decided_by_email: actor.email || null, decided_at: now() });
    return { ok: true };
  }

  return { list, create, accept, dismiss };
}
