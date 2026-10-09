import makeWASocket, { Browsers, downloadMediaMessage, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { pendingWrites, useSupabaseAuthState } from "./auth-state.js";
import { clearSessionCreds, requestMediaUploadTarget } from "./db.js";
import { notifyChatEvent, notifyHistoryBatch, notifyMessageStatus, notifyStatus } from "./webhook.js";
import { extractChatEvent, extractTextMessage, lidMappingFromContact, lidMappingFromMessage, upsertRoute } from "./message-extract.js";
import { normalizePairingNumber } from "./pairing-number.js";
import { configFromEnv, createReconnectController } from "./reconnect-policy.js";
import { createCloseHandler } from "./session-lifecycle.js";
import { createKeyedMutex } from "./session-mutex.js";
import { telemetry } from "./telemetry.js";

// Liga/desliga a sincronização de histórico (ver onHistorySync) sem precisar
// mudar código — o lote de histórico grande estava travando o webhook do CRM
// (504) e piorando a corrupção de sessão (Bad MAC) quando várias sessões
// sincronizavam ao mesmo tempo. 2026-10-08: religado a pedido do dono, agora LIMITADO à última semana (texto, foto e
// áudio, lotes de 25). Para pausar de novo: WHATSAPP_HISTORY_SYNC_ENABLED=false na Railway (sem novo deploy).
const HISTORY_SYNC_ENABLED = process.env.WHATSAPP_HISTORY_SYNC_ENABLED !== "false";

// Um processo = no máximo UM socket Baileys por userId — nunca dois
// listeners pro mesmo corretor. `sockets` é a fonte da verdade EM MEMÓRIA
// deste processo; o banco (whatsapp_individual_sessions) é a fonte da
// verdade entre restarts/entre processos.
const sockets = new Map(); // userId -> { sock, status, qr, connecting: Promise|null }
// Sockets encerrados de propósito ("começar do zero"): o evento de
// "conexão fechada" deles chega DEPOIS e não pode ser tratado como queda da
// sessão atual (zerava entry.sock e agendava reconexão que derrubava o
// socket novo — 2026-10-02).
const retiredSockets = new WeakSet();
// Política de reconexão (backoff com teto, limite por ciclo, códigos de
// conflito/bloqueio NÃO reconectam): reconnect-policy.js. Antes: 4 s fixos,
// para sempre, para qualquer código que não fosse 401.
const reconnectConfig = configFromEnv(process.env);
const QR_TTL_MS = 60_000;

// Exclusão mútua por corretor: conectar (retomada no boot / botão Conectar / QR / reconexão automática)
// e desconectar nunca correm ao mesmo tempo para a MESMA sessão neste processo.
const sessionLocks = createKeyedMutex();

// Guarda de conexão (lease): server.js injeta uma função que devolve null quando PODE conectar ou o
// motivo ("shutting_down" | "waiting_lease") quando não. Sem guarda instalada, tudo é permitido.
let connectGuard = () => null;
let shuttingDown = false;
export function setConnectGuard(fn) { connectGuard = typeof fn === "function" ? fn : () => null; }
export function isShuttingDown() { return shuttingDown; }

function notReadyError(reason) {
  const error = new Error(reason === "shutting_down"
    ? "O serviço de WhatsApp está sendo reiniciado. Tente de novo em instantes."
    : "O serviço de WhatsApp está sendo atualizado e ainda não assumiu as sessões. Tente de novo em instantes.");
  error.code = "SERVICE_NOT_READY";
  return error;
}
const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || "silent" });

// LID -> telefone por corretor (ver message-extract.js). Só em memória:
// aprendido das mensagens recebidas (key.senderPn) e dos eventos de
// contato; serve para saber o telefone de uma mensagem que o corretor mandou
// pelo app numa conversa endereçada por LID. Fica fora de `sockets` para
// sobreviver a uma reconexão do mesmo corretor.
const lidMaps = new Map(); // userId -> Map(lid -> phone)
const LID_MAP_LIMIT = 5000;

function lidMapFor(userId) {
  let map = lidMaps.get(userId);
  if (!map) {
    map = new Map();
    lidMaps.set(userId, map);
  }
  return map;
}

