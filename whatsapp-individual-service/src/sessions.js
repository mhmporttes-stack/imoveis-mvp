import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { useSupabaseAuthState } from "./auth-state.js";
import { clearSessionCreds } from "./db.js";
import { notifyHistoryBatch, notifyMessage, notifyStatus } from "./webhook.js";

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
    entry = { sock: null, status: "disconnected", qr: null, connecting: null };
    sockets.set(userId, entry);
  }
  return entry;
}

// connect(): idempotente — se já existe socket vivo (ou uma conexão em
// andamento) para este userId, devolve o estado atual em vez de abrir outro.
export async function connectSession(userId) {
  const entry = entryFor(userId);
  if (entry.sock && (entry.status === "connected" || entry.status === "qr_required" || entry.status === "connecting")) {
    return { status: entry.status, qr: entry.qr };
  }
  if (entry.connecting) return entry.connecting;

  entry.connecting = startSocket(userId, entry).finally(() => { entry.connecting = null; });
  return entry.connecting;
}

async function startSocket(userId, entry) {
  entry.status = "connecting";

  const { state, saveCreds } = await useSupabaseAuthState(userId);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    logger,
    printQRInTerminal: false,
    // Traz o histórico de conversas do celular ao conectar, igual o WhatsApp
    // Web (pedido explícito do dono, ciente de que isso inclui conversas
    // pessoais do corretor — ver onHistorySync).
    syncFullHistory: true,
    browser: ["CRM Imoveis", "Chrome", "1.0"]
  });
  entry.sock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => onConnectionUpdate(userId, entry, update));
  sock.ev.on("messages.upsert", ({ messages, type }) => onMessagesUpsert(userId, messages, type));
  sock.ev.on("messaging-history.set", ({ messages }) => onHistorySync(userId, messages));

  // Resolve a chamada HTTP assim que soubermos "precisa de QR" ou "já
  // conectou" (creds válidos reaproveitados) — sem travar a resposta do
  // POST /connect esperando o ciclo de vida inteiro da conexão. Um timeout
  // de segurança evita a chamada ficar pendurada; a tela já faz polling do
  // status separadamente.
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ status: entry.status, qr: entry.qr });
    };
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
      // conectados): credenciais não servem mais — precisa de QR novo.
      entry.status = "disconnected";
      entry.qr = null;
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

// Histórico trazido ao conectar (syncFullHistory) — pode vir em vários
// lotes grandes. Manda em pedaços pro CRM (uma chamada por mensagem seria
// lento demais) só o texto de conversa individual; o CRM decide o que fazer
// com cada uma (não sorteia/cria cliente pra contato pessoal — só popula o
// histórico da conversa).
const HISTORY_BATCH_SIZE = 200;
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
  return { status: entry.status, qr: entry.qr };
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

export async function sendMessage(userId, { to, text }) {
  const entry = sockets.get(userId);
  if (!entry?.sock || entry.status !== "connected") {
    const error = new Error("Sessão do WhatsApp individual não está conectada.");
    error.code = "NOT_CONNECTED";
    throw error;
  }
  const digits = String(to || "").replace(/\D/g, "");
  if (!digits) throw new Error("Destinatário inválido.");
  const jid = `${digits}@s.whatsapp.net`;
  const result = await entry.sock.sendMessage(jid, { text: String(text || "") });
  const waMessageId = result?.key?.id || "";
  if (!waMessageId) throw new Error("O WhatsApp não retornou o ID da mensagem enviada.");
  return { waMessageId };
}
