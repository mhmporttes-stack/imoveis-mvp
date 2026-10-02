// Extração de mensagem do Baileys -> { from, text, waMessageId, at,
// contactName, fromMe }. Puro (sem importar o Baileys) para ser testado em
// tests/whatsapp-individual-extract.test.mjs.
//
// LID (2026-10-02): o WhatsApp passou a endereçar boa parte das conversas
// 1:1 por um identificador anônimo (`<número>@lid`) em vez do telefone
// (`<telefone>@s.whatsapp.net`). Antes desta correção toda mensagem `@lid`
// era descartada — na prática nenhuma resposta de cliente chegava mais ao CRM
// (0 mensagens recebidas no Chat de 29/09 a 02/10 com centenas de envios da
// Meta Diária). O telefone real vem no próprio evento: `key.senderPn` (quem
// enviou) nas mensagens RECEBIDAS. Nas mensagens que o corretor manda pelo
// app (fromMe), `senderPn` é o número dele mesmo — ali só vale o mapa
// LID -> telefone aprendido dos eventos (lidMap), nunca `senderPn`.

const PHONE_SUFFIX = "@s.whatsapp.net";
const LID_SUFFIX = "@lid";

// "5514999990000:12@s.whatsapp.net" -> "5514999990000"
export function phoneFromJid(jid) {
  const value = String(jid || "");
  if (!value.endsWith(PHONE_SUFFIX)) return "";
  return value.slice(0, -PHONE_SUFFIX.length).split(":")[0].replace(/\D/g, "");
}

export function isLidJid(jid) {
  return String(jid || "").endsWith(LID_SUFFIX);
}

// "123456789:3@lid" -> "123456789@lid" (mesma chave para o mapa)
export function normalizeLid(jid) {
  const value = String(jid || "");
  if (!isLidJid(value)) return "";
  return `${value.slice(0, -LID_SUFFIX.length).split(":")[0]}${LID_SUFFIX}`;
}

// Aprende LID -> telefone de uma mensagem recebida. Devolve [lid, phone] ou null.
export function lidMappingFromMessage(msg) {
  const key = msg?.key || {};
  if (key.fromMe) return null;
  const lid = normalizeLid(key.remoteJid);
  const phone = phoneFromJid(key.senderPn);
  return lid && phone ? [lid, phone] : null;
}

// Aprende LID -> telefone de um contato (contacts.upsert/update) ou do evento
// chats.phoneNumberShare ({ lid, jid }). Devolve [lid, phone] ou null.
export function lidMappingFromContact(contact) {
  if (!contact) return null;
  const lid = normalizeLid(contact.lid) || normalizeLid(contact.id);
  const phone = phoneFromJid(contact.jid) || phoneFromJid(contact.id);
  return lid && phone ? [lid, phone] : null;
}

// Telefone da conversa 1:1, ou "" se não der para saber com segurança.
export function resolveChatPhone(msg, lidMap = new Map()) {
  const key = msg?.key || {};
  const remoteJid = String(key.remoteJid || "");
  const direct = phoneFromJid(remoteJid);
  if (direct) return direct;
  if (!isLidJid(remoteJid)) return ""; // grupo, broadcast, newsletter...
  if (!key.fromMe) {
    const sender = phoneFromJid(key.senderPn);
    if (sender) return sender;
  }
  return lidMap.get(normalizeLid(remoteJid)) || "";
}

