// Reenvio de mensagem enviada pelo CRM quando um aparelho pede de novo (recibo `type="retry"`) — 2026-10-16.
// Sintoma: mensagem enviada pelo Chat/automação não aparecia no CELULAR do corretor. A cópia que vai para o celular
// (deviceSentMessage) às vezes não decifra lá; o celular pede reenvio e o Baileys 6.7.24 só reenvia se `getMessage`
// devolver a mensagem — sem `getMessage` (padrão: undefined) ele desiste. E, se o pedido chega pelo LID com
// `creds.me.lid` vazio, o Baileys nem reconhece o pedido como do próprio número (handleReceipt) e não reenvia.
// Este módulo é PURO (sem Baileys, sem rede): o cache das mensagens enviadas e a decisão de quem reenvia.
// Segurança: o cache vive SÓ em memória (nunca disco/banco), com limite por sessão e validade curta; a telemetria leva
// só o id em hash (message-diagnostics.js), nunca telefone, JID ou conteúdo.

export const SENT_CACHE_MAX_PER_SESSION = 300;
// 2026-10-19: era 30 min — o celular pede reenvio de novo quando volta a ficar online (caso real: 2 h depois).
export const SENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// 2026-10-19: o Baileys só termina o sendMessage depois de gravar as chaves do Signal no banco (commit da transação,
// DEPOIS de mandar a mensagem). O pedido de reenvio do celular chega nesse meio-tempo — o envio em andamento é esperado
// até este limite em vez de responder "fora do cache".
export const PENDING_SEND_WAIT_MS = 20 * 1000;
// Reenvios feitos POR NÓS (caminho manual do LID) por mensagem + aparelho que pediu. O do Baileys tem limite próprio.
export const MANUAL_RESEND_LIMIT = 2;

export const SEND_RETRY_REASON = Object.freeze({
  RECEIPT: "send_retry_rcpt",
  RESENT: "send_retry_resent",
  FAILED: "send_retry_failed",
  MISSING: "send_retry_missing",
  GAVE_UP: "send_retry_gaveup"
});

// Cache por sessão (id da sessão do microsserviço): id da mensagem -> conteúdo proto da mensagem (proto.IMessage).
export function createSentMessageCache({ maxPerSession = SENT_CACHE_MAX_PER_SESSION, ttlMs = SENT_CACHE_TTL_MS, now = Date.now } = {}) {
  const sessions = new Map(); // sessionId -> Map(id -> { message, at }) em ordem de inserção

  function prune(store, at) {
    for (const [id, item] of store) {
      if (at - item.at <= ttlMs) break; // ordem de inserção = ordem de tempo
      store.delete(id);
    }
    while (store.size > maxPerSession) store.delete(store.keys().next().value);
  }

  const pending = new Map(); // `${sessionId}|${id}` -> [resolve, ...] dos que esperam um envio em andamento
  const pendingKey = (sessionId, id) => `${sessionId}|${String(id || "")}`;
  function settle(sessionId, id, message) {
    const key = pendingKey(sessionId, id);
    const waiters = pending.get(key);
    if (!waiters) return;
    pending.delete(key);
    for (const resolve of waiters) resolve(message);
  }

  const api = {
    // Envio começando com este id (antes de mandar): pedidos de reenvio que chegarem antes do fim esperam por ele.
    begin(sessionId, id) {
      const key = String(id || "");
      if (!sessionId || !key) return false;
      if (!pending.has(pendingKey(sessionId, key))) pending.set(pendingKey(sessionId, key), []);
      return true;
    },
    // Envio falhou: quem esperava recebe undefined (nada a reenviar).
    abandon(sessionId, id) { settle(sessionId, id, undefined); },
    isPending(sessionId, id) { return pending.has(pendingKey(sessionId, id)); },
    // Conteúdo da mensagem: do cache, ou esperando o envio em andamento (até timeoutMs). undefined = nada a reenviar.
    async wait(sessionId, id, timeoutMs = PENDING_SEND_WAIT_MS) {
      const cached = api.get(sessionId, id);
      if (cached !== undefined) return cached;
      const waiters = pending.get(pendingKey(sessionId, id));
      if (!waiters) return undefined;
      return new Promise((resolve) => {
        let done = false;
        const finish = (value) => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
        const timer = setTimeout(() => finish(undefined), timeoutMs);
        waiters.push(finish);
      });
    },
    remember(sessionId, id, message) {
      const key = String(id || "");
      if (!sessionId || !key || !message) { if (sessionId && key) settle(sessionId, key, undefined); return false; }
      const at = now();
      let store = sessions.get(sessionId);
      if (!store) { store = new Map(); sessions.set(sessionId, store); }
      store.delete(key); // reinserido no fim (mais novo)
      store.set(key, { message, at });
      prune(store, at);
      settle(sessionId, key, message);
      return true;
    },
    get(sessionId, id) {
      const store = sessions.get(sessionId);
      if (!store) return undefined;
      const key = String(id || "");
      const item = store.get(key);
      if (!item) return undefined;
      if (now() - item.at > ttlMs) {
        store.delete(key);
        return undefined;
      }
      return item.message;
    },
    clear(sessionId) {
      sessions.delete(sessionId);
      for (const key of [...pending.keys()]) if (key.startsWith(`${sessionId}|`)) settle(sessionId, key.slice(String(sessionId).length + 1), undefined);
    },
    size(sessionId) {
      const store = sessions.get(sessionId);
      if (!store) return 0;
      prune(store, now());
      return store.size;
    }
  };
  return api;
}

