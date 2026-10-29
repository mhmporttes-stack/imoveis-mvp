// "Conectado, mas sem receber" (2026-10-23, casos Gabriel Nº1 22/10 e ketlin Nº1 desde 20/10). Partes PURAS (sem Baileys,
// sem rede) — testes em tests/whatsapp-pipeline-guard.test.mjs. Quem usa: sessions.js.
//
// O que a telemetria mostrou: depois de um certo momento a sessão continua "aberta" (o CRM envia, recibos brutos chegam),
// mas NENHUM evento do Baileys sai mais (messages.upsert, messages.update): nem mensagem, nem "entregue/lida", nem falha de
// decifrar. No Baileys 6.7.24 toda mensagem/recibo/notificação recebida passa, uma de cada vez, pelo `processingMutex`
// do socket, e os eventos só são liberados quando a tarefa termina. Uma tarefa que nunca termina (ex.: download do
// WhatsApp sem prazo — o Baileys usa axios sem timeout para histórico e "app state") trava a fila inteira; a mensagem
// presa nunca é confirmada e o WhatsApp a reentrega a cada reconexão, travando o socket novo também.
// Três defesas aqui:
//   1. Confirmação (NACK 500) de mensagem que não decifrou — o 6.7.24 pede reenvio e nunca confirma; o WhatsApp derruba a
//      conexão 50 min depois (stream:error ack, quedas de ~50 min de todos os números, §1-G) e reentrega a mesma mensagem
//      em toda reconexão. O Baileys novo (7.x) confirma com `sendMessageAck(node, UnhandledError)` depois do pedido.
//   2. Vigia da fila (watchdog): a tarefa do `processingMutex` que passa de PIPELINE_STUCK_MS é tratada como presa —
//      registra o que estava sendo processado, confirma o nó preso (para não voltar na reconexão) e reinicia a sessão com
//      as MESMAS credenciais (sem QR), no máximo PIPELINE_RESTART_LIMIT vezes por hora.
//   3. Pedido ao celular do conteúdo de mensagem que não decifrou (placeholder resend), como o WhatsApp Web/whatsmeow.

export const NACK_UNHANDLED_ERROR = 500;
// Textos do Baileys 6.7.24 (Utils/decode-wa-message.js): nesses dois casos ele mesmo já confirma o nó.
export const MISSING_KEYS_ERROR_TEXT = "Key used already or never filled";
export const NO_MESSAGE_FOUND_ERROR_TEXT = "Message absent from node";
export const CIPHERTEXT_STUB = 2;
// Espera antes de confirmar a falha: o pedido de reenvio do Baileys sai depois de ~5 s (requestPlaceholderResend).
export const DECRYPT_NACK_DELAY_MS = 10_000;

export const PIPELINE_CHECK_INTERVAL_MS = 30_000;
export const PIPELINE_STUCK_MS = 5 * 60_000;
export const PIPELINE_RESTART_LIMIT = 3;
export const PIPELINE_RESTART_WINDOW_MS = 60 * 60_000;

export const PLACEHOLDER_DELAY_MS = 5_000;
export const PLACEHOLDER_BATCH_MAX = 10;
export const PLACEHOLDER_MAX_PER_HOUR = 120;
const PROTOCOL_PDO_REQUEST = 16; // proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE
export const PDO_TYPE_PLACEHOLDER_MESSAGE_RESEND = 4; // proto.Message.PeerDataOperationRequestType

const TRACKED_TAGS = new Set(["message", "receipt", "notification"]);

// <ack> de um nó recebido — mesmo formato do Baileys 7 (Utils/stanza-ack.js buildAckStanza): id, to = from do nó,
// class = tag, error, participant, recipient, type e `from` = nós para mensagens.
export function buildAckStanza(node, { errorCode = 0, meId = "" } = {}) {
  const tag = String(node?.tag || "");
  const attrs = node?.attrs || {};
  if (!tag || !attrs.id || !attrs.from) return null;
  const stanza = { tag: "ack", attrs: { id: String(attrs.id), to: String(attrs.from), class: tag } };
  if (errorCode) stanza.attrs.error = String(errorCode);
  if (attrs.participant) stanza.attrs.participant = String(attrs.participant);
  if (attrs.recipient) stanza.attrs.recipient = String(attrs.recipient);
  if (attrs.type) stanza.attrs.type = String(attrs.type);
  if (tag === "message" && meId) stanza.attrs.from = String(meId);
  return stanza;
}