// Só conversa individual (1:1) e só texto (inclui legenda de foto/vídeo);
// grupo (@g.us), lista de transmissão (@broadcast) e newsletter nunca viram
// "cliente" no CRM — o JID deles não é um telefone e já causou lixo real
// (conversa fantasma a partir de mensagem de grupo).
export function extractTextMessage(msg, lidMap = new Map()) {
  const fromMe = Boolean(msg?.key?.fromMe);
  const from = resolveChatPhone(msg, lidMap);
  if (!from) return null;
  const text = msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || msg.message?.imageMessage?.caption
    || msg.message?.videoMessage?.caption
    || "";
  if (!text) return null;
  return {
    from,
    text,
    waMessageId: msg.key?.id || "",
    at: new Date(Number(msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    contactName: fromMe ? "" : (msg.pushName || ""),
    fromMe
  };
}

// ---------------------------------------------------------------------------
// Eventos completos do Chat (2026-10-02): além do texto, mídia (foto, vídeo,
// GIF, figurinha, áudio, documento), resposta citada, reação, edição e
// "apagar para todos" — tanto do cliente quanto o que o corretor faz pelo
// app do celular (fromMe). Puro: o download da mídia fica em sessions.js.
// ---------------------------------------------------------------------------

const WRAPPER_KEYS = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "documentWithCaptionMessage", "editedMessage"];

// Tira os "envelopes" (mensagem temporária, visualização única, documento
// com legenda, edição) — mesma ideia do normalizeMessageContent do Baileys.
export function unwrapContent(message) {
  let content = message || null;
  for (let i = 0; i < 5 && content; i += 1) {
    const wrapperKey = WRAPPER_KEYS.find((key) => content[key]?.message);
    if (!wrapperKey) break;
    content = content[wrapperKey].message;
  }
  return content;
}

const MEDIA_KEYS = {
  imageMessage: "image",
  videoMessage: "video",
  stickerMessage: "sticker",
  audioMessage: "audio",
  documentMessage: "document"
};

// Tipos de protocolo do WhatsApp (proto.Message.ProtocolMessage.Type).
export const PROTOCOL_REVOKE = 0;
export const PROTOCOL_MESSAGE_EDIT = 14;

function protocolType(value) {
  if (value === PROTOCOL_REVOKE || value === "REVOKE") return "revoke";
  if (value === PROTOCOL_MESSAGE_EDIT || value === "MESSAGE_EDIT") return "edit";
  return "";
}

export function textOfContent(content) {
  if (!content) return "";
  return content.conversation
    || content.extendedTextMessage?.text
    || content.imageMessage?.caption
    || content.videoMessage?.caption
    || content.documentMessage?.caption
    || "";
}

function contextInfoOf(content) {
  if (!content) return null;
  for (const value of Object.values(content)) {
    if (value && typeof value === "object" && value.contextInfo) return value.contextInfo;
  }
  return null;
}

function numberOrZero(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "object" && typeof value.toNumber === "function") return value.toNumber();
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// Dados da mídia (sem baixar): tipo para o CRM, MIME, nome, tamanho, GIF/voz.
export function mediaInfoOf(content) {
  if (!content) return null;
  const key = Object.keys(MEDIA_KEYS).find((name) => content[name]);
  if (!key) return null;
  const media = content[key];
  let kind = MEDIA_KEYS[key];
  if (kind === "video" && media.gifPlayback) kind = "gif";
  const fallbackMime = { image: "image/jpeg", video: "video/mp4", gif: "video/mp4", sticker: "image/webp", audio: "audio/ogg", document: "application/octet-stream" }[kind];
  return {
    kind,
    mime: String(media.mimetype || fallbackMime).split(";")[0].trim(),
    fileName: String(media.fileName || "").slice(0, 120),
    size: numberOrZero(media.fileLength),
    seconds: numberOrZero(media.seconds),
    ptt: Boolean(media.ptt),
    animated: Boolean(media.isAnimated)
  };
}

// msg do Baileys -> evento para o CRM, ou null (grupo, status, sem conteúdo).
// kind: 'message' | 'reaction' | 'edit' | 'revoke'.
export function extractChatEvent(msg, lidMap = new Map()) {
  const from = resolveChatPhone(msg, lidMap);
  if (!from) return null;
  const fromMe = Boolean(msg?.key?.fromMe);
  const base = {
    from,
    fromMe,
    waMessageId: msg?.key?.id || "",
    remoteJid: String(msg?.key?.remoteJid || ""),
    at: new Date(numberOrZero(msg?.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    contactName: fromMe ? "" : (msg?.pushName || "")
  };
  const content = unwrapContent(msg?.message);
  if (!content) return null;

  if (content.reactionMessage) {
    const targetId = content.reactionMessage.key?.id || "";
    if (!targetId) return null;
    return { ...base, kind: "reaction", targetId, emoji: String(content.reactionMessage.text || "") };
  }

  if (content.protocolMessage) {
    const type = protocolType(content.protocolMessage.type);
    const targetId = content.protocolMessage.key?.id || "";
    if (!type || !targetId) return null;
    if (type === "revoke") return { ...base, kind: "revoke", targetId };
    const newText = textOfContent(unwrapContent(content.protocolMessage.editedMessage));
    return newText ? { ...base, kind: "edit", targetId, newText } : null;
  }

  const media = mediaInfoOf(content);
  const text = textOfContent(content);
  if (!media && !text) return null;
  const quotedId = contextInfoOf(content)?.stanzaId || "";
  return { ...base, kind: "message", messageType: media ? media.kind : "text", text, media, quotedId };
}
