// WhatsApp RESTRINGIDO — regras PURAS, testadas em tests/whatsapp-restriction.test.mjs
// e tests/whatsapp-restriction-states.test.mjs. Banco/rotas em lib/whatsapp-restriction.js.
//
// Status OPERACIONAL: o corretor INFORMA; só admin geral / gestora da equipe
// VALIDAM (T-20 mostrou que não há evidência técnica confiável hoje). NÃO altera
// a elegibilidade: Prospecção, Meta Diária e disparos continuam exigindo sessão
// "connected" (lib/prospecting-eligibility-core.mjs não conhece este status).

export const RESTRICTION_END_MANUAL = "manual";
export const RESTRICTION_END_AUTOMATIC = "automatic_connected";

export const VALIDATION_INFORMED = "informed";
export const VALIDATION_VALIDATED = "validated";
export const VALIDATION_REJECTED = "rejected";

// Origem da validação. "evidencia_tecnica" existe no banco para o futuro, mas
// NENHUM código a aplica hoje (T-20: Baileys/Meta não dão sinal confiável).
export const ORIGIN_ADMIN = "admin";
export const ORIGIN_MANAGER = "gestora";
export const ORIGIN_TECHNICAL = "evidencia_tecnica";
// Motivo gravado no histórico quando a sessão volta a "connected" (encerramento automático).
export const AUTO_END_REASON = "automatico_conectado";

// Estados operacionais do WhatsApp no card do gestor/admin. Ícone + texto,
// nunca só cor. "waiting" (nunca conectou) é um caso do "Desconectado".
export const WHATSAPP_BADGES = {
  connected: { key: "connected", label: "Conectado", short: "Conectado", icon: "check", tone: "emerald" },
  disconnected: { key: "disconnected", label: "Desconectado", short: "Desconectado", icon: "unplug", tone: "red" },
  waiting: { key: "waiting", label: "Aguardando WhatsApp", short: "Aguardando WhatsApp", icon: "clock", tone: "amber" },
  informed: { key: "informed", label: "Restrição informada — aguardando validação", short: "Restrição informada", icon: "help", tone: "sky" },
  validated: { key: "validated", label: "Restrição validada", short: "Restrição validada", icon: "ban", tone: "navy" }
};
export const WHATSAPP_BADGE_LEGEND = "Conectado = operacional · Desconectado/Aguardando = sem sessão · Restrição informada = corretor avisou, aguardando validação · Restrição validada = confirmada por admin/gestora";

// Só o PRÓPRIO usuário informa/encerra o seu status (admin/gestor validam, não informam).
export function canChangeRestriction({ actorId, targetUserId } = {}) {
  return Boolean(actorId) && Boolean(targetUserId) && String(actorId) === String(targetUserId);
}

// Visualização segue o escopo de equipe existente (managedUserIds).
export function canViewRestriction({ viewerId, viewerRole = "", isGeneralAdmin = false, targetUserId, managedUserIds = [] } = {}) {
  if (!viewerId || !targetUserId) return false;
  if (String(viewerId) === String(targetUserId)) return true;
  if (isGeneralAdmin) return true;
  if (viewerRole === "manager") return (managedUserIds || []).map(String).includes(String(targetUserId));
  return false;
}

const isOpen = (restriction) => Boolean(restriction) && !restriction.ended_at;

// Marcar: exige confirmação explícita; não faz sentido se já está conectado;
// idempotente se já existe uma restrição aberta. Informar NUNCA valida.
// -> { action: "create" | "noop" | "reject", reason? }
export function decideReport({ confirmed = false, sessionStatus = null, openRestriction = null } = {}) {
  if (confirmed !== true) return { action: "reject", reason: "confirmation_required" };
  if (sessionStatus === "connected") return { action: "reject", reason: "already_connected" };
  if (isOpen(openRestriction)) return { action: "noop", reason: "already_restricted" };
  return { action: "create" };
}

// Resolver manualmente (corretor, PRO-13 regra do dono 2026-10-02): só enquanto a
// restrição está apenas INFORMADA. Depois de VALIDADA o corretor não encerra sozinho
// (recusa 403); só admin/gestora (decideAdminClose) ou a volta a "connected" (decideAutoEnd).
// -> { action: "close" | "noop" | "refuse", end_reason?, reason? }
export function decideResolve({ openRestriction = null } = {}) {
  if (!isOpen(openRestriction)) return { action: "noop", reason: "not_restricted" };
  if ((openRestriction.validation_status || VALIDATION_INFORMED) === VALIDATION_VALIDATED) return { action: "refuse", reason: "validated_requires_management" };
  return { action: "close", end_reason: RESTRICTION_END_MANUAL };
}