function hasChild(node, tag) {
  return Array.isArray(node?.content) && node.content.some((item) => item && item.tag === tag);
}

// Só os atributos necessários para confirmar/descrever o nó (nunca o conteúdo cifrado).
export function snapshotNode(node) {
  const attrs = node?.attrs || {};
  const keep = {};
  for (const key of ["id", "from", "participant", "recipient", "type", "category", "offline"]) {
    if (attrs[key] !== undefined && attrs[key] !== null && attrs[key] !== "") keep[key] = String(attrs[key]);
  }
  const enc = Array.isArray(node?.content) ? node.content.find((item) => item && item.tag === "enc") : null;
  return { tag: String(node?.tag || ""), attrs: keep, unavailable: hasChild(node, "unavailable"), encType: enc?.attrs?.type ? String(enc.attrs.type) : "" };
}

// Nós de mensagem recebidos por id (para confirmar depois uma mensagem que não decifrou). Memória curta e limitada.
export function createNodeTracker({ max = 2000, ttlMs = 2 * 60 * 60_000, now = Date.now } = {}) {
  const items = new Map(); // id -> { node, at, acked }
  const prune = () => {
    const limit = now() - ttlMs;
    for (const [id, item] of items) {
      if (item.at >= limit && items.size <= max) break;
      items.delete(id);
    }
  };
  return {
    remember(node) {
      const snap = snapshotNode(node);
      if (snap.tag !== "message" || !snap.attrs.id) return;
      items.delete(snap.attrs.id);
      items.set(snap.attrs.id, { node: snap, at: now(), acked: false });
      prune();
    },
    get(id) { return items.get(String(id || ""))?.node || null; },
    isAcked(id) { return Boolean(items.get(String(id || ""))?.acked); },
    markAcked(id) { const item = items.get(String(id || "")); if (item) item.acked = true; }
  };
}

// Mensagem que não decifrou e que o Baileys 6.7.24 deixa sem confirmação? (missing keys e "sem conteúdo" com
// <unavailable> ele já confirma).
export function shouldNackFailedDecrypt(msg, node) {
  if (!msg || Number(msg.messageStubType) !== CIPHERTEXT_STUB) return false;
  if (!node || node.tag !== "message" || !node.attrs?.id) return false;
  const reason = String(msg.messageStubParameters?.[0] || "");
  if (reason === MISSING_KEYS_ERROR_TEXT) return false;
  if (reason === NO_MESSAGE_FOUND_ERROR_TEXT && node.unavailable) return false;
  return true;
}

// Vigia do processingMutex: cada tarefa ganha início/fim e, quando dá, o nó que a originou (capturado no mesmo instante
// em que o Baileys enfileira a tarefa). Substitui só o método `mutex` do MESMO objeto que o Baileys usa por dentro.
export function monitorMutex(mutexObject, { currentNode = () => null, now = Date.now } = {}) {
  if (!mutexObject || typeof mutexObject.mutex !== "function") return null;
  const original = mutexObject.mutex.bind(mutexObject);
  const running = new Set();
  mutexObject.mutex = (code) => {
    const record = { node: currentNode(), startedAt: 0 };
    return original(async () => {
      record.startedAt = now();
      running.add(record);
      try {
        return await code();
      } finally {
        running.delete(record);
      }
    });
  };
  return {
    // Tarefa em execução há mais tempo (no máximo uma, a fila é sequencial) ou null.
    oldestRunning() {
      let oldest = null;
      for (const record of running) if (!oldest || record.startedAt < oldest.startedAt) oldest = record;
      return oldest;
    }
  };
}

