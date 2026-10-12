import makeWASocket, { Browsers, downloadMediaMessage, fetchLatestBaileysVersion, jidNormalizedUser, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { pendingWrites, useSupabaseAuthState } from "./auth-state.js";
import { clearSessionCreds, requestMediaUploadTarget } from "./db.js";
import { notifyChatEvent, notifyGroupEvent, notifyHistoryBatch, notifyLidResolved, notifyMessageStatus, notifyStatus, requestLidCandidates } from "./webhook.js";
import { extractChatEvent, extractTextMessage, isLidJid, lidMappingFromContact, messageTimestampSeconds, lidMappingFromMessage, normalizeLid, phoneFromJid, upsertRoute } from "./message-extract.js";
import { normalizePairingNumber } from "./pairing-number.js";
import { configFromEnv, createReconnectController } from "./reconnect-policy.js";
import { createCloseHandler } from "./session-lifecycle.js";
import { buildOnDemandRequest, classifyHistoryProtocol, createOnDemandRegistry, HISTORY_SYNC_ON_DEMAND, ON_DEMAND_MAX_COUNT, ON_DEMAND_MAX_VIDEOS, ON_DEMAND_MEDIA_KINDS } from "./history-on-demand.js";
import { createKeyedMutex } from "./session-mutex.js";
import { telemetry } from "./telemetry.js";

// Liga/desliga a sincronização de histórico (ver onHistorySync) sem precisar
// mudar código — o lote de histórico grande estava travando o webhook do CRM
// (504) e piorando a corrupção de sessão (Bad MAC) quando várias sessões
// sincronizavam ao mesmo tempo. 2026-10-08: religado a pedido do dono, agora LIMITADO à última semana (texto, foto e
// áudio, lotes de 25). Para pausar de novo: WHATSAPP_HISTORY_SYNC_ENABLED=false na Railway (sem novo deploy).
// 2026-10-11 (incidente): ligado pela 1ª vez de verdade às 13h44, NENHUMA sessão conseguiu ficar conectada (43 quedas 428
// "Connection Closed", 0 conexões; antes, com ele desligado, 12 conexões normais). Volta a ser DESLIGADO por padrão:
// só liga com WHATSAPP_HISTORY_SYNC_ENABLED=true na Railway, depois de investigar a causa.
// Causa achada no Baileys (Utils/validate-connection.js): com syncFullHistory ligado e navegador "Mac OS", o LOGIN passa a
// se apresentar como DARWIN em vez de WEB_BROWSER — diferente de como as sessões foram pareadas — e o WhatsApp fecha na hora.
// Correção: o histórico só é pedido no PAREAMENTO NOVO por QR (único momento em que o WhatsApp o envia), com um navegador
// que mantém WEB_BROWSER; reconexões e pareamento por código nunca pedem histórico (login idêntico ao de sempre).
const HISTORY_SYNC_ENABLED = process.env.WHATSAPP_HISTORY_SYNC_ENABLED !== "false";
export const historySyncEnabled = () => HISTORY_SYNC_ENABLED;

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

// "Online / visto por último" do contato (pedido do dono, 2026-10-09). Só LEITURA, igual ao WhatsApp Web ao abrir
// uma conversa (presenceSubscribe). Guardado em memória por corretor + telefone; nada vai para o banco.
const presences = new Map(); // `${userId}|${telefone}` -> { state, lastSeen, at }
const PRESENCE_LIMIT = 2000;
const presenceAsked = new Map(); // `${userId}|${telefone}` -> último pedido (ms) — no máximo 1 por minuto por contato

function presencePhone(userId, jid) {
  const raw = String(jid || "");
  if (raw.endsWith("@lid")) {
    const map = lidMapFor(userId);
    const phone = map.get(raw) || map.get(raw.split("@")[0]) || "";
    return String(phone).split("@")[0].split(":")[0].replace(/\D/g, "");
  }
  return raw.split("@")[0].split(":")[0].replace(/\D/g, "");
}

function onPresenceUpdate(userId, { id, presences: list } = {}) {
  for (const [participant, data] of Object.entries(list || {})) {
    const phone = presencePhone(userId, participant || id);
    if (!phone || !data) continue;
    const key = `${userId}|${phone}`;
    if (presences.size >= PRESENCE_LIMIT && !presences.has(key)) presences.delete(presences.keys().next().value);
    const previous = presences.get(key) || {};
    presences.set(key, {
      state: data.lastKnownPresence || previous.state || null,
      lastSeen: Number(data.lastSeen) > 0 ? Number(data.lastSeen) * 1000 : previous.lastSeen || null,
      at: Date.now()
    });
  }
}

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
  // Aprendeu o telefone de um LID que já tinha conversa "Número não identificado": o CRM junta as duas.
  const placeholderId = `${userId}|${mapping[0]}`;
  if (placeholderLids.has(placeholderId)) {
    placeholderLids.delete(placeholderId);
    notifyLidResolved(userId, mapping[0], mapping[1]).catch(() => {});
  }
}