// Quem ENCERRA uma restrição VALIDADA (ação administrativa): admin geral (qualquer corretor);
// gestora só da equipe que ela gerencia (managedUserIds, nunca a si mesma); corretor/associado nunca.
// -> "admin" | "gestora" | null
export function closeOriginFor({ actorId, actorRole = "", isGeneralAdmin = false, targetUserId, managedUserIds = [] } = {}) {
  if (!actorId || !targetUserId) return null;
  if (isGeneralAdmin) return ORIGIN_ADMIN;
  if (String(actorId) === String(targetUserId)) return null;
  if (actorRole === "manager" && (managedUserIds || []).map(String).includes(String(targetUserId))) return ORIGIN_MANAGER;
  return null;
}

// -> { action: "close" | "noop" | "refuse", reason?, origin?, end_reason? }
export function decideAdminClose({ origin, openRestriction = null } = {}) {
  if (!origin) return { action: "refuse", reason: "forbidden" };
  if (!isOpen(openRestriction)) return { action: "noop", reason: "not_restricted" };
  if ((openRestriction.validation_status || VALIDATION_INFORMED) !== VALIDATION_VALIDATED) return { action: "refuse", reason: "not_validated" };
  return { action: "close", origin, end_reason: RESTRICTION_END_MANUAL };
}

// Encerramento automático ao voltar a "connected".
export function decideAutoEnd({ sessionStatus = null, openRestriction = null } = {}) {
  if (isOpen(openRestriction) && sessionStatus === "connected") return { action: "close", end_reason: RESTRICTION_END_AUTOMATIC };
  return { action: "noop" };
}

// Selo exibido. Restrição só vale enquanto a sessão NÃO está conectada.
export function resolveWhatsappBadge({ sessionStatus = null, openRestriction = null } = {}) {
  if (sessionStatus === "connected") return WHATSAPP_BADGES.connected;
  if (isOpen(openRestriction)) return openRestriction.validation_status === VALIDATION_VALIDATED ? WHATSAPP_BADGES.validated : WHATSAPP_BADGES.informed;
  if (!sessionStatus || sessionStatus === "nunca_conectou") return WHATSAPP_BADGES.waiting;
  if (sessionStatus === "disconnected" || sessionStatus === "error") return WHATSAPP_BADGES.disconnected;
  return WHATSAPP_BADGES.waiting;
}

// Quem VALIDA / NÃO VALIDA (ação administrativa): admin geral qualquer
// corretor; gestora só a própria equipe (managedUserIds); ninguém a si mesmo;
// corretor/associado nunca. -> "admin" | "gestora" | null
export function validationOriginFor({ actorId, actorRole = "", isGeneralAdmin = false, targetUserId, managedUserIds = [] } = {}) {
  if (!actorId || !targetUserId) return null;
  if (String(actorId) === String(targetUserId)) return null;
  if (isGeneralAdmin) return ORIGIN_ADMIN;
  if (actorRole === "manager" && (managedUserIds || []).map(String).includes(String(targetUserId))) return ORIGIN_MANAGER;
  return null;
}
export const canValidateRestriction = (input) => validationOriginFor(input) !== null;

// Decide a validação. verdict: "validate" | "reject" ("Não validar" encerra como rejeitada).
// -> { action: "validate" | "reject" | "noop" | "refuse", reason?, origin? }
export function decideValidation({ verdict, origin, openRestriction = null, sessionStatus = null } = {}) {
  if (!origin) return { action: "refuse", reason: "forbidden" };
  if (verdict !== "validate" && verdict !== "reject") return { action: "refuse", reason: "invalid_verdict" };
  if (!isOpen(openRestriction)) return { action: "refuse", reason: "not_restricted" };
  if (sessionStatus === "connected") return { action: "refuse", reason: "already_connected" };
  const current = openRestriction.validation_status || VALIDATION_INFORMED;
  if (verdict === "validate") return current === VALIDATION_VALIDATED ? { action: "noop", reason: "already_validated" } : { action: "validate", origin };
  if (current === VALIDATION_VALIDATED) return { action: "refuse", reason: "already_validated" };
  return { action: "reject", origin, end_reason: RESTRICTION_END_MANUAL };
}

// Código de desconexão (Baileys) a registrar — só REGISTRO, nunca decisão.
export function normalizeDisconnectCode(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 100 && n <= 999 ? n : null;
}
