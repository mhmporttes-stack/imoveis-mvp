import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { useSupabaseAuthState } from "./auth-state.js";
import { clearSessionCreds } from "./db.js";
import { notifyHistoryBatch, notifyMessage, notifyMessageStatus, notifyStatus } from "./webhook.js";

// Liga/desliga a sincronização de histórico (ver onHistorySync) sem precisar
// mudar código — o lote de histórico grande estava travando o webhook do CRM
// (504) e piorando a corrupção de sessão (Bad MAC) quando várias sessões
// sincronizavam ao mesmo tempo. PAUSADO por padrão; ativar setando
// WHATSAPP_HISTORY_SYNC_ENABLED=true na Railway (não precisa novo deploy).
const HISTORY_SYNC_ENABLED = process.env.WHATSAPP_HISTORY_SYNC_ENABLED === "true";

// Um processo = no máximo UM socket Baileys por userId — nunca dois
// listeners pro mesmo corretor. `sockets` é a fonte da verdade EM MEMÓRIA
// deste processo; o banco (whatsapp_individual_sessions) é a fonte da
// verdade entre restarts/entre processos.
const sockets = new Map(); // userId -> { sock, status, qr, connecting: Promise|null }
const RECONNECT_DELAY_MS = 4000;
const QR_TTL_MS = 60_000;
const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || "silent" });

function entryFor(userId) {
  let entry = sockets.get(userId);
  if (!entry) {
    entry = { sock: null, status: "disconnected", qr: null, pairingCode: null, connecting: null };
    sockets.set(userId, entry);
  }
  return entry;
}

// connect(): idempotente — se já existe socket vivo (ou uma conexão em
// andamento) para este userId, devolve o estado atual em vez de abrir outro.
// phoneNumber (opcional, pedido do dono 2026-09-30): pareamento por código
// numérico em vez de QR — o corretor digita o número, recebe um código de 8
// caracteres e digita em WhatsApp > Aparelhos conectados > Conectar com
// número de telefone. Só faz sentido numa sessão nova (sem QR/código já
// pendente); se já tiver uma conexão em andamento, ignora o número e devolve
// o estado atual (mesma idempotência de sempre).
export async function connectSession(userId, { phoneNumber } = {}) {
  const entry = entryFor(userId);
  if (entry.sock && (entry.status === "connected" || entry.status === "qr_required" || entry.status === "pairing_code_required" || entry.status === "connecting")) {
    return { status: entry.status, qr: entry.qr, pairingCode: entry.pairingCode };
  }
  if (entry.connecting) return entry.connecting;

  entry.connecting = startSocket(userId, entry, { phoneNumber }).finally(() => { entry.connecting = null; });
  return entry.connecting;
}

async function startSocket(userId, entry, { phoneNumber } = {}) {
  entry.status = "connecting";
  entry.qr = null;
  entry.pairingCode = null;

  const { state, saveCreds } = await useSupabaseAuthState(userId);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    logger,
    // Pareamento por código já manda o próprio Baileys mostrar o QR no
    // terminal se isso ficar true — mantido false nos dois modos, o QR vira
    // imagem (onConnectionUpdate) e o código vem de requestPairingCode.
    printQRInTerminal: false,
    // Traz o histórico de conversas do celular ao conectar, igual o WhatsApp
    // Web (pedido explícito do dono, ciente de que isso inclui conversas
    // pessoais do corretor — ver onHistorySync). PAUSADO por ora — ver
    // HISTORY_SYNC_ENABLED acima.
    syncFullHistory: HISTORY_SYNC_ENABLED,
    browser: ["CRM Imoveis", "Chrome", "1.0"]
  });
  entry.sock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => onConnectionUpdate(userId, entry, update));
  sock.ev.on("messages.upsert", ({ messages, type }) => onMessagesUpsert(userId, messages, type));
  sock.ev.on("messages.update", (updates) => onMessagesUpdate(userId, updates));
  if (HISTORY_SYNC_ENABLED) {
    sock.ev.on("messaging-history.set", ({ messages }) => onHistorySync(userId, messages));
  }

  // Pareamento por número de telefone (pedido do dono, 2026-09-30) — só pede
  // o código se a sessão ainda não estiver registrada (credenciais novas);
  // uma sessão que já foi pareada antes (reconexão) nunca precisa disso.
  // requestPairingCode() precisa vir ANTES do QR normal ser consumido —
  // onConnectionUpdate ignora um evento de QR que chegue depois (guarda
  // entry.pairingCode) pra não sobrescrever o código pelo QR à toa.
  if (phoneNumber && !state.creds.registered) {
    try {
      const digits = String(phoneNumber).replace(/\D/g, "");
      const code = await sock.requestPairingCode(digits);
      entry.pairingCode = code;
      entry.status = "pairing_code_required";
      await notifyStatus(userId, { status: "pairing_code_required", pairingCode: code });
    } catch (error) {
      console.error(`[${userId}] Falha ao pedir código de pareamento:`, error.message);
    }
  }

  // Resolve a chamada HTTP assim que soubermos "precisa de QR/código" ou "já
  // conectou" (creds válidos reaproveitados) — sem travar a resposta do
  // POST /connect esperando o ciclo de vida inteiro da conexão. Um timeout
  // de segurança evita a chamada ficar pendurada; a tela já faz polling do
  // status separadamente.
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ status: entry.status, qr: entry.qr, pairingCode: entry.pairingCode });
    };
    if (entry.pairingCode) { finish(); return; }
    const onUpdate = (update) => {
      if (update.qr || update.connection === "open" || update.connection === "close") finish();
    };
    sock.ev.on("connection.update", onUpdate);
    setTimeout(finish, 10_000);
  });
}