function rememberLid(userId, mapping) {
  if (!mapping) return;
  const map = lidMapFor(userId);
  if (map.size >= LID_MAP_LIMIT && !map.has(mapping[0])) map.delete(map.keys().next().value);
  map.set(mapping[0], mapping[1]);
}

function rememberLidsFromContacts(userId, contacts) {
  for (const contact of contacts || []) {
    try { rememberLid(userId, lidMappingFromContact(contact)); } catch { /* contato malformado: ignora */ }
  }
}

function entryFor(userId) {
  let entry = sockets.get(userId);
  if (!entry) {
    entry = { sock: null, status: "disconnected", qr: null, pairingCode: null, connecting: null, controller: null, closeHandler: null, retryTimer: null };
    sockets.set(userId, entry);
  }
  return entry;
}

function controllerFor(userId, entry) {
  if (!entry.controller) {
    entry.controller = createReconnectController({
      config: reconnectConfig,
      record: (type, fields) => telemetry.record(userId, type, fields)
    });
  }
  return entry.controller;
}

function clearRetryTimer(entry) {
  if (entry.retryTimer) clearTimeout(entry.retryTimer);
  entry.retryTimer = null;
}

// Encerra de vez um socket que não será mais usado: espera as gravações de
// credenciais em andamento, fecha (end) e remove TODOS os listeners — sem isso
// o socket velho ficava vivo na memória com os handlers de mensagem/credencial.
async function retireSocket(sock) {
  if (!sock) return;
  retiredSockets.add(sock);
  try { await Promise.allSettled([...pendingWrites]); } catch { /* falha de gravação já foi logada */ }
  try { sock.end(undefined); } catch { /* socket pode já estar fechado */ }
  try { sock.ev?.removeAllListeners(); } catch { /* idem */ }
}

function closeHandlerFor(userId, entry) {
  if (!entry.closeHandler) {
    entry.closeHandler = createCloseHandler({
      userId,
      entry,
      controller: controllerFor(userId, entry),
      notifyStatus,
      clearSessionCreds,
      retireSocket,
      isShuttingDown: () => shuttingDown,
      // trigger: "auto" (queda recuperável, com backoff) ou "restart" (515 normal pós-pareamento).
      scheduleRetry: ({ delayMs, sock, trigger = "auto" }) => {
        clearRetryTimer(entry);
        const timer = setTimeout(async () => {
          if (entry.retryTimer !== timer) return; // cancelada (conexão manual / desconectar)
          entry.retryTimer = null;
          await retireSocket(sock);
          // Sem o lease (ou encerrando) nenhuma reconexão automática: quem retoma é o dono do lease.
          if (connectGuard(trigger)) return;
          connectSession(userId, { trigger }).catch((error) => onAutoReconnectFailure(userId, entry, error));
        }, delayMs);
        entry.retryTimer = timer;
      }
    });
  }
  return entry.closeHandler;
}

// A tentativa automática nem chegou a abrir socket (ex.: falha ao ler as
// credenciais no CRM): conta como queda recuperável — respeita o mesmo backoff
// e o mesmo limite, nunca fica parada em "reconectando" sem ninguém tentando.
async function onAutoReconnectFailure(userId, entry, error) {
  // Sem o lease / encerrando: não é falha da sessão — nada a contar nem a gravar; quem retoma é o dono do lease.
  if (error?.code === "SERVICE_NOT_READY") {
    console.warn(`[${userId}] Reconexão automática adiada: ${error.message}`);
    return;
  }
  console.error(`[${userId}] Falha ao reconectar automaticamente:`, error.message);
  try {
    await closeHandlerFor(userId, entry)({ sock: null, statusCode: undefined, errorMessage: `startup_failed: ${error.message}` });
  } catch (inner) {
    console.error(`[${userId}] Falha ao tratar a falha de reconexão:`, inner.message);
  }
}

