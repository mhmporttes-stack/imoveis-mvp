// "Carregar mensagens anteriores do celular" (ON_DEMAND) — partes PURAS (sem Baileys, sem rede), testadas em
// tests/whatsapp-older-history.test.mjs. Quem usa: sessions.js (requestOlderHistory / onHistorySync / onMessagesUpsert).
//
// 2026-10-12 (o botão nunca funcionou; nenhum histórico ON_DEMAND chegou desde 11/10): comparando com o Baileys 6.7.24
// (`fetchMessageHistory` -> `sendPeerDataOperationMessage`) e com o whatsmeow (implementação de referência), o pedido
// saía diferente do que o WhatsApp espera:
//   1. `oldestMsgTimestampMs` ia em MILISSEGUNDOS. Apesar do nome, o celular espera SEGUNDOS (whatsmeow
//      BuildHistorySyncRequest: "Despite the field name saying MS, this is actually supposed to contain seconds";
//      relato público de sucesso no Baileys passa `messageTimestamp`, em segundos). Com ms o celular não acha a
//      mensagem de referência e não responde nada.
//   2. Faltavam `privacy_sensitive="1"` na mensagem e o nó `<meta appdata="default"/>` (whatsmeow
//      preparePeerMessageNode; o nó `meta` também entrou no Baileys mais novo; PR #2853 do Baileys).
// O pedido agora é montado aqui e enviado pelo `relayMessage` do próprio socket (mesma criptografia e mesmo destino do
// `fetchMessageHistory`), sem atualizar o Baileys.

export const HISTORY_SYNC_ON_DEMAND = 6; // proto.HistorySync.HistorySyncType.ON_DEMAND
export const PROTOCOL_HISTORY_SYNC_NOTIFICATION = 5; // proto.Message.ProtocolMessage.Type
export const PROTOCOL_PDO_RESPONSE = 17; // PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE
export const PROTOCOL_PDO_REQUEST = 16; // PEER_DATA_OPERATION_REQUEST_MESSAGE
export const PDO_TYPE_HISTORY_SYNC_ON_DEMAND = 3; // proto.Message.PeerDataOperationRequestType.HISTORY_SYNC_ON_DEMAND
export const ON_DEMAND_MAX_COUNT = 50;
// Vídeo no ON_DEMAND (pedido do dono, 2026-10-12): até 16 MB (mesmo teto da mídia ao vivo) e até 10 por resposta.
export const ON_DEMAND_MAX_VIDEOS = 10;
export const ON_DEMAND_MEDIA_KINDS = Object.freeze(["image", "audio", "video", "gif"]);

const REQUEST_TTL_MS = 30 * 60 * 1000;
const REQUEST_LIMIT = 300;

// Timestamp da mensagem de referência -> SEGUNDOS (aceita ms ou s).
export function toUnixSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e11 ? Math.floor(n / 1000) : Math.floor(n);
}

// Mensagem + atributos do pedido ON_DEMAND (o mesmo conteúdo do fetchMessageHistory do Baileys, com o horário em segundos).
export function buildOnDemandRequest({ chatJid, oldestId, oldestFromMe, oldestTimestamp, count }) {
  const id = String(oldestId || "").trim();
  const seconds = toUnixSeconds(oldestTimestamp);
  if (!chatJid || !id || !seconds) throw new Error("Mensagem de referência inválida.");
  const total = Math.min(Math.max(Number(count) || ON_DEMAND_MAX_COUNT, 1), ON_DEMAND_MAX_COUNT);
  return {
    count: total,
    message: {
      protocolMessage: {
        type: PROTOCOL_PDO_REQUEST,
        peerDataOperationRequestMessage: {
          peerDataOperationRequestType: PDO_TYPE_HISTORY_SYNC_ON_DEMAND,
          historySyncOnDemandRequest: {
            chatJid,
            oldestMsgId: id,
            oldestMsgFromMe: Boolean(oldestFromMe),
            oldestMsgTimestampMs: seconds,
            onDemandMsgCount: total
          }
        }
      }
    },
    relayOptions: {
      additionalAttributes: { category: "peer", push_priority: "high_force", privacy_sensitive: "1" },
      additionalNodes: [{ tag: "meta", attrs: { appdata: "default" } }]
    }
  };
}

// Mensagem de protocolo que interessa ao diagnóstico do ON_DEMAND (sem conteúdo): notificação de histórico ou resposta
// do celular a um pedido (PDO). null = não é nenhuma das duas.
export function classifyHistoryProtocol(msg) {
  const content = msg?.message || {};
  const protocol = content.protocolMessage
    || content.ephemeralMessage?.message?.protocolMessage
    || content.deviceSentMessage?.message?.protocolMessage
    || null;
  if (!protocol) return null;
  const type = Number(protocol.type);
  if (type === PROTOCOL_HISTORY_SYNC_NOTIFICATION && protocol.historySyncNotification) {
    const notification = protocol.historySyncNotification;
    return {
      kind: "notification",
      syncType: Number(notification.syncType ?? -1),
      sessionId: String(notification.peerDataRequestSessionId || ""),
      chunkOrder: Number(notification.chunkOrder ?? 0) || 0
    };
  }
  if (type === PROTOCOL_PDO_RESPONSE && protocol.peerDataOperationRequestResponseMessage) {
    const response = protocol.peerDataOperationRequestResponseMessage;
    const results = Array.isArray(response.peerDataOperationResult) ? response.peerDataOperationResult : [];
    const codes = results
      .map((result) => result?.fullHistorySyncOnDemandRequestResponse?.responseCode)
      .filter((code) => code !== undefined && code !== null)
      .map(Number);
    return {
      kind: "pdo_response",
      requestType: Number(response.peerDataOperationRequestType ?? -1),
      sessionId: String(response.stanzaId || ""),
      results: results.length,
      responseCode: codes.length ? codes[0] : null
    };
  }
  return null;
}