// Mensagens do PRÓPRIO corretor (enviadas pelo celular) para um LID sem telefone conhecido (contato novo). Regra do
// dono (2026-10-10): TUDO do WhatsApp do corretor entra no Chat. 1) tenta descobrir o telefone pelos clientes recentes
// do corretor (CRM -> onWhatsApp, nada é enviado); 2) não achou: entrega mesmo assim como "lid:<id>" ("Número não
// identificado" no Chat) e, quando o telefone aparecer (resposta do contato, agenda), avisa o CRM para juntar.
const placeholderLids = new Map(); // `${userId}|${lid}` -> true (entregue como "lid:<id>", aguardando o telefone)
const PLACEHOLDER_LID_LIMIT = 2000;
const lidAskedAt = new Map(); // `${userId}|${lid}` -> último pedido de candidatos (ms)
const LID_RESOLVE_COOLDOWN_MS = 5 * 60 * 1000;

// LID sem telefone conhecido — do corretor (fromMe) OU recebida sem `senderPn` (2026-10-11: nada pode ser descartado
// por falta de número; vira "Número não identificado" até o telefone aparecer).
function unresolvedOwnLid(userId, msg) {
  const key = msg?.key || {};
  if (!isLidJid(key.remoteJid)) return "";
  if (!key.fromMe && phoneFromJid(key.senderPn)) return "";
  const lid = normalizeLid(key.remoteJid);
  return lid && !lidMapFor(userId).get(lid) ? lid : "";
}

async function resolveLidByCandidates(userId, lid) {
  const id = `${userId}|${lid}`;
  if (Date.now() - (lidAskedAt.get(id) || 0) < LID_RESOLVE_COOLDOWN_MS) return false;
  if (lidAskedAt.size >= PLACEHOLDER_LID_LIMIT) lidAskedAt.delete(lidAskedAt.keys().next().value);
  lidAskedAt.set(id, Date.now());
  const sock = sockets.get(userId)?.sock;
  if (!sock?.onWhatsApp) return false;
  const phones = await requestLidCandidates(userId, lid);
  if (!phones.length) return false;
  const results = await sock.onWhatsApp(...phones.map((phone) => `${phone}@s.whatsapp.net`)).catch(() => []);
  for (const result of results || []) {
    const resultLid = normalizeLid(result?.lid);
    const phone = phoneFromJid(result?.jid);
    if (resultLid && phone) rememberLid(userId, [resultLid, phone]);
  }
  return Boolean(lidMapFor(userId).get(lid));
}

