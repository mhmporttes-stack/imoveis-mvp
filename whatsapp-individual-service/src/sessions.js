import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { useSupabaseAuthState } from "./auth-state.js";
import { clearSessionCreds } from "./db.js";
import { notifyMessage, notifyStatus } from "./webhook.js";

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
    syncFullHistory: false,
    browser: ["CRM Imoveis", "Chrome", "1.0"]
  });
  entry.sock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => onConnectionUpdate(userId, entry, update));
  sock.ev.on("messages.upsert", ({ messages, type }) => onMessagesUpsert(userId, messages, type));

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

async function onMessagesUpsert(userId, messages, type) {
  if (type !== "notify") return;
  for (const msg of messages || []) {
    try {
      if (msg.key?.fromMe) continue;
      const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.imageMessage?.caption
        || msg.message?.videoMessage?.caption
        || "";
      if (!text) continue; // só texto nesta primeira versão (mídia fica para uma etapa futura)
      const from = String(msg.key?.remoteJid || "").split("@")[0];
      if (!from) continue;
      await notifyMessage(userId, {
        from,
        text,
        waMessageId: msg.key?.id || "",
        at: new Date(Number(msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        contactName: msg.pushName || ""
      });
    } catch (error) {
      // Nunca perde a próxima mensagem por causa de uma falha em notificar
      // esta — o log fica pra investigação manual.
      console.error(`[${userId}] Falha ao processar mensagem recebida:`, error.message);
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