// Parte "usuário" de um JID (`5514...:3@s.whatsapp.net` -> `5514...`), sem Baileys.
export function jidUser(jid) {
  const text = String(jid || "");
  const at = text.indexOf("@");
  if (at <= 0) return "";
  return text.slice(0, at).split(":")[0];
}
export function jidServer(jid) {
  const text = String(jid || "");
  const at = text.indexOf("@");
  return at < 0 ? "" : text.slice(at + 1);
}

// Decide o que fazer com um recibo `type="retry"` (nó bruto CB:receipt) de uma mensagem NOSSA comum.
// Espelha handleReceipt do Baileys 6.7.24 (messages-recv.js): ele reenvia sozinho quando o pedido é "fromMe"
// (`!recipient` = pedido do contato, ou pedido do próprio número reconhecido por me.id/me.lid). Só sobra para nós o
// pedido de um aparelho do próprio número que chega pelo LID com me.lid vazio.
// Devolve null (não é pedido de reenvio) ou { action, trigger, kind, attempt, target }:
//   action "baileys" = o Baileys reenvia (via getMessage); "manual" = reenviar à mão; "missing" = mensagem fora do
//   cache (não há o que reenviar); "ignore" = pedido que o Baileys recusa e que não é do próprio número.
export function decideSendRetry(node, { meId = "", meLid = "", cached = false } = {}) {
  const attrs = node?.attrs || {};
  if (attrs.type !== "retry" || !attrs.id || !attrs.from) return null;
  const retryChild = Array.isArray(node.content) ? node.content.find((item) => item && item.tag === "retry") : null;
  const count = Number(retryChild?.attrs?.count);
  const attempt = Number.isFinite(count) ? count : null;
  const asker = String(attrs.participant || attrs.from);
  const isLid = String(attrs.from).includes("lid");
  const trigger = isLid ? "from_lid" : "from_pn";
  const ownRef = jidUser(isLid ? meLid : meId);
  const baileysSeesOwn = Boolean(ownRef) && jidUser(asker) === ownRef;
  const isGroup = jidServer(attrs.from) === "g.us";
  // Mesmo cálculo do Baileys: `fromMe = !recipient || (retry && isNodeFromMe)`.
  const baileysResends = !attrs.recipient || baileysSeesOwn;
  // Pedido de um aparelho do PRÓPRIO número (recibo com `recipient` = a conversa) pelo LID sem me.lid conhecido.
  const ownDevice = Boolean(attrs.recipient) && !isGroup;
  const kind = !attrs.recipient ? "contact" : baileysSeesOwn ? "own_device" : ownDevice && isLid && !meLid ? "own_device_lid" : "unknown";
  const base = { trigger, kind, attempt, target: asker, recipient: String(attrs.recipient || "") };
  if (!cached) return { ...base, action: "missing" };
  // 2026-10-19: pedido do PRÓPRIO celular -> sempre reenvio à mão para o aparelho que pediu (sessão nova). O reenvio do
  // Baileys nesse caso (sendMessagesAgain sem participant = "manda de novo para todos") não força sessão nova com o
  // celular — reusa a sessão que o celular não decifrou — e o celular nunca mostrava a mensagem (caso real: 7 de 7
  // mensagens automáticas de um dia pedidas de novo, nenhuma apareceu). O Baileys continua reenviando também (inofensivo).
  if ((kind === "own_device" && !isGroup) || kind === "own_device_lid") return { ...base, action: "manual" };
  if (baileysResends) return { ...base, action: "baileys" };
  return { ...base, action: "ignore" };
}

// Atributo `mediatype` do <enc> (mesma tabela do Baileys, só os tipos que o CRM envia). null = texto.
export function mediaTypeOf(message) {
  const m = message || {};
  if (m.imageMessage) return "image";
  if (m.videoMessage) return m.videoMessage.gifPlayback ? "gif" : "video";
  if (m.audioMessage) return m.audioMessage.ptt ? "ptt" : "audio";
  if (m.documentMessage || m.documentWithCaptionMessage) return "document";
  if (m.stickerMessage) return "sticker";
  return null;
}