// Mapa LID -> "lid:<id>" para entregar a mensagem como "Número não identificado" (e lembrar de avisar o CRM depois).
function withPlaceholder(userId, lid) {
  const placeholder = `lid:${lid.split("@")[0]}`;
  const id = `${userId}|${lid}`;
  if (placeholderLids.size >= PLACEHOLDER_LID_LIMIT && !placeholderLids.has(id)) placeholderLids.delete(placeholderLids.keys().next().value);
  placeholderLids.set(id, true);
  return new Map([...lidMapFor(userId), [lid, placeholder]]);
}

async function deliverOwnLidMessage(userId, lid, msg) {
  const resolved = await resolveLidByCandidates(userId, lid).catch((error) => {
    console.error(`[${userId}] Falha ao resolver LID de mensagem enviada pelo celular:`, error.message);
    return false;
  });
  if (resolved) return deliverLiveMessage(userId, msg);
  return deliverLiveMessage(userId, msg, withPlaceholder(userId, lid));
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

  // Histórico só no pareamento NOVO por QR (sem credenciais de conta, sem número para código).
  const fullHistory = HISTORY_SYNC_ENABLED && !phoneNumber && !state.creds?.me?.id;
  // O histórico chega DEPOIS do pareamento, em partes, por vários minutos — e o Baileys confirma cada parte ao WhatsApp
  // ANTES de processar (recibo hist_sync): parte recusada é perdida. TODO socket processa o histórico (shouldSyncHistoryMessage);
  // só o login do pareamento por QR pede o histórico longo (syncFullHistory). 2026-10-11: antes só aceitava 30 min após o
  // pareamento, guardado em memória — o reinício do serviço no meio da importação descartou o resto do histórico.
  // Duplicata não é problema: o CRM ignora mensagem já gravada (wa_message_id) e o filtro da última semana continua.
  const wantsHistory = HISTORY_SYNC_ENABLED;
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
    syncFullHistory: fullHistory,
    // ON_DEMAND ("Carregar mensagens anteriores do celular", 2026-10-12) é sempre processado: só chega quando o Chat
    // pede, e com a variável desligada o Baileys descartava a resposta antes de qualquer evento.
    shouldSyncHistoryMessage: (notification) => wantsHistory || Number(notification?.syncType) === HISTORY_SYNC_ON_DEMAND,
    // Pareamento por código exige uma identificação de navegador que o
    // WhatsApp reconheça (o nome personalizado fazia o pedido de código
    // terminar em "Connection Closed"); sessões por QR seguem como antes.
    // (sessão pareada por código guarda creds.pairingCode — mantém o mesmo
    // navegador nas reconexões dela).
    // QR NOVO (2026-10-09): o WhatsApp só manda o histórico longo para aparelho vinculado do tipo DESKTOP, e esse tipo é
    // decidido no pareamento (não nas reconexões). Com "Chrome" vinha quase nada — por isso o histórico não carregava.
    // Pareamento novo por QR com histórico: tipo DESKTOP (histórico longo) com nome próprio — "Mac OS"/"Windows" fariam o
    // Baileys mudar o login para DARWIN/WIN32 (ver HISTORY_SYNC_ENABLED).
    browser: fullHistory
      ? ["CRM Imoveis", "Desktop", "1.0"]
      : !state.creds.registered && !phoneNumber
      ? Browsers.macOS("Desktop")
      : (phoneNumber && !state.creds.registered) || state.creds.pairingCode ? Browsers.macOS("Chrome") : ["CRM Imoveis", "Chrome", "1.0"]
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
  sock.ev.on("presence.update", (update) => { try { onPresenceUpdate(userId, update); } catch { /* ignora */ } });
  sock.ev.on("contacts.upsert", (contacts) => rememberLidsFromContacts(userId, contacts));
  sock.ev.on("contacts.update", (contacts) => rememberLidsFromContacts(userId, contacts));
  sock.ev.on("chats.phoneNumberShare", (share) => rememberLidsFromContacts(userId, [share]));
  sock.ev.on("messaging-history.set", ({ messages, contacts, chats, syncType, peerDataRequestSessionId }) => {
    // Histórico do pareamento só com a variável ligada; ON_DEMAND (botão do Chat) sempre.
    if (!wantsHistory && Number(syncType) !== HISTORY_SYNC_ON_DEMAND) return;
    // Aprende LID -> telefone dos contatos e conversas do próprio histórico ANTES das mensagens (2026-10-11).
    rememberLidsFromContacts(userId, contacts);
    rememberLidsFromContacts(userId, (chats || []).map((chat) => ({ id: chat?.id, lid: chat?.lidJid, jid: chat?.pnJid })));
    return onHistorySync(userId, messages, { syncType, chats, peerDataRequestSessionId });
  });

  // Variantes BR com e sem o 9 extra do celular: "5514999990000" <-> "551499990000".
function brazilPhoneVariants(digits) {
  const variants = [digits];
  if (/^55\d{2}9\d{8}$/.test(digits)) variants.push(`${digits.slice(0, 4)}${digits.slice(5)}`);
  else if (/^55\d{2}\d{8}$/.test(digits)) variants.push(`${digits.slice(0, 4)}9${digits.slice(4)}`);
  return variants;
}

async function resolvePairingNumber(userId, digits) {
  const baseUser = String(userId).split(":")[0];
  const connected = [...sockets.entries()]
    .filter(([id, item]) => id !== userId && item?.status === "connected" && item.sock?.onWhatsApp)
    .sort(([a], [b]) => Number(String(b).split(":")[0] === baseUser) - Number(String(a).split(":")[0] === baseUser));
  const sock = connected[0]?.[1]?.sock;
  if (!sock) return digits;
  let results = null;
  try {
    results = await Promise.race([
      sock.onWhatsApp(...brazilPhoneVariants(digits).map((value) => `${value}@s.whatsapp.net`)),
      new Promise((resolve) => setTimeout(() => resolve(null), 5000))
    ]);
  } catch {
    return digits;
  }
  if (!Array.isArray(results)) return digits; // consulta sem resposta: segue com o número digitado
  const found = results.find((item) => item?.exists && phoneFromJid(item.jid));
  if (found) return phoneFromJid(found.jid);
  // O WhatsApp respondeu que o número não tem conta: avisa em vez de gerar um código que nunca vai funcionar.
  if (results.length) throw new Error("Esse número não tem WhatsApp. Confira o número (com DDD) do celular que vai conectar.");
  return digits;
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
      // Número EXATO da conta no WhatsApp (2026-10-11, caso Jennyfer): conta brasileira antiga pode estar registrada SEM o
      // 9 extra — com o número "errado" o código nunca é aceito no celular. Consulta por uma sessão já conectada (só
      // pergunta "esse número tem WhatsApp?", nada é enviado); sem sessão conectada, segue com o número digitado.
      const pairingDigits = await resolvePairingNumber(userId, digits);
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
      const code = await sock.requestPairingCode(pairingDigits);
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
    try { recordHistoryProtocol(userId, msg); } catch { /* diagnóstico nunca atrapalha */ }
  }
  const now = Date.now();
  const historyItems = [];
  for (const msg of messages || []) {
    const route = upsertRoute({ type, fromMe: Boolean(msg?.key?.fromMe), timestampMs: messageTimestampMs(msg), now });
    if (route === "skip") continue;
    if (route === "history") { historyItems.push(msg); continue; }
    const ownLid = unresolvedOwnLid(userId, msg);
    if (ownLid) {
      await deliverOwnLidMessage(userId, ownLid, msg);
      continue;
    }
    await deliverLiveMessage(userId, msg);
  }
  if (historyItems.length) await onHistorySync(userId, historyItems);
}