// connect(): idempotente — se já existe socket vivo (ou uma conexão em
// andamento) para este userId, devolve o estado atual em vez de abrir outro.
// phoneNumber (opcional, pedido do dono 2026-09-30): pareamento por código
// numérico em vez de QR — o corretor digita o número, recebe um código de 8
// caracteres e digita em WhatsApp > Aparelhos conectados > Conectar com
// número de telefone.
//
// Exceção à idempotência (bug real, 2026-09-30, achado 2x no mesmo dia):
//
// 1ª vez: o modal do CRM já abre chamando connect() sem número (pra mostrar
// o QR na hora), então quando o corretor clicava em "prefere código?" e
// mandava o número, o socket já estava em qr_required — a idempotência
// devolvia o QR de novo e IGNORAVA o número.
//
// 2ª vez, mais grave (corretor Eduardo, número banido pela Meta): mesmo
// corrigindo o caso acima, trocar de número continuava travado quando a
// sessão ANTIGA tinha ficado presa em "reconnecting"/"error" (não
// qr_required) — porque useSupabaseAuthState() sempre recarrega as
// CREDENCIAIS SALVAS do userId, e como a sessão velha (banida) já estava
// "registered", o trecho abaixo que só pede código pra sessão NOVA
// (`!state.creds.registered`) nunca disparava: o Baileys ficava retomando
// pra sempre a sessão morta com o número velho, em loop de reconexão, e o
// número novo digitado era simplesmente ignorado.
//
// Fix definitivo: phoneNumber é sempre um pedido explícito de "quero
// começar do zero com ESTE número" — a única exceção é uma sessão já
// CONECTADA de verdade (não derruba conexão saudável à toa). Fora isso,
// não importa o status atual: derruba o socket em memória (se houver) E
// apaga as credenciais salvas antes de criar um socket novo, garantindo um
// estado realmente não registrado pro requestPairingCode() ter efeito.
//
// trigger: de onde veio o pedido — "manual" (botão Conectar / POST /connect) e
// "resume" (retomada no boot) abrem um CICLO novo de reconexão (contador
// zerado); "auto" é a reconexão agendada pela própria política (continua o
// ciclo atual, com backoff e limite).
export async function connectSession(userId, options = {}) {
  // Sem o lease do serviço (outra instância é a dona) ou encerrando: nenhuma conexão — duas instâncias
  // com a mesma sessão derrubam uma à outra (erro 440).
  const blocked = connectGuard(options.trigger || "manual");
  if (blocked) throw notReadyError(blocked);
  // Uma operação por corretor de cada vez (mutex): resume x manual/QR x automático nunca correm juntos.
  return sessionLocks.run(userId, () => connectSessionLocked(userId, options));
}

async function connectSessionLocked(userId, { phoneNumber, trigger = "manual" } = {}) {
  // O lease pode ter sido perdido enquanto esta chamada esperava a vez.
  const blockedAfterWait = connectGuard(trigger);
  if (blockedAfterWait) throw notReadyError(blockedAfterWait);
  const entry = entryFor(userId);
  // Pedido de QR (sem número) com uma sessão parada no modo código: começa do
  // zero em modo QR — senão a tela de QR recebia de volta o código antigo
  // (2026-10-02).
  const startingFresh = (Boolean(phoneNumber) || Boolean(entry.pairingMode)) && entry.status !== "connected";

  if (startingFresh) {
    if (entry.sock) {
      retiredSockets.add(entry.sock);
      try { entry.sock.end(undefined); } catch { /* socket pode já estar fechado */ }
    }
    entry.sock = null;
    entry.connecting = null;
    await clearSessionCreds(userId);
  } else {
    if (entry.sock && (entry.status === "connected" || entry.status === "qr_required" || entry.status === "pairing_code_required" || entry.status === "connecting")) {
      return { status: entry.status, qr: entry.qr, pairingCode: entry.pairingCode };
    }
    if (entry.connecting) return entry.connecting;
  }

  // Conexão pedida de fora cancela qualquer reconexão automática agendada.
  if (trigger !== "auto" && trigger !== "restart") clearRetryTimer(entry);
  entry.connecting = startSocket(userId, entry, { phoneNumber, trigger }).finally(() => { entry.connecting = null; });
  return entry.connecting;
}