async function onConnectionUpdate(userId, entry, update) {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    // Sessão em modo pareamento por código já tem o código gerado — um QR
    // que chegue depois (Baileys às vezes ainda emite, mesmo pedindo o
    // código antes) é ignorado, nunca substitui o código na tela.
    if (entry.pairingCode) return;
    try {
      const qrDataUrl = await QRCode.toDataURL(qr);
      entry.status = "qr_required";
      entry.qr = qrDataUrl;
      await notifyStatus(userId, { status: "qr_required", qr: qrDataUrl });
    } catch (error) {
      console.error(`[${userId}] Falha ao gerar o QR:`, error.message);
    }
    return;
  }

  if (connection === "open") {
    entry.status = "connected";
    entry.qr = null;
    entry.pairingCode = null;
    const phoneNumber = String(entry.sock?.user?.id || "").split(":")[0] || "";
    await notifyStatus(userId, { status: "connected", phoneNumber, qr: null });
    return;
  }

  if (connection === "close") {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const loggedOut = statusCode === DisconnectReason.loggedOut;
    entry.sock = null;

    if (loggedOut) {
      // Corretor desconectou pelo próprio celular (WhatsApp > Aparelhos
      // conectados): credenciais não servem mais — precisa de QR/código novo.
      entry.status = "disconnected";
      entry.qr = null;
      entry.pairingCode = null;
      await clearSessionCreds(userId);
      await notifyStatus(userId, { status: "disconnected", phoneNumber: null, qr: null, error: "logged_out" });
      return;
    }

    // Queda transitória (rede, restart do processo, etc.): reconecta sozinho
    // usando os MESMOS creds já persistidos — nunca gera QR à toa.
    entry.status = "reconnecting";
    const errorMessage = String(lastDisconnect?.error?.message || "").slice(0, 300);
    await notifyStatus(userId, { status: "reconnecting", error: errorMessage });
    setTimeout(() => {
      connectSession(userId).catch((error) => console.error(`[${userId}] Falha ao reconectar automaticamente:`, error.message));
    }, RECONNECT_DELAY_MS);
  }
}

