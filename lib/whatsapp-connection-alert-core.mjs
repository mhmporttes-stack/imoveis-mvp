// Alerta de CONEXÃO do WhatsApp do corretor para a GESTORA responsável (REGRA OFICIAL — dono, 2026-10-02).
// Regras PURAS (testes: tests/whatsapp-connection-alert.test.mjs). Servidor: lib/whatsapp-connection-alert.js.
// Ponto de detecção: applyIndividualSessionStatus (toda mudança de status do microsserviço passa por ele),
// comparando a linha ANTERIOR da sessão com o status novo. Entrega: Central de Alertas, informativo, só a
// gestora (destinatário explícito) — nunca equipe/hierarquia, nunca o corretor, nunca o admin.

export const WHATSAPP_CONNECTION_ALERT_KEY = "whatsapp_connection";
export const CONNECTION_ACTION = Object.freeze({ DISCONNECTED: "disconnected", RECONNECTED: "reconnected" });

// Sem alerta novo se este corretor já teve um alerta de desconexão nesta janela (flapping).
export const DISCONNECT_COOLDOWN_MS = 10 * 60 * 1000;
// Conexão "velha": reconnecting por mais de 24 h antes de virar desconectado não é uma queda recente.
export const MAX_CONNECTION_AGE_MS = 24 * 60 * 60 * 1000;

// Estados em que o WhatsApp ainda estava (ou tentava voltar a estar) no ar antes de virar "disconnected".
// "reconnecting" é tentativa automática do próprio sistema: NUNCA gera alerta sozinho, mas se termina em
// "disconnected" a queda é real e conta como a do episódio.
const WAS_UP = new Set(["connected", "reconnecting"]);

const iso = (value) => {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : "";
};

// Episódio = a conexão que caiu, identificada pelo last_connected_at da linha ANTERIOR. Mesma conexão =
// mesma chave: oscilar (reconnecting/disconnected/qr) dentro do mesmo episódio nunca duplica.
export const disconnectDedupeKey = (userId, episode) => `wa_disc:${userId}:${iso(episode)}`;
export const reconnectDedupeKey = (userId, episode) => `wa_reconn:${userId}:${iso(episode)}`;

// prev: { status, last_connected_at } da linha ANTES da gravação (null = sessão nova); nextStatus: status gravado.
// recentDisconnectAt: último alerta de desconexão já emitido para este corretor (ISO) ou null.
// disconnectEmitted: já existe entrega de desconexão do episódio anterior (libera o "reconectado").
// -> { action, dedupeKey, episode } | null
export function decideConnectionAlert({ userId, prev = null, nextStatus = "", now = Date.now(), recentDisconnectAt = null, disconnectEmitted = false } = {}) {
  if (!userId || !nextStatus || !prev) return null;
  const prevStatus = prev.status || "";
  const episode = iso(prev.last_connected_at);
  if (!episode) return null; // nunca esteve conectado: não há "queda"

  if (nextStatus === "disconnected") {
    if (!WAS_UP.has(prevStatus)) return null; // já estava desconectado/QR/etc.: sem mudança real
    if (prevStatus !== "connected" && now - new Date(episode).getTime() > MAX_CONNECTION_AGE_MS) return null;
    if (recentDisconnectAt && now - new Date(recentDisconnectAt).getTime() < DISCONNECT_COOLDOWN_MS) return null;
    return { action: CONNECTION_ACTION.DISCONNECTED, dedupeKey: disconnectDedupeKey(userId, episode), episode };
  }

  if (nextStatus === "connected") {
    if (prevStatus === "connected") return null; // sem mudança
    if (!disconnectEmitted) return null; // reconexão automática silenciosa: a gestora nunca soube da queda
    return { action: CONNECTION_ACTION.RECONNECTED, dedupeKey: reconnectDedupeKey(userId, episode), episode };
  }
  return null; // reconnecting, connecting, qr_required, pairing_code_required... não geram alerta
}

// Gestora responsável: manager_id do corretor; associado -> gestora do corretor ao qual está vinculado.
// Só gestora ATIVA com perfil manager. Sem gestora -> null (ninguém é alertado).
export function resolveResponsibleManager(users = [], userId = "") {
  const byId = new Map(users.map((user) => [user.id, user]));
  const user = byId.get(userId);
  if (!user) return null;
  let managerId = user.manager_id || null;
  if (!managerId && user.linked_broker_id) managerId = byId.get(user.linked_broker_id)?.manager_id || null;
  const manager = managerId ? byId.get(managerId) : null;
  if (!manager || manager.role !== "manager" || manager.status === "inactive" || manager.disabled_at) return null;
  if (manager.id === userId) return null;
  return manager.id;
}

const DEFAULT_TEXTS = {
  [CONNECTION_ACTION.DISCONNECTED]: { title: "WhatsApp desconectado", body: "O WhatsApp de {corretor} foi desconectado." },
  [CONNECTION_ACTION.RECONNECTED]: { title: "WhatsApp reconectado", body: "O WhatsApp de {corretor} foi conectado novamente." }
};

// Textos vêm da definição (editável na Central); sem texto próprio usa o padrão. {corretor} = nome do corretor.
export function buildConnectionDelivery({ definition, action, managerId, brokerId, brokerName, dedupeKey }) {
  if (!definition?.enabled || !managerId || !brokerId || !dedupeKey || !DEFAULT_TEXTS[action]) return null;
  const custom = definition.trigger || {};
  const fallback = DEFAULT_TEXTS[action];
  const reconnected = action === CONNECTION_ACTION.RECONNECTED;
  const title = reconnected ? (custom.reconnected_title || fallback.title) : (definition.title || fallback.title);
  const template = reconnected ? (custom.reconnected_body_template || fallback.body) : (definition.body_template || fallback.body);
  const name = String(brokerName || "").trim() || "um corretor";
  return {
    definition_id: definition.id || null,
    recipient_id: managerId,
    kind: "informative",
    title,
    body: template.replace(/\{corretor\}/g, name),
    context: { source: "whatsapp_connection", action, broker_id: brokerId, link: "/admin/meta-diaria" },
    dedupe_key: dedupeKey
  };
}