async function startSocket(userId, entry, { phoneNumber, trigger = "manual" } = {}) {
  entry.status = "connecting";
  entry.pairingMode = false;
  entry.pairingError = null;
  entry.qr = null;
  entry.pairingCode = null;

  // Versão do protocolo WA Web (buscada no GitHub do Baileys a cada conexão —
  // NÃO é fixada pelo lockfile; por isso vai na telemetria).
  const { version, isLatest } = await fetchLatestBaileysVersion();
  telemetry.setWaVersion(version, isLatest);
  const controller = controllerFor(userId, entry);
  if (trigger === "auto") controller.beginRetry();
  else if (trigger === "restart") controller.beginRestart();
  else controller.beginCycle(trigger);
  const { state, saveCreds } = await useSupabaseAuthState(userId);

  // As esperas acima (versão do WA, credenciais) podem ter durado o bastante para o lease ser perdido
  // ou o SIGTERM chegar: nenhum socket novo nasce sem o lease.
  const blockedNow = connectGuard(trigger);
  if (blockedNow) {
    entry.status = "disconnected";
    throw notReadyError(blockedNow);
  }

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
    // Pareamento por código exige uma identificação de navegador que o
    // WhatsApp reconheça (o nome personalizado fazia o pedido de código
    // terminar em "Connection Closed"); sessões por QR seguem como antes.
    // (sessão pareada por código guarda creds.pairingCode — mantém o mesmo
    // navegador nas reconexões dela).
    browser: (phoneNumber && !state.creds.registered) || state.creds.pairingCode ? Browsers.macOS("Chrome") : ["CRM Imoveis", "Chrome", "1.0"]
  });
  entry.sock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    if (retiredSockets.has(sock)) return;
    // Evento de um socket que não é mais o atual desta sessão: nunca age.
    if (entry.sock && entry.sock !== sock) return;
    return onConnectionUpdate(userId, entry, sock, update);
  });
  sock.ev.on("messages.upsert", ({ messages, type }) => onMessagesUpsert(userId, messages, type));
  sock.ev.on("messages.update", (updates) => onMessagesUpdate(userId, updates));
  sock.ev.on("contacts.upsert", (contacts) => rememberLidsFromContacts(userId, contacts));
  sock.ev.on("contacts.update", (contacts) => rememberLidsFromContacts(userId, contacts));
  sock.ev.on("chats.phoneNumberShare", (share) => rememberLidsFromContacts(userId, [share]));
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
    // Modo código: o QR que o Baileys emitir é suprimido (ver
    // onConnectionUpdate) e o código só é pedido DEPOIS que o socket abriu a
    // conexão com o WhatsApp (1º evento de QR) — pedir antes falhava. Número
    // sempre no formato internacional (55 + DDD + número).
    entry.pairingMode = true;
    const digits = normalizePairingNumber(phoneNumber);
    try {
      if (!digits) throw new Error("Número inválido — informe o celular com DDD (ex.: 14 99999-0000).");
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 10000);
        const onReady = (update) => {
          // Só o QR prova que a conexão com o WhatsApp abriu de verdade —
          // o evento "connecting" dispara no instante em que o socket nasce.
          if (update.qr) {
            clearTimeout(timer);
            sock.ev.off("connection.update", onReady);
            resolve();
          }
        };
        sock.ev.on("connection.update", onReady);
      });
      const code = await sock.requestPairingCode(digits);
      entry.pairingCode = code;
      entry.status = "pairing_code_required";
      await notifyStatus(userId, { status: "pairing_code_required", pairingCode: code });
    } catch (error) {
      console.error(`[${userId}] Falha ao pedir código de pareamento:`, error.message);
      entry.pairingMode = false;
      entry.pairingError = String(error.message || "Falha ao gerar o código.").slice(0, 200);
      await notifyStatus(userId, { status: entry.status || "connecting", error: `pairing_failed: ${entry.pairingError}` });
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
      resolve({ status: entry.status, qr: entry.pairingMode ? null : entry.qr, pairingCode: entry.pairingCode, pairingError: entry.pairingError || null });
    };
    if (entry.pairingCode || entry.pairingError) { finish(); return; }
    const onUpdate = (update) => {
      if (update.qr || update.connection === "open" || update.connection === "close") finish();
    };
    sock.ev.on("connection.update", onUpdate);
    setTimeout(finish, 10_000);
  });
}