// Registro em memória dos pedidos ON_DEMAND deste processo (só o dono do lease atende o Chat). Nada de conteúdo:
// só contagens e a mensagem MAIS ANTIGA recebida (id/fromMe/horário/jid), que vira a referência da próxima rodada.
export function createOnDemandRegistry({ now = Date.now } = {}) {
  const requests = new Map(); // `${userId}|${requestId}` -> entry
  const keyOf = (userId, requestId) => `${userId}|${requestId}`;

  function prune() {
    const limit = now() - REQUEST_TTL_MS;
    for (const [key, entry] of requests) if (entry.sentAt < limit) requests.delete(key);
    while (requests.size > REQUEST_LIMIT) requests.delete(requests.keys().next().value);
  }

  return {
    start(userId, requestId, { to, chatJid, count }) {
      prune();
      const entry = {
        userId, requestId, to: String(to || ""), chatJid, count, sentAt: now(),
        ackStatus: null, pdoResponses: 0, pdoCode: null, notifications: 0, chunks: 0, processing: 0,
        received: 0, delivered: 0, videos: 0, lastChunkAt: null, oldest: null
      };
      requests.set(keyOf(userId, requestId), entry);
      return entry;
    },
    get(userId, requestId) {
      return requests.get(keyOf(userId, requestId)) || null;
    },
    // Resposta sem o id do pedido: o pedido mais recente ainda sem resposta desta sessão (um por vez na prática).
    match(userId, sessionId) {
      if (sessionId) {
        const direct = requests.get(keyOf(userId, sessionId));
        if (direct) return direct;
      }
      let latest = null;
      for (const entry of requests.values()) {
        if (entry.userId !== userId) continue;
        if (!latest || entry.sentAt > latest.sentAt) latest = entry;
      }
      return latest && now() - latest.sentAt < 5 * 60 * 1000 ? latest : null;
    },
    isPending(userId, requestId) {
      return requests.has(keyOf(userId, requestId));
    },
    // Uma parte da resposta começou a ser processada (fotos/vídeos podem levar um tempo para baixar).
    beginChunk(entry) {
      if (!entry) return;
      entry.processing += 1;
      entry.lastChunkAt = now();
    },
    // n mensagens desta parte já foram gravadas no CRM (a tela recarrega a conversa).
    addDelivered(entry, n) {
      if (!entry) return;
      entry.delivered += Number(n) || 0;
      entry.lastChunkAt = now();
    },
    // messages = itens brutos da resposta ON_DEMAND (fim do processamento desta parte).
    recordChunk(entry, { messages = [], videos = 0, timestampSecondsOf, chatJidOf }) {
      if (!entry) return;
      entry.processing = Math.max(0, entry.processing - 1);
      entry.chunks += 1;
      entry.received += messages.length;
      entry.videos += videos;
      entry.lastChunkAt = now();
      // Referência da próxima rodada: a mais antiga DESTA conversa (o celular pode mandar outra junto); se nenhuma tiver
      // o mesmo jid (conversa LID x telefone), a mais antiga de todas.
      const candidates = [];
      for (const msg of messages) {
        const id = String(msg?.key?.id || "");
        const seconds = Number(timestampSecondsOf(msg)) || 0;
        if (!id || !seconds) continue;
        candidates.push({ id, fromMe: Boolean(msg?.key?.fromMe), seconds, chatJid: chatJidOf(msg) || entry.chatJid });
      }
      const sameChat = candidates.filter((item) => item.chatJid === entry.chatJid);
      for (const item of sameChat.length ? sameChat : candidates) {
        if (!entry.oldest || item.seconds < entry.oldest.seconds) entry.oldest = item;
      }
    },
    // Estado para a tela (sem conteúdo, sem telefone).
    status(userId, requestId) {
      const entry = requests.get(keyOf(userId, requestId));
      if (!entry) return { state: "unknown" };
      const elapsedMs = now() - entry.sentAt;
      const quietMs = entry.lastChunkAt ? now() - entry.lastChunkAt : null;
      return {
        state: entry.processing ? "receiving" : entry.chunks ? "received" : entry.notifications || entry.pdoResponses ? "receiving" : "waiting",
        elapsedMs,
        quietMs,
        phoneAck: entry.ackStatus,
        pdoCode: entry.pdoCode,
        chunks: entry.chunks,
        received: entry.received,
        delivered: entry.delivered,
        videos: entry.videos,
        oldestAt: entry.oldest ? new Date(entry.oldest.seconds * 1000).toISOString() : null
      };
    }
  };
}
