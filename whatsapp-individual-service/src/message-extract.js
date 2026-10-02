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