async function deliverLiveMessage(userId, msg, lidMap = lidMapFor(userId)) {
  try {
    // Texto, mídia, resposta citada, reação, edição e "apagar para todos"
    // — do cliente e do que o corretor faz pelo app do celular (fromMe).
    const event = extractChatEvent(msg, lidMap);
    if (!event) return;
    if (event.group) return await deliverGroupMessage(userId, msg, event);
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

// Grupos (2026-10-11): só mensagens (texto e todas as mídias) vão ao CRM, num evento próprio. Grupo que o dono
// removeu do Chat fica em memória (o CRM responde { ignored: true }) para não baixar mais nada dele.
const removedGroups = new Set(); // `${userId}|${groupKey}`
const groupNames = new Map(); // `${userId}|${jid}` -> { name, at }
const GROUP_NAME_TTL_MS = 6 * 60 * 60 * 1000;
const GROUP_CACHE_LIMIT = 2000;

async function groupNameFor(userId, jid) {
  const id = `${userId}|${jid}`;
  const cached = groupNames.get(id);
  if (cached && Date.now() - cached.at < GROUP_NAME_TTL_MS) return cached.name;
  let name = cached?.name || "";
  try {
    const sock = sockets.get(userId)?.sock;
    const metadata = sock?.groupMetadata ? await sock.groupMetadata(jid) : null;
    if (metadata?.subject) name = String(metadata.subject).slice(0, 120);
  } catch { /* sem nome: o CRM mostra "Grupo" */ }
  if (groupNames.size >= GROUP_CACHE_LIMIT && !groupNames.has(id)) groupNames.delete(groupNames.keys().next().value);
  groupNames.set(id, { name, at: Date.now() });
  return name;
}

async function deliverGroupMessage(userId, msg, event) {
  if (event.kind !== "message") return;
  const removedId = `${userId}|${event.from}`;
  if (removedGroups.has(removedId)) return;
  event.groupName = await groupNameFor(userId, event.remoteJid);
  if (event.media) event.media = { ...event.media, ...(await storeIncomingMedia(userId, msg, event)) };
  const result = await notifyGroupEvent(userId, event);
  if (result?.ignored) {
    if (removedGroups.size >= GROUP_CACHE_LIMIT) removedGroups.delete(removedGroups.keys().next().value);
    removedGroups.add(removedId);
  }
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
    const target = await requestMediaUploadTarget(userId, { waMessageId: event.waMessageId, mime: event.media.mime, kind: event.media.kind, group: event.group ? event.from : "" });
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
      // Recibo do PRÓPRIO pedido de mensagens anteriores (o celular recebeu o pedido): só diagnóstico, nunca vai ao Chat.
      if (onDemandRequests.isPending(userId, key.id)) { recordOnDemandAck(userId, key.id, update?.status); continue; }
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
  return messageTimestampSeconds(msg) * 1000;
}

async function onHistorySync(userId, messages, meta = {}) {
  const startedAt = Date.now();
  for (const msg of messages || []) {
    try { rememberLid(userId, lidMappingFromMessage(msg)); } catch { /* ignora */ }
  }
  // Pedido manual de mensagens anteriores de UMA conversa (ON_DEMAND = 6, botão do Chat): o corretor/dono pediu
  // justamente o que é mais antigo — sem a janela da última semana.
  const onDemand = Number(meta.syncType) === HISTORY_SYNC_ON_DEMAND;
  const cutoff = onDemand ? 0 : Date.now() - HISTORY_WINDOW_MS;
  const request = onDemand ? onDemandRequests.match(userId, String(meta.peerDataRequestSessionId || "")) : null;
  // ON_DEMAND traz também vídeo (pedido do dono, 2026-10-12; até 16 MB cada, até 10 por resposta). O histórico do
  // pareamento continua só com foto e áudio.
  const mediaKinds = onDemand ? ON_DEMAND_MEDIA_KINDS_SET : HISTORY_MEDIA_KINDS;
  const counts = { old: 0, noTs: 0, skipped: 0, groups: 0, items: 0, sent: 0, failed: 0, videos: 0 };
  let pending = [];
  let mediaCount = 0;
  if (request) onDemandRequests.beginChunk(request);
  // Envia ao CRM AOS POUCOS (2026-10-11): antes só mandava depois de baixar TODAS as fotos/áudios do lote — um lote grande
  // ficava minutos sem aparecer nada no Chat.
  const flush = async () => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    try {
      const result = await notifyHistoryBatch(userId, batch);
      if (result) {
        counts.sent += 1;
        if (request) onDemandRequests.addDelivered(request, batch.length);
      } else counts.failed += 1;
    } catch (error) {
      counts.failed += 1;
      console.error(`[${userId}] Falha ao enviar lote de histórico:`, error.message);
    }
  };
  for (const msg of messages || []) {
    try {
      const sentAt = messageTimestampMs(msg);
      if (!sentAt) counts.noTs += 1;
      if (sentAt < cutoff) { counts.old += 1; continue; }
      // Contato sem telefone conhecido (LID) não é mais descartado (2026-10-11, histórico vinha quase vazio): entra como
      // "lid:<id>" ("Número não identificado") e o CRM junta à conversa do telefone quando ele aparecer.
      const ownLid = unresolvedOwnLid(userId, msg);
      const event = extractChatEvent(msg, ownLid ? withPlaceholder(userId, ownLid) : lidMapFor(userId));
      if (event?.group) { counts.groups += 1; continue; }
      if (!event || event.kind !== "message") { counts.skipped += 1; continue; }
      if (event.media) {
        // Pareamento: só foto e áudio; ON_DEMAND: também vídeo, com limite. Outros tipos entram apenas se tiverem
        // legenda (como texto).
        const isVideo = event.media.kind === "video" || event.media.kind === "gif";
        const overVideoLimit = isVideo && counts.videos >= ON_DEMAND_MAX_VIDEOS;
        if (!mediaKinds.has(event.media.kind) || mediaCount >= HISTORY_MAX_MEDIA || overVideoLimit) {
          if (!event.text) { counts.skipped += 1; continue; }
          event.media = null;
        } else {
          mediaCount += 1;
          if (isVideo) counts.videos += 1;
          // storeIncomingMedia recusa acima de 16 MB (a mensagem chega com o motivo, sem o arquivo).
          event.media = { ...event.media, ...(await storeIncomingMedia(userId, msg, event)) };
        }
      }
      pending.push(event);
      counts.items += 1;
      if (pending.length >= HISTORY_BATCH_SIZE) await flush();
    } catch (error) {
      console.error(`[${userId}] Falha ao preparar mensagem do histórico:`, error.message);
    }
  }
  await flush();
  // Diagnóstico (sem conteúdo nem telefone): quanto o WhatsApp mandou e quanto chegou ao CRM.
  telemetry.record(userId, "history_sync", {
    reason: `sync_${meta.syncType ?? "upsert"}`,
    attempt: (messages || []).length,
    nextAttempt: counts.items,
    maxRetries: counts.sent,
    statusCode: counts.failed,
    delayMs: Date.now() - startedAt,
    detail: `old${counts.old}_nots${counts.noTs}_skip${counts.skipped}_grp${counts.groups}_chats${(meta.chats || []).length}`,
    ...(onDemand ? { cycleId: request?.requestId || "", kind: request ? "matched" : "unmatched", trigger: `vid${counts.videos}` } : {})
  });
  if (request) {
    onDemandRequests.recordChunk(request, {
      messages: messages || [],
      videos: counts.videos,
      timestampSecondsOf: messageTimestampSeconds,
      chatJidOf: (msg) => String(msg?.key?.remoteJid || "")
    });
  }
}

// ---------------------------------------------------------------------------
// Diagnóstico do ON_DEMAND (2026-10-12): telemetria `history_sync` sem conteúdo nem telefone, com o id do pedido em
// cycleId para ligar pedido -> recibo do celular -> notificação -> lote gravado.
//   reason req_sent / req_failed / req_ack_<status> / pdo_resp / notif_<syncType>
// ---------------------------------------------------------------------------
const onDemandRequests = createOnDemandRegistry();
const ON_DEMAND_MEDIA_KINDS_SET = new Set(ON_DEMAND_MEDIA_KINDS);

function recordHistoryProtocol(userId, msg) {
  const info = classifyHistoryProtocol(msg);
  if (!info) return;
  if (info.kind === "notification") {
    const request = info.syncType === HISTORY_SYNC_ON_DEMAND ? onDemandRequests.match(userId, info.sessionId) : null;
    if (request) request.notifications += 1;
    telemetry.record(userId, "history_sync", {
      reason: `notif_${info.syncType}`,
      cycleId: request?.requestId || "",
      kind: info.syncType === HISTORY_SYNC_ON_DEMAND ? (request ? "matched" : "unmatched") : "",
      attempt: info.chunkOrder,
      detail: `proc${wantsOnDemandOrHistory(info.syncType) ? 1 : 0}`
    });
    return;
  }
  const request = onDemandRequests.match(userId, info.sessionId);
  if (request) {
    request.pdoResponses += 1;
    if (info.responseCode !== null) request.pdoCode = info.responseCode;
  }
  telemetry.record(userId, "history_sync", {
    reason: "pdo_resp",
    cycleId: request?.requestId || "",
    kind: request ? "matched" : "unmatched",
    statusCode: info.requestType,
    attempt: info.results,
    detail: info.responseCode === null ? "nocode" : `code${info.responseCode}`
  });
}

function wantsOnDemandOrHistory(syncType) {
  return HISTORY_SYNC_ENABLED || Number(syncType) === HISTORY_SYNC_ON_DEMAND;
}

function recordOnDemandAck(userId, requestId, status) {
  const request = onDemandRequests.get(userId, requestId);
  if (!request || request.ackStatus === status) return;
  request.ackStatus = Number(status) || null;
  telemetry.record(userId, "history_sync", { reason: `req_ack_${Number(status) || 0}`, cycleId: requestId, delayMs: Date.now() - request.sentAt });
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
  // Conversa "Número não identificado" do CRM (2026-10-10): "lid:<id>" responde direto no LID do contato.
  const lid = /^lid:(\d{5,30})$/.exec(String(to || ""));
  if (lid) return `${lid[1]}@lid`;
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

// "Carregar mensagens anteriores" (pedido do dono, 2026-10-11): pede ao CELULAR do corretor as mensagens desta conversa
// mais antigas que a referência. Não envia nada ao contato — é um pedido do aparelho vinculado ao próprio celular. A
// resposta chega depois, como histórico ON_DEMAND (onHistorySync), e o CRM grava sem duplicar.
// 2026-10-12: pedido montado em history-on-demand.js (horário em SEGUNDOS + atributos do WhatsApp) — o
// fetchMessageHistory do Baileys 6.7.24 mandava em ms e o celular nunca respondia. `continueFrom` = id do pedido
// anterior: usa como referência a mensagem mais antiga que o celular devolveu nele (rodadas até cobrir 15 dias).
export async function requestOlderHistory(userId, { to, remoteJid, oldestId, oldestFromMe, oldestTimestampMs, count, continueFrom }) {
  let failure = "send_error";
  try {
    const sock = connectedSocket(userId);
    let jid = /^\d{5,30}@(s\.whatsapp\.net|lid)$/.test(String(remoteJid || "")) ? String(remoteJid) : jidFor(to);
    let reference = { id: oldestId, fromMe: oldestFromMe, timestamp: oldestTimestampMs };
    if (continueFrom) {
      const previous = onDemandRequests.get(userId, String(continueFrom));
      // Só continua um pedido DESTA conversa (mesmo contato) que já trouxe uma mensagem de referência.
      if (!previous || previous.to !== String(to || "") || !previous.oldest) {
        failure = "no_anchor";
        throw Object.assign(new Error("Não há uma mensagem anterior para continuar a busca."), { code: "NO_ANCHOR" });
      }
      jid = previous.oldest.chatJid || previous.chatJid;
      reference = { id: previous.oldest.id, fromMe: previous.oldest.fromMe, timestamp: previous.oldest.seconds };
    }
    failure = "bad_ref";
    const built = buildOnDemandRequest({ chatJid: jid, oldestId: reference.id, oldestFromMe: reference.fromMe, oldestTimestamp: reference.timestamp, count: count || ON_DEMAND_MAX_COUNT });
    failure = "send_error";
    const meJid = jidNormalizedUser(sock.authState?.creds?.me?.id || sock.user?.id || "");
    if (!meJid) throw new Error("Sessão sem identificação do próprio número.");
    const requestId = await sock.relayMessage(meJid, built.message, built.relayOptions);
    onDemandRequests.start(userId, requestId, { to, chatJid: jid, count: built.count });
    telemetry.record(userId, "history_sync", {
      reason: "req_sent",
      cycleId: requestId,
      kind: jid.endsWith("@lid") ? "lid" : "pn",
      trigger: continueFrom ? "continue" : "first",
      attempt: built.count
    });
    return { requested: true, requestId, count: built.count };
  } catch (error) {
    telemetry.record(userId, "history_sync", {
      reason: "req_failed",
      detail: error?.code === "NOT_CONNECTED" ? "not_connected" : failure,
      trigger: continueFrom ? "continue" : "first"
    });
    throw error;
  }
}

// Andamento de um pedido (para a tela): contagens e o horário da mais antiga recebida — sem conteúdo nem telefone.
export function getOlderHistoryStatus(userId, requestId) {
  return onDemandRequests.status(userId, String(requestId || ""));
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

// Foto de perfil do contato (2026-10-09, pedido do dono): só a URL que o próprio WhatsApp devolve (a mesma que o
// celular mostra; respeita a privacidade do contato — escondida = null). Nunca envia nada ao contato. O CRM baixa a
// imagem e guarda; a URL do WhatsApp expira em poucos dias.
// Online / visto por último (só leitura). Pede ao WhatsApp no máximo 1 vez por minuto por contato e devolve o que
// estiver guardado. lastSeen só vem quando o contato não esconde o "visto por último".
export async function getContactPresence(userId, { to }) {
  const sock = connectedSocket(userId);
  const jid = jidFor(to);
  const phone = presencePhone(userId, jid);
  const key = `${userId}|${phone}`;
  const now = Date.now();
  if (now - (presenceAsked.get(key) || 0) > 60_000) {
    presenceAsked.set(key, now);
    if (presenceAsked.size > PRESENCE_LIMIT) presenceAsked.delete(presenceAsked.keys().next().value);
    try {
      await Promise.race([sock.presenceSubscribe(jid), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))]);
    } catch { /* sem resposta: devolve o que houver */ }
    // A resposta chega por evento (presence.update): espera um pouco por ela.
    for (let i = 0; i < 10 && !presences.has(key); i += 1) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const cached = presences.get(key) || null;
  return { state: cached?.state || null, lastSeen: cached?.lastSeen || null, at: cached?.at || null };
}

export async function getProfilePictureUrl(userId, { to }) {
  const sock = connectedSocket(userId);
  const jid = jidFor(to);
  try {
    const url = await Promise.race([
      sock.profilePictureUrl(jid, "image"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000))
    ]);
    return { url: url || null };
  } catch (error) {
    // 401/404 = foto escondida ou inexistente: não é erro.
    const status = error?.output?.statusCode || error?.data || 0;
    if (status === 401 || status === 404 || /not-authorized|item-not-found/i.test(String(error?.message || ""))) return { url: null };
    throw error;
  }
}