// Decide o que fazer com a tarefa em execução. restarts = instantes dos reinícios feitos por este vigia (esta sessão).
export function decidePipelineAction({ running = null, now = Date.now(), stuckMs = PIPELINE_STUCK_MS, restarts = [], limit = PIPELINE_RESTART_LIMIT, windowMs = PIPELINE_RESTART_WINDOW_MS } = {}) {
  if (!running?.startedAt || now - running.startedAt < stuckMs) return { stuck: false };
  const recent = (restarts || []).filter((at) => now - at < windowMs);
  const node = running.node && TRACKED_TAGS.has(running.node.tag) && running.node.attrs?.id && running.node.attrs?.from ? running.node : null;
  return { stuck: true, ackNode: node, restart: recent.length < limit, stuckMs: now - running.startedAt };
}

// Descrição curta (telemetria, sem telefone nem conteúdo) do nó preso: "message.text.pkmsg.off" etc.
export function describeNode(node) {
  if (!node) return "unknown";
  const parts = [node.tag, node.attrs?.type || node.attrs?.category || "", node.encType || "", node.attrs?.offline ? "off" : ""].filter(Boolean);
  return parts.join(".").replace(/[^a-z0-9_.]/gi, "").slice(0, 30) || "unknown";
}

// Chave de mensagem que vale pedir ao celular: conversa individual (não grupo/status/broadcast/newsletter).
// Nó "peer" (2026-10-24) fica fora: é protocolo do próprio celular (inclusive a RESPOSTA a este pedido), não conversa —
// pedir o reenvio dele só gerava outra mensagem "peer" (caso do dono: conversa com o próprio número, message-extract.js).
export function placeholderKeyFor(msg, node = null) {
  if (!msg || Number(msg.messageStubType) !== CIPHERTEXT_STUB) return null;
  if (node?.attrs?.category === "peer") return null;
  const remoteJid = String(msg.key?.remoteJid || "");
  const id = String(msg.key?.id || "");
  if (!remoteJid || !id) return null;
  if (/@(g\.us|broadcast|newsletter)$/i.test(remoteJid) || remoteJid === "status@broadcast") return null;
  return { remoteJid, fromMe: Boolean(msg.key?.fromMe), id };
}

// Pedido "reenvie o conteúdo destas mensagens" ao próprio celular (whatsmeow BuildUnavailableMessageRequest), no mesmo
// formato de envio do pedido de histórico (history-on-demand.js / sessions.js sendRawPeerRequest).
export function buildPlaceholderResendRequest(keys = []) {
  const list = (keys || []).filter((key) => key?.remoteJid && key?.id).slice(0, PLACEHOLDER_BATCH_MAX);
  if (!list.length) return null;
  return {
    message: {
      protocolMessage: {
        type: PROTOCOL_PDO_REQUEST,
        peerDataOperationRequestMessage: {
          peerDataOperationRequestType: PDO_TYPE_PLACEHOLDER_MESSAGE_RESEND,
          placeholderMessageResendRequest: list.map((key) => ({ messageKey: { remoteJid: key.remoteJid, fromMe: Boolean(key.fromMe), id: key.id } }))
        }
      }
    },
    stanzaAttrs: { type: "text", category: "peer", push_priority: "high_force", privacy_sensitive: "1" },
    metaNode: { tag: "meta", attrs: { appdata: "default" } }
  };
}

// Limite de pedidos ao celular por sessão (janela deslizante de 1 h).
export function createRateWindow({ limit = PLACEHOLDER_MAX_PER_HOUR, windowMs = 60 * 60_000, now = Date.now } = {}) {
  let stamps = [];
  return {
    take(count = 1) {
      const at = now();
      stamps = stamps.filter((stamp) => at - stamp < windowMs);
      const free = Math.max(0, limit - stamps.length);
      const granted = Math.min(free, count);
      for (let i = 0; i < granted; i += 1) stamps.push(at);
      return granted;
    }
  };
}
