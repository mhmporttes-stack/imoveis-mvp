// WhatsApp RESTRINGIDO (pedido do dono, 2026-10-03) — regras PURAS, testadas em
// tests/whatsapp-restriction.test.mjs. Banco/rotas em lib/whatsapp-restriction.js.
//
// É APENAS um status operacional informado pelo próprio corretor. NÃO altera a
// elegibilidade: Prospecção, Meta Diária e disparos continuam exigindo sessão
// "connected" (lib/prospecting-eligibility-core.mjs não conhece este status).

export const RESTRICTION_END_MANUAL = "manual";
export const RESTRICTION_END_AUTOMATIC = "automatic_connected";

// Selos do card do gestor/admin (ícone + texto, nunca só cor).
export const WHATSAPP_BADGES = {
  connected: { key: "connected", label: "Conectado", icon: "check", tone: "emerald" },
  restricted: { key: "restricted", label: "WhatsApp restringido", icon: "ban", tone: "navy" },
  waiting: { key: "waiting", label: "Aguardando WhatsApp", icon: "clock", tone: "amber" },
  disconnected: { key: "disconnected", label: "Desconectado", icon: "unplug", tone: "red" }
};
export const WHATSAPP_BADGE_LEGEND = "Aguardando = ainda não conectou · Restringido = corretor informou impedimento · Conectado = operacional";

// Só o PRÓPRIO usuário altera o seu status (admin/gestor apenas visualizam).
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
// idempotente se já existe uma restrição aberta.
// -> { action: "create" | "noop" | "reject", reason? }
export function decideReport({ confirmed = false, sessionStatus = null, openRestriction = null } = {}) {
  if (confirmed !== true) return { action: "reject", reason: "confirmation_required" };
  if (sessionStatus === "connected") return { action: "reject", reason: "already_connected" };
  if (isOpen(openRestriction)) return { action: "noop", reason: "already_restricted" };
  return { action: "create" };
}

// Resolver manualmente. -> { action: "close" | "noop", end_reason }
export function decideResolve({ openRestriction = null } = {}) {
  if (!isOpen(openRestriction)) return { action: "noop", reason: "not_restricted" };
  return { action: "close", end_reason: RESTRICTION_END_MANUAL };
}

// Encerramento automático ao voltar a "connected".
export function decideAutoEnd({ sessionStatus = null, openRestriction = null } = {}) {
  if (isOpen(openRestriction) && sessionStatus === "connected") return { action: "close", end_reason: RESTRICTION_END_AUTOMATIC };
  return { action: "noop" };
}

// Selo exibido. Restringido só vale enquanto a sessão NÃO está conectada.
export function resolveWhatsappBadge({ sessionStatus = null, openRestriction = null } = {}) {
  if (sessionStatus === "connected") return WHATSAPP_BADGES.connected;
  if (isOpen(openRestriction)) return WHATSAPP_BADGES.restricted;
  if (!sessionStatus || sessionStatus === "nunca_conectou") return WHATSAPP_BADGES.waiting;
  if (sessionStatus === "disconnected" || sessionStatus === "error") return WHATSAPP_BADGES.disconnected;
  return WHATSAPP_BADGES.waiting;
}