async function onConnectionUpdate(userId, entry, sock, update) {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    // Sessão em modo pareamento por código já tem o código gerado — um QR
    // que chegue depois (Baileys às vezes ainda emite, mesmo pedindo o
    // código antes) é ignorado, nunca substitui o código na tela.
    if (entry.pairingCode || entry.pairingMode) return;
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
    entry.pairingMode = false;
    entry.pairingError = null;
    const phoneNumber = String(entry.sock?.user?.id || "").split(":")[0] || "";
    // A conexão só zera o contador depois de ficar ESTÁVEL (reconnect-policy.js).
    controllerFor(userId, entry).onOpen();
    await notifyStatus(userId, { status: "connected", phoneNumber, qr: null });
    return;
  }

  if (connection === "close") {
    // Política (reconnect-policy.js + session-lifecycle.js): 401 = logout;
    // 403/440/... = NÃO reconecta (status 'error', needs_attention); queda
    // recuperável = backoff com teto e limite de tentativas por ciclo.
    await closeHandlerFor(userId, entry)({
      sock,
      statusCode: lastDisconnect?.error?.output?.statusCode,
      errorMessage: lastDisconnect?.error?.message,
      payload: lastDisconnect?.error?.output?.payload
    });
  }
}

// Extração da mensagem (inclusive conversas endereçadas por LID): ver
// message-extract.js — usada tanto para mensagem em tempo real
// (onMessagesUpsert) quanto para o histórico sincronizado (onHistorySync).
async function onMessagesUpsert(userId, messages, type) {
  for (const msg of messages || []) {
    try { rememberLid(userId, lidMappingFromMessage(msg)); } catch { /* ignora */ }
  }
  const now = Date.now();
  const historyItems = [];
  for (const msg of messages || []) {
    const route = upsertRoute({ type, fromMe: Boolean(msg?.key?.fromMe), timestampMs: messageTimestampMs(msg), now });
    if (route === "skip") continue;
    if (route === "history") { historyItems.push(msg); continue; }
    try {
      // Texto, mídia, resposta citada, reação, edição e "apagar para todos"
      // — do cliente e do que o corretor faz pelo app do celular (fromMe).
      const event = extractChatEvent(msg, lidMapFor(userId));
      if (!event) continue;
      if (event.kind === "message" && event.media) {
        event.media = { ...event.media, ...(await storeIncomingMedia(userId, msg, event)) };
      }
      await notifyChatEvent(userId, event);
    } catch (error) {
      // Nunca perde a próxima mensagem por causa de uma falha em notificar
      // esta — o log fica pra investigação manual.
      console.error(`[${userId}] Falha ao processar mensagem recebida:`, error.message);
    }
  }
  if (historyItems.length) await onHistorySync(userId, historyItems);
}

