// Regras puras das mensagens internas de supervisão (gestor/admin ↔
// corretor). Sem acesso a banco — testadas em
// tests/supervision-messages-core.test.mjs. Quem consulta/grava é
// lib/supervision-messages.js.

export const SUPERVISION_BODY_MAX = 2000;
export const SUPERVISION_ACK_BODY = "OK";
export const SUPERVISION_THREAD_PAGE = 30;

export const SUPERVISION_ACK_STATUS = {
  NONE: "none",
  PENDING: "pending",
  ACKNOWLEDGED: "acknowledged",
  REPLIED: "replied"
};

export class SupervisionMessageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "SupervisionMessageError";
    this.status = status;
  }
}

// Texto da mensagem: sem espaços nas pontas, quebras de linha preservadas
// (no máximo 2 seguidas), limite de caracteres.
export function normalizeSupervisionBody(value) {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) throw new SupervisionMessageError("Escreva a mensagem antes de enviar.");
  if (text.length > SUPERVISION_BODY_MAX) {
    throw new SupervisionMessageError(`A mensagem pode ter no máximo ${SUPERVISION_BODY_MAX} caracteres.`);
  }
  return text;
}

// Quem pode iniciar/ler a conversa de supervisão com `targetId`:
// administrador geral → qualquer usuário ativo; gestor → só a própria
// equipe (managedUserIds); corretor/associado → ninguém (por enquanto a
// conversa nasce do gestor; Corretor → Gestor fica para uma expansão
// futura). Nunca consigo mesmo.
export function canSuperviseUser(viewer = {}, targetId = "") {
  if (!targetId || !viewer.id || targetId === viewer.id) return false;
  if (viewer.isGeneralAdmin) return true;
  if (viewer.isManager) return (viewer.managedUserIds || []).includes(targetId);
  return false;
}

// Corretor respondendo uma mensagem pendente: "OK" (ack) ou texto (reply).
// Devolve o que gravar na resposta e o novo estado da original.
export function buildSupervisionResponse({ action, body } = {}) {
  if (action === "ack") {
    return { kind: "ack", body: SUPERVISION_ACK_BODY, ackStatus: SUPERVISION_ACK_STATUS.ACKNOWLEDGED };
  }
  if (action === "reply") {
    return { kind: "reply", body: normalizeSupervisionBody(body), ackStatus: SUPERVISION_ACK_STATUS.REPLIED };
  }
  throw new SupervisionMessageError("Resposta inválida.");
}

// Só o destinatário vê a mensagem pendente (regra do dono, 2026-10-02): defesa
// em profundidade sobre a consulta por recipient_id.
export function onlyRecipientRows(rows = [], userId = "") {
  if (!userId) return [];
  return rows.filter((row) => row && row.recipient_id === userId);
}

export function assertCanRespond(message, userId) {
  if (!message || message.recipient_id !== userId) {
    throw new SupervisionMessageError("Mensagem não encontrada.", 404);
  }
  if (message.ack_status !== SUPERVISION_ACK_STATUS.PENDING) {
    throw new SupervisionMessageError("Esta mensagem já foi respondida.", 409);
  }
}

// Estado exibido para quem ENVIOU (gestor): o mais avançado vence.
export function supervisionDeliveryState(row = {}) {
  if (row.ack_status === SUPERVISION_ACK_STATUS.ACKNOWLEDGED) return "acknowledged";
  if (row.ack_status === SUPERVISION_ACK_STATUS.REPLIED) return "replied";
  if (row.seen_at) return "seen";
  if (row.delivered_at) return "delivered";
  return "sent";
}

// Linha do banco → formato da API (nunca devolve sent_by_email).
export function toSupervisionMessage(row = {}, viewerId = "") {
  return {
    id: row.id,
    senderId: row.sender_id || "",
    recipientId: row.recipient_id,
    mine: Boolean(viewerId) && row.sender_id === viewerId,
    body: row.body,
    kind: row.kind,
    requiresAck: row.requires_ack === true,
    ackStatus: row.ack_status,
    inReplyTo: row.in_reply_to || "",
    state: supervisionDeliveryState(row),
    deliveredAt: row.delivered_at || null,
    seenAt: row.seen_at || null,
    respondedAt: row.responded_at || null,
    createdAt: row.created_at
  };
}
