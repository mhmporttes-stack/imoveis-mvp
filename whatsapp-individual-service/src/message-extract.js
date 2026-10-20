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
const GROUP_SUFFIX = "@g.us";
const LID_SUFFIX = "@lid";

// "5514999990000:12@s.whatsapp.net" -> "5514999990000"
export function phoneFromJid(jid) {
  const value = String(jid || "");
  if (!value.endsWith(PHONE_SUFFIX)) return "";
  return value.slice(0, -PHONE_SUFFIX.length).split(":")[0].replace(/\D/g, "");
}

// Grupo (2026-10-11, pedido do dono: aba "Grupos" só para ele): "120363012345678901@g.us" -> "group:120363012345678901".
// Vai num evento SEPARADO (type "group_message") — nunca no type "message", que cria/atualiza cliente e Prospecção.
export function groupKeyFromJid(jid) {
  const value = String(jid || "");
  if (!value.endsWith(GROUP_SUFFIX)) return "";
  const id = value.slice(0, -GROUP_SUFFIX.length).replace(/[^\d-]/g, "");
  return id.length >= 5 ? `group:${id}` : "";
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
    at: new Date((messageTimestampSeconds(msg) || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
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
  // Inteiro 64 bits do protobuf SEM a biblioteca "long" (Baileys em ESM): objeto { low, high, unsigned }.
  // Number(objeto) = NaN — o histórico inteiro era tratado como "antigo" e descartado (2026-10-11).
  if (typeof value === "object" && Number.isFinite(Number(value.low))) {
    return Number(value.high || 0) * 4294967296 + (Number(value.low) >>> 0);
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// Segundos (Unix) do messageTimestamp em qualquer formato que o Baileys entrega; 0 se não der para ler.
export function messageTimestampSeconds(msg) {
  const seconds = numberOrZero(msg?.messageTimestamp);
  return seconds > 0 ? seconds : 0;
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
  const groupKey = groupKeyFromJid(msg?.key?.remoteJid);
  const from = groupKey || resolveChatPhone(msg, lidMap);
  if (!from) return null;
  const fromMe = Boolean(msg?.key?.fromMe);
  const base = {
    from,
    fromMe,
    waMessageId: msg?.key?.id || "",
    remoteJid: String(msg?.key?.remoteJid || ""),
    at: new Date((messageTimestampSeconds(msg) || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    contactName: fromMe || groupKey ? "" : (msg?.pushName || "")
  };
  if (groupKey) {
    // Quem escreveu no grupo: nome do WhatsApp e, quando o WhatsApp informar, o telefone.
    base.group = true;
    base.senderName = fromMe ? "" : String(msg?.pushName || "").slice(0, 80);
    base.senderPhone = fromMe ? "" : (phoneFromJid(msg?.key?.participantPn) || phoneFromJid(msg?.key?.participant));
  }
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
  const quotedText = quotedId ? quotedPreviewOf(contextInfoOf(content)) : "";
  return { ...base, kind: "message", messageType: media ? media.kind : "text", text, media, quotedId, ...(quotedText ? { quotedText } : {}) };
}

// ---------------------------------------------------------------------------
// Destino de um "messages.upsert" do Baileys (2026-10-09). Antes só o tipo
// "notify" era tratado e o "append" era descartado — mas é como "append" que
// chegam as mensagens recebidas/enviadas pelo celular enquanto a sessão estava
// caída (reconexões "Stream Errored"/"Connection Terminated" acontecem várias
// vezes por dia), então elas sumiam do Chat. Agora:
//  - notify → tempo real (como sempre);
//  - append recente (até 6 h) → tempo real (o CRM deduplica por wa_message_id);
//    do próprio corretor só depois de 60 s — o envio feito PELO CRM também volta
//    como "append" na hora e é gravado pelo próprio CRM;
//  - append mais antigo (até 7 dias) → histórico (só popula a conversa, sem criar
//    cliente nem disparar automação);
//  - resto → ignora.
export const APPEND_LIVE_WINDOW_MS = 6 * 60 * 60 * 1000;
export const APPEND_OWN_SEND_GRACE_MS = 60 * 1000;
export const APPEND_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function upsertRoute({ type, fromMe = false, timestampMs = 0, now = Date.now() } = {}) {
  if (type === "notify") return "live";
  if (type !== "append") return "skip";
  const age = timestampMs > 0 ? now - timestampMs : 0;
  if (fromMe && age < APPEND_OWN_SEND_GRACE_MS) return "skip";
  if (age <= APPEND_LIVE_WINDOW_MS) return "live";
  if (age <= APPEND_HISTORY_WINDOW_MS) return "history";
  return "skip";
}

// Trecho da mensagem CITADA (o WhatsApp manda o conteúdo da original junto com a resposta): serve de fallback quando a
// original não está guardada no CRM (anterior ao pareamento/histórico). Texto até 160 caracteres ou o rótulo da mídia.
const QUOTED_MEDIA_LABEL = { image: "Foto", video: "Vídeo", gif: "GIF", sticker: "Figurinha", audio: "Áudio", document: "Documento" };
export function quotedPreviewOf(contextInfo) {
  try {
    const quoted = contextInfo?.quotedMessage;
    if (!quoted || typeof quoted !== "object") return "";
    const inner = unwrapContent(quoted) || quoted;
    const text = String(textOfContent(inner) || "").replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 160);
    const media = mediaInfoOf(inner);
    return media ? QUOTED_MEDIA_LABEL[media.kind] || "" : "";
  } catch {
    return "";
  }
}

// Saída do corretor que a sessão do CRM NÃO conseguiu decifrar (dono, 2026-10-19): Baileys entrega um stub
// (messageStubType CIPHERTEXT = 2, sem conteúdo). É prova de envio pelo celular/WhatsApp Web -> evento
// `undecrypted_message` ao CRM (contato humano; lib/whatsapp-undecrypted-core.mjs). Sem texto. Só 1:1 e só fromMe:
// grupo, broadcast, status e mensagem do contato nunca. Se a mesma mensagem chegar decifrada depois, o CRM completa
// a linha pelo waMessageId (não duplica).
export const UNDECRYPTED_STUB_TYPE = 2;
export function extractUndecryptedOwnEvent(msg, lidMap = new Map()) {
  if (!msg || Number(msg.messageStubType) !== UNDECRYPTED_STUB_TYPE) return null;
  if (msg.key?.fromMe !== true) return null;
  const waMessageId = String(msg.key?.id || "");
  if (!waMessageId) return null;
  const remoteJid = String(msg.key?.remoteJid || "");
  if (groupKeyFromJid(remoteJid) || /@(g\.us|broadcast|newsletter)$/i.test(remoteJid)) return null;
  const from = resolveChatPhone(msg, lidMap);
  if (!from) return null;
  return {
    from,
    fromMe: true,
    waMessageId,
    remoteJid,
    at: new Date((messageTimestampSeconds(msg) || Math.floor(Date.now() / 1000)) * 1000).toISOString()
  };
}