// Mídia: baixa do WhatsApp (o arquivo vem cifrado; o Baileys decifra) e
// envia direto para o Storage privado do CRM por URL assinada. Falha nunca
// impede a mensagem de chegar ao Chat: vai com status 'failed' e o motivo.
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
async function storeIncomingMedia(userId, msg, event) {
  try {
    if (event.media.size && event.media.size > MAX_MEDIA_BYTES) throw new Error("Arquivo acima de 16 MB.");
    const sock = sockets.get(userId)?.sock;
    const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock ? sock.updateMediaMessage : undefined });
    if (!buffer?.length) throw new Error("O WhatsApp devolveu um arquivo vazio.");
    if (buffer.length > MAX_MEDIA_BYTES) throw new Error("Arquivo acima de 16 MB.");
    const target = await requestMediaUploadTarget(userId, { waMessageId: event.waMessageId, mime: event.media.mime, kind: event.media.kind });
    const response = await fetch(target.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": event.media.mime || "application/octet-stream", "x-upsert": "true" },
      body: buffer
    });
    if (!response.ok) throw new Error(`Storage recusou o arquivo (HTTP ${response.status}).`);
    return { status: "stored", bucket: target.bucket, path: target.path, size: buffer.length };
  } catch (error) {
    console.error(`[${userId}] Falha ao guardar mídia ${event.waMessageId}:`, error.message);
    return { status: "failed", error: String(error.message || "Falha ao baixar a mídia").slice(0, 200) };
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
const HISTORY_BATCH_SIZE = 25;
// Pedido do dono (2026-10-08): traz só a ÚLTIMA SEMANA, com texto, fotos e áudios (vídeo/documento/figurinha ficam
// de fora). Limite de mídias por lote para o download não prender a sessão nem estourar o Storage.
const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_MEDIA_KINDS = new Set(["image", "audio"]);
const HISTORY_MAX_MEDIA = 200;

function messageTimestampMs(msg) {
  const raw = msg?.messageTimestamp;
  const seconds = raw && typeof raw === "object" ? Number(raw.toString()) : Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

async function onHistorySync(userId, messages) {
  for (const msg of messages || []) {
    try { rememberLid(userId, lidMappingFromMessage(msg)); } catch { /* ignora */ }
  }
  const cutoff = Date.now() - HISTORY_WINDOW_MS;
  const items = [];
  let mediaCount = 0;
  for (const msg of messages || []) {
    try {
      if (messageTimestampMs(msg) < cutoff) continue;
      const event = extractChatEvent(msg, lidMapFor(userId));
      if (!event || event.kind !== "message") continue;
      if (event.media) {
        // Só foto e áudio. Outros tipos entram apenas se tiverem legenda (como texto).
        if (!HISTORY_MEDIA_KINDS.has(event.media.kind) || mediaCount >= HISTORY_MAX_MEDIA) {
          if (!event.text) continue;
          event.media = null;
        } else {
          mediaCount += 1;
          event.media = { ...event.media, ...(await storeIncomingMedia(userId, msg, event)) };
        }
      }
      items.push(event);
    } catch (error) {
      console.error(`[${userId}] Falha ao preparar mensagem do histórico:`, error.message);
    }
  }
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

// Há tentativa real em andamento para este corretor NESTE processo? (socket vivo, conexão em curso ou
// reconexão agendada). Usado pela reconciliação e pela retomada.
export function isSessionActive(userId) {
  const entry = sockets.get(userId);
  return Boolean(entry && (entry.sock || entry.connecting || entry.retryTimer));
}

// Para TODAS as sessões deste processo SEM logout e SEM apagar credenciais nem gravar estado no banco
// (a sessão continua 'connected' lá, para o próximo dono do lease retomar). Usado no SIGTERM e quando
// o lease é perdido. `flag`: true no encerramento do serviço (nada mais conecta nem reconecta).
export async function suspendAllSessions({ shutdown = false } = {}) {
  if (shutdown) shuttingDown = true;
  const retired = [];
  for (const [, entry] of sockets) {
    clearRetryTimer(entry);
    entry.controller?.cancel(shutdown ? "service_shutdown" : "lease_lost");
    if (entry.sock) {
      retired.push(retireSocket(entry.sock));
      entry.sock = null;
    }
    entry.connecting = null;
    entry.qr = null;
    entry.pairingCode = null;
    entry.pairingMode = false;
    entry.status = "disconnected";
  }
  await Promise.allSettled(retired);
  return retired.length;
}

export async function disconnectSession(userId) {
  return sessionLocks.run(userId, () => disconnectSessionLocked(userId));
}

async function disconnectSessionLocked(userId) {
  const entry = sockets.get(userId);
  if (entry) {
    // Desconexão pedida: nenhuma reconexão automática pode sobreviver a ela.
    clearRetryTimer(entry);
    entry.controller?.cancel("manual_disconnect");
  }
  if (entry?.sock) {
    // O fechamento causado pelo logout abaixo não é uma "queda" a tratar.
    retiredSockets.add(entry.sock);
    try { await entry.sock.logout(); } catch { /* pode já estar fechado do lado do WhatsApp */ }
    try { entry.sock.end(undefined); } catch { /* idem */ }
  }
  sockets.delete(userId);
  await clearSessionCreds(userId);
  await notifyStatus(userId, { status: "disconnected", phoneNumber: null, qr: null });
}

// media: { kind: 'image'|'video'|'gif'|'sticker'|'document'|'audio', url,
// mimeType, fileName } — o Baileys baixa da URL e envia pro WhatsApp sozinho
// (mesma URL pública já usada pelo número oficial, ver deliverChatMessage em
// lib/whatsapp-chat.js). GIF = vídeo MP4 com reprodução automática.
function buildContent(text, media) {
  const caption = String(text || "").trim() || undefined;
  if (!media?.url) return { text: String(text || "") };
  if (media.kind === "image") return { image: { url: media.url }, caption };
  if (media.kind === "video") return { video: { url: media.url }, caption, mimetype: media.mimeType || "video/mp4" };
  if (media.kind === "gif") return { video: { url: media.url }, caption, gifPlayback: true, mimetype: "video/mp4" };
  if (media.kind === "sticker") return { sticker: { url: media.url } };
  if (media.kind === "audio") return { audio: { url: media.url }, mimetype: media.mimeType || "audio/mpeg", ptt: Boolean(media.ptt) };
  return { document: { url: media.url }, mimetype: media.mimeType || "application/octet-stream", fileName: media.fileName || "arquivo", caption };
}

function connectedSocket(userId) {
  const entry = sockets.get(userId);
  if (!entry?.sock || entry.status !== "connected") {
    const error = new Error("Sessão do WhatsApp individual não está conectada.");
    error.code = "NOT_CONNECTED";
    throw error;
  }
  return entry.sock;
}

function jidFor(to) {
  const digits = String(to || "").replace(/\D/g, "");
  if (!digits) throw new Error("Destinatário inválido.");
  return `${digits}@s.whatsapp.net`;
}

// Chave de uma mensagem desta conversa (para citar, reagir, editar, apagar).
// Sempre no JID do telefone — o mesmo para onde a mensagem é enviada.
function keyFor(jid, id, fromMe) {
  const cleanId = String(id || "").trim();
  if (!cleanId) throw new Error("Mensagem de referência inválida.");
  return { remoteJid: jid, id: cleanId, fromMe: Boolean(fromMe) };
}

// quoted (opcional): { id, fromMe, text } — resposta citada a uma mensagem.
export async function sendMessage(userId, { to, text, media, quoted }) {
  const sock = connectedSocket(userId);
  const jid = jidFor(to);
  const options = {};
  if (quoted?.id) {
    options.quoted = { key: keyFor(jid, quoted.id, quoted.fromMe), message: { conversation: String(quoted.text || "") } };
  }
  const result = await sock.sendMessage(jid, buildContent(text, media), options);
  const waMessageId = result?.key?.id || "";
  if (!waMessageId) throw new Error("O WhatsApp não retornou o ID da mensagem enviada.");
  return { waMessageId, remoteJid: result?.key?.remoteJid || jid };
}

// Reação (emoji vazio remove a reação).
export async function reactToMessage(userId, { to, targetId, targetFromMe, emoji }) {
  const sock = connectedSocket(userId);
  const jid = jidFor(to);
  const result = await sock.sendMessage(jid, { react: { text: String(emoji || ""), key: keyFor(jid, targetId, targetFromMe) } });
  return { waMessageId: result?.key?.id || "" };
}

// Editar mensagem que ESTE número enviou (o WhatsApp aceita só texto/legenda
// e por tempo limitado — a regra de prazo fica no CRM).
export async function editMessage(userId, { to, targetId, text }) {
  const sock = connectedSocket(userId);
  const jid = jidFor(to);
  const clean = String(text || "").trim();
  if (!clean) throw new Error("Texto vazio.");
  const result = await sock.sendMessage(jid, { text: clean, edit: keyFor(jid, targetId, true) });
  return { waMessageId: result?.key?.id || "" };
}

// Apagar para todos (só mensagem que ESTE número enviou).
export async function deleteMessageForEveryone(userId, { to, targetId }) {
  const sock = connectedSocket(userId);
  const jid = jidFor(to);
  const result = await sock.sendMessage(jid, { delete: keyFor(jid, targetId, true) });
  return { waMessageId: result?.key?.id || "" };
}