// Extrai { from, text, waMessageId, at, contactName, fromMe } de uma
// mensagem crua do Baileys, ou null se deve ser ignorada — usado tanto para
// mensagem em tempo real (onMessagesUpsert) quanto para o histórico
// sincronizado ao conectar (onHistorySync). Só conversa individual (1:1) e
// só texto nesta primeira versão (mídia fica para uma etapa futura); grupo
// (@g.us), lista de transmissão (@broadcast) e LID (@lid) nunca viram
// "cliente" no CRM — o JID deles não é um telefone e já causou lixo real
// (conversa fantasma a partir de mensagem de grupo).
function extractTextMessage(msg) {
  const fromMe = Boolean(msg.key?.fromMe);
  const remoteJid = String(msg.key?.remoteJid || "");
  if (!remoteJid.endsWith("@s.whatsapp.net")) return null;
  const text = msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || msg.message?.imageMessage?.caption
    || msg.message?.videoMessage?.caption
    || "";
  if (!text) return null;
  const from = remoteJid.split("@")[0];
  if (!from) return null;
  return {
    from,
    text,
    waMessageId: msg.key?.id || "",
    at: new Date(Number(msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    contactName: fromMe ? "" : (msg.pushName || ""),
    fromMe
  };
}

async function onMessagesUpsert(userId, messages, type) {
  if (type !== "notify") return;
  for (const msg of messages || []) {
    try {
      const item = extractTextMessage(msg);
      if (!item) continue;
      await notifyMessage(userId, item);
    } catch (error) {
      // Nunca perde a próxima mensagem por causa de uma falha em notificar
      // esta — o log fica pra investigação manual.
      console.error(`[${userId}] Falha ao processar mensagem recebida:`, error.message);
    }
  }
}

// Confirmação de entrega/leitura (as "setinhas" do WhatsApp) das mensagens
// que ESTE corretor mandou — Baileys avisa aqui quando o status muda.
// status: 2=SERVER_ACK (só confirma envio, já tratado no /send), 3=DELIVERY_ACK
// (entregue — duas setinhas cinza), 4=READ, 5=PLAYED (lida — duas setinhas
// azuis). Só repassa entregue/lida; envio já é registrado na hora do /send.
// Baileys: 0=ERROR, 1=PENDING, 2=SERVER_ACK (chegou no servidor do WhatsApp
// — 1 tique cinza), 3=DELIVERY_ACK (chegou no aparelho do destinatário — 2
// tiques), 4/5=READ/PLAYED. SERVER_ACK (2) também é repassado agora — é a
// confirmação mais rápida e mais confiável de que a mensagem realmente saiu
// pela conexão (não depende do destinatário estar online, ao contrário de
// DELIVERY_ACK) — usada pela automação da Meta Diária pra distinguir
// "tentamos enviar" de "realmente saiu" (achado real, 2026-09-30: mensagem
// marcada "enviada" que nunca chegou nem no servidor do WhatsApp).
function statusLabelFor(statusCode) {
  if (statusCode === 2) return "server_ack";
  if (statusCode === 3) return "delivered";
  if (statusCode === 4 || statusCode === 5) return "read";
  return null;
}

async function onMessagesUpdate(userId, updates) {
  for (const { key, update } of updates || []) {
    try {
      if (!key?.fromMe || !key?.id) continue;
      const label = statusLabelFor(update?.status);
      if (!label) continue;
      await notifyMessageStatus(userId, { waMessageId: key.id, status: label });
    } catch (error) {
      console.error(`[${userId}] Falha ao processar atualização de status:`, error.message);
    }
  }
}

// Histórico trazido ao conectar (syncFullHistory) — pode vir em vários
// lotes grandes. Manda em pedaços pro CRM (uma chamada por mensagem seria
// lento demais) só o texto de conversa individual; o CRM decide o que fazer
// com cada uma (não sorteia/cria cliente pra contato pessoal — só popula o
// histórico da conversa).
// Lote pequeno — um lote grande demorou tanto pra gravar no banco que o
// webhook do CRM estourou o tempo limite (504) e perdeu mensagem em tempo
// real chegando junto. Mais chamadas, cada uma rápida, é mais seguro.
const HISTORY_BATCH_SIZE = 40;
async function onHistorySync(userId, messages) {
  const items = (messages || []).map(extractTextMessage).filter(Boolean);
  if (!items.length) return;
  for (let i = 0; i < items.length; i += HISTORY_BATCH_SIZE) {
    try {
      await notifyHistoryBatch(userId, items.slice(i, i + HISTORY_BATCH_SIZE));
    } catch (error) {
      console.error(`[${userId}] Falha ao enviar lote de histórico:`, error.message);
    }
  }
}

export function getLiveSessionStatus(userId) {
  const entry = sockets.get(userId);
  if (!entry || !entry.sock) return null;
  return { status: entry.status, qr: entry.qr, pairingCode: entry.pairingCode };
}

export async function disconnectSession(userId) {
  const entry = sockets.get(userId);
  if (entry?.sock) {
    try { await entry.sock.logout(); } catch { /* pode já estar fechado do lado do WhatsApp */ }
    try { entry.sock.end(undefined); } catch { /* idem */ }
  }
  sockets.delete(userId);
  await clearSessionCreds(userId);
  await notifyStatus(userId, { status: "disconnected", phoneNumber: null, qr: null });
}

// media: { kind: 'image'|'document'|'audio', url, mimeType, fileName } — o
// Baileys baixa da URL e envia pro WhatsApp sozinho (mesma URL pública já
// usada pelo número oficial, ver deliverChatMessage em lib/whatsapp-chat.js).
function buildContent(text, media) {
  const caption = String(text || "").trim() || undefined;
  if (!media?.url) return { text: String(text || "") };
  if (media.kind === "image") return { image: { url: media.url }, caption };
  if (media.kind === "audio") return { audio: { url: media.url }, mimetype: media.mimeType || "audio/mpeg", ptt: false };
  return { document: { url: media.url }, mimetype: media.mimeType || "application/octet-stream", fileName: media.fileName || "arquivo", caption };
}

export async function sendMessage(userId, { to, text, media }) {
  const entry = sockets.get(userId);
  if (!entry?.sock || entry.status !== "connected") {
    const error = new Error("Sessão do WhatsApp individual não está conectada.");
    error.code = "NOT_CONNECTED";
    throw error;
  }
  const digits = String(to || "").replace(/\D/g, "");
  if (!digits) throw new Error("Destinatário inválido.");
  const jid = `${digits}@s.whatsapp.net`;
  const result = await entry.sock.sendMessage(jid, buildContent(text, media));
  const waMessageId = result?.key?.id || "";
  if (!waMessageId) throw new Error("O WhatsApp não retornou o ID da mensagem enviada.");
  return { waMessageId };
}
