import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getSupabaseAdminClient } from "./supabase";
import { endRestrictionIfConnected, recordSessionEvent } from "./whatsapp-restriction";
import { normalizeDisconnectCode } from "./whatsapp-restriction-core.mjs";
import { notifyBrokerOwnConnection, notifyWhatsappConnectionChange } from "./whatsapp-connection-alert";
import { assertWhatsappAccessAllowed } from "./whatsapp-access";
import { CHAT_INDIVIDUAL_DISABLED_CODE, CHAT_INDIVIDUAL_DISABLED_MESSAGE, isIndividualChatSendDisabled } from "./chat-control";

// Chat híbrido (2026-10-08): reação/edição/exclusão (só o Chat usa) pela sessão pessoal ficam desativadas junto com o envio.
async function assertChatActionsOnPersonalSession() {
  if (await isIndividualChatSendDisabled()) {
    const error = new Error(CHAT_INDIVIDUAL_DISABLED_MESSAGE);
    error.status = 403;
    error.code = CHAT_INDIVIDUAL_DISABLED_CODE;
    throw error;
  }
}
import { notifyWhatsappSessionAttention } from "./whatsapp-session-attention";
import { aggregateSessionStatus, buildSessionId, dispatchSessionStatus, dispatchSlots, groupSessionRowsByUser, isSlotDispatchEnabled, normalizeSlot, sanitizeSlotLabel } from "./whatsapp-session-slots.mjs";

// WhatsApp INDIVIDUAL — camada de transporte nova (sessão pessoal de cada
// corretor, via QR Code, através do microsserviço externo em
// whatsapp-individual-service/). O Next.js NUNCA fala com o WhatsApp
// diretamente aqui: só lê o estado gravado pelo microsserviço em
// whatsapp_individual_sessions (service_role) e chama o microsserviço por
// HTTP para conectar/desconectar/enviar. Credenciais do Baileys
// (session_creds_encrypted) nunca são lidas nem expostas por este arquivo.

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

function serviceBaseUrl() {
  return String(process.env.WHATSAPP_INDIVIDUAL_SERVICE_URL || "").replace(/\/+$/, "");
}

function serviceSecret() {
  return process.env.WHATSAPP_INDIVIDUAL_SERVICE_SECRET || "";
}

export function isIndividualServiceConfigured() {
  return Boolean(serviceBaseUrl() && serviceSecret());
}

// Valida o header X-Service-Secret que o microsserviço manda em
// /api/webhooks/whatsapp-individual — comparação em tempo constante (mesmo
// padrão de lib/whatsapp-master.js para o webhook da Meta).
export function verifyIndividualServiceSecret(headerValue) {
  const expected = serviceSecret();
  if (!expected || !headerValue) return false;
  const left = Buffer.from(String(headerValue));
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Aplica uma mudança de status/QR reportada pelo microsserviço
// (POST .../whatsapp-individual, type:'status'). O microsserviço também
// grava direto no banco (service_role) — este endpoint é a via HTTP redundante
// pedida no requisito, mesma tabela, sem custo de manter dois formatos.
// `slot` (2026-10-08): 1 = Número 1 (linha de sempre), 2 = Número 2 do mesmo corretor.
export async function applyIndividualSessionStatus(userId, { status, phoneNumber, qrData, qrExpiresAt, pairingCode, error, statusCode, output, slot = 1 } = {}) {
  if (!userId) throw new Error("userId não informado.");
  const sessionSlot = normalizeSlot(slot) || 1;
  const patch = { user_id: userId, slot: sessionSlot, updated_at: new Date().toISOString() };
  if (status) patch.status = status;
  if (phoneNumber !== undefined) patch.phone_number = phoneNumber || null;
  if (qrData !== undefined) patch.qr_data = qrData || null;
  if (qrExpiresAt !== undefined) patch.qr_expires_at = qrExpiresAt || null;
  if (pairingCode !== undefined) patch.pairing_code = pairingCode || null;
  if (error !== undefined) patch.last_error = error || null;
  // Instrumentação (T-20/T-23): só REGISTRA o código de desconexão do Baileys; nenhuma decisão depende dele.
  const disconnectCode = normalizeDisconnectCode(statusCode);
  if (disconnectCode !== null) { patch.last_disconnect_code = disconnectCode; patch.last_disconnect_at = new Date().toISOString(); }
  if (status === "connected") { patch.last_connected_at = new Date().toISOString(); patch.pairing_code = null; }
  // Código de pareamento só vale enquanto a sessão está aguardando por ele —
  // qualquer outro status (QR, caiu, reconectando...) apaga o código
  // guardado, senão a tela continuava mostrando um código morto (2026-10-02).
  if (status && status !== "pairing_code_required" && pairingCode === undefined) patch.pairing_code = null;
  // Linha ANTERIOR (só para o alerta de conexão da gestora): lida antes de gravar para comparar a mudança real.
  const prevRow = status ? await getIndividualSessionRow(userId, sessionSlot).catch(() => null) : null;
  const { error: upsertError } = await db().from("whatsapp_individual_sessions").upsert(patch, { onConflict: "user_id,slot" });
  if (upsertError) throw upsertError;
  // Alerta informativo SÓ para a gestora do corretor (conectado <-> desconectado; 'reconnecting' não conta). Por número.
  if (status && prevRow) await notifyWhatsappConnectionChange(userId, prevRow, status, { slot: sessionSlot });
  // Alerta DIRETO ao próprio corretor (WA-20, 2026-10-10): Central + push, só ele, por número. Nunca lança.
  if (status && prevRow) await notifyBrokerOwnConnection(userId, prevRow, { status, error, slot: sessionSlot });
  // Sessão que exige intervenção humana (needs_attention / retry_limit / qr_expired de conta já usada) -> gestora + admin.
  // Aceita prevRow nulo (primeira linha da conta pode já nascer em 'error'); nunca lança.
  if (status) await notifyWhatsappSessionAttention(userId, prevRow, { status, error, slot: sessionSlot });
  // Voltou a conectar: a restrição informada pelo corretor encerra sozinha
  // (motivo automatic_connected). Falha aqui nunca derruba o status da sessão.
  // Evento de sessão é por corretor (tabela sem coluna de número): o Número 2 vai marcado no texto.
  const eventMessage = sessionSlot === 2 && error ? `[Número 2] ${error}` : error;
  if (disconnectCode !== null || (error && status && status !== "connected")) await recordSessionEvent(userId, { status, statusCode: disconnectCode, message: eventMessage, output }).catch(() => {});
  if (status === "connected") await endRestrictionIfConnected(userId, "connected").catch((e) => console.error("Falha ao encerrar restrição do WhatsApp:", e?.message || e));
}

async function callService(path, { method = "GET", body, timeoutMs = 20000 } = {}) {
  const base = serviceBaseUrl();
  const secret = serviceSecret();
  if (!base || !secret) {
    const error = new Error("O serviço de WhatsApp individual ainda não está configurado (Railway).");
    error.code = "SERVICE_NOT_CONFIGURED";
    throw error;
  }
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Service-Secret": secret },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    // status propagado no erro (não só a mensagem) — a automação da Meta
    // Diária usa isso pra classificar falha de infraestrutura x de
    // destinatário sem depender só de casar texto (lib/daily-goal-auto.js,
    // classifySendError em lib/daily-goal-auto-core.mjs). 409 = sessão não
    // conectada (error.code=NOT_CONNECTED no microsserviço, ver server.js).
    const error = new Error(payload?.error || `Falha ao comunicar com o serviço de WhatsApp individual (status ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

const SESSION_ROW_COLUMNS = "user_id, slot, label, dispatch_enabled, status, phone_number, qr_data, qr_expires_at, pairing_code, last_connected_at, last_error, updated_at";

// Linha crua de whatsapp_individual_sessions de UM número do usuário (sem as
// credenciais cifradas — nunca selecionadas aqui). null se esse número nunca
// foi configurado. `slot` 1 = Número 1 (o de sempre), 2 = Número 2.
export async function getIndividualSessionRow(userId, slot = 1) {
  if (!userId) return null;
  const { data, error } = await db()
    .from("whatsapp_individual_sessions")
    .select(SESSION_ROW_COLUMNS)
    .eq("user_id", userId)
    .eq("slot", normalizeSlot(slot) || 1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Todas as linhas (até 2 números) do usuário, ordenadas pelo número.
export async function listIndividualSessionRows(userId) {
  if (!userId) return [];
  const { data, error } = await db()
    .from("whatsapp_individual_sessions")
    .select(SESSION_ROW_COLUMNS)
    .eq("user_id", userId)
    .order("slot", { ascending: true });
  if (error) throw error;
  return data || [];
}

// Status "do corretor" (Prospecção, Meta Diária manual, card do cliente...): conectado se QUALQUER um
// dos números estiver conectado; senão o do Número 1. Só com o Número 1 = exatamente o de antes.
export async function getIndividualSessionStatusForUser(userId) {
  return aggregateSessionStatus(await listIndividualSessionRows(userId));
}

// Status de UM número (Chat: a conversa responde sempre pelo número em que está).
export async function getIndividualSessionStatusForSlot(userId, slot = 1) {
  const row = await getIndividualSessionRow(userId, slot);
  return row?.status || null;
}

// Automação da Meta Diária: só números conectados E com "Usar para disparo" ligado.
// -> { status: 'connected' | outro, slots: [1|2...], rows }
export async function getDispatchSessionState(userId) {
  const rows = await listIndividualSessionRows(userId);
  return { status: dispatchSessionStatus(rows), slots: dispatchSlots(rows), rows };
}

export async function getDispatchSessionStatusForUser(userId) {
  return (await getDispatchSessionState(userId)).status;
}

// Status de vários corretores de uma vez (aba "Corretores" da Supervisão do
// Chat, getChatBrokerCards) — mesmo padrão de busca em lote já usado no
// resto do Chat, evita N+1 (uma chamada por corretor). Agregado por corretor.
export async function listIndividualSessionStatuses(userIds) {
  const grouped = await listIndividualSessionRowsByUser(userIds);
  return new Map([...grouped].map(([userId, rows]) => [userId, aggregateSessionStatus(rows)]));
}

// Linhas de vários corretores agrupadas: Map(userId -> [{ slot, status, label, ... }]).
export async function listIndividualSessionRowsByUser(userIds) {
  if (!userIds?.length) return new Map();
  const { data, error } = await db()
    .from("whatsapp_individual_sessions")
    .select("user_id, slot, label, dispatch_enabled, status, phone_number, last_connected_at, last_error")
    .in("user_id", userIds);
  if (error) throw error;
  return groupSessionRowsByUser(data || []);
}

// Apelido e chave "Usar para disparo" de UM número do PRÓPRIO usuário (a rota só passa auth.profile.id).
// Cria a linha do número se ainda não existir (ex.: apelido antes de conectar o Número 2).
export async function updateIndividualSessionSettings(userId, slot, { label, dispatchEnabled } = {}) {
  const sessionSlot = normalizeSlot(slot);
  if (!userId || !sessionSlot) throw new Error("Número de WhatsApp inválido.");
  const patch = { user_id: userId, slot: sessionSlot, updated_at: new Date().toISOString() };
  if (label !== undefined) patch.label = sanitizeSlotLabel(label) || null;
  if (dispatchEnabled !== undefined) patch.dispatch_enabled = Boolean(dispatchEnabled);
  const { error } = await db().from("whatsapp_individual_sessions").upsert(patch, { onConflict: "user_id,slot" });
  if (error) throw error;
  return getIndividualSessionRow(userId, sessionSlot);
}

export { isSlotDispatchEnabled };

// Credenciais cifradas do Baileys (session_creds_encrypted) — únicas duas
// funções que tocam essa coluna. Só o microsserviço chama isso, via
// app/api/webhooks/whatsapp-individual/state (X-Service-Secret): o host da
// Railway não guarda SUPABASE_SERVICE_ROLE_KEY, só o Next.js tem esse
// segredo, então o microsserviço lê/grava credenciais por HTTP em vez de
// falar com o Supabase direto.
export async function readIndividualSessionCredsInternal(userId, slot = 1) {
  const { data, error } = await db()
    .from("whatsapp_individual_sessions")
    .select("session_creds_encrypted")
    .eq("user_id", userId)
    .eq("slot", normalizeSlot(slot) || 1)
    .maybeSingle();
  if (error) throw error;
  return data?.session_creds_encrypted || null;
}

export async function writeIndividualSessionCredsInternal(userId, encrypted, slot = 1) {
  const { error } = await db()
    .from("whatsapp_individual_sessions")
    .upsert({ user_id: userId, slot: normalizeSlot(slot) || 1, session_creds_encrypted: encrypted ?? null, updated_at: new Date().toISOString() }, { onConflict: "user_id,slot" });
  if (error) throw error;
}

// Ids de SESSÃO (no formato do microsserviço: Número 1 = user_id, Número 2 =
// "<user_id>:2") com credenciais salvas — o microsserviço chama isso UMA VEZ ao
// subir (server.js) para retomar sozinho as sessões que existiam antes do
// restart/redeploy (o socket em memória se perde a cada deploy, mas as
// credenciais persistidas continuam válidas; sem isso o corretor ficava
// "conectado" no banco mas sem socket vivo nenhum até clicar Reconectar).
export async function listIndividualSessionsWithCreds() {
  const { data, error } = await db()
    .from("whatsapp_individual_sessions")
    .select("user_id, slot")
    .not("session_creds_encrypted", "is", null);
  if (error) throw error;
  return (data || []).map((row) => buildSessionId(row.user_id, row.slot));
}

// Linhas em estado TRANSITÓRIO ('reconnecting'/'connecting') — o microsserviço as reconcilia
// (reconcile.js): um desses estados sem nenhuma tentativa real em andamento não pode ficar
// gravado para sempre. Só id/status/datas (nunca credenciais). `user_id` sai no formato de id
// de SESSÃO do microsserviço (Número 2 = "<user_id>:2").
export async function listTransientIndividualSessionRows() {
  const { data, error } = await db()
    .from("whatsapp_individual_sessions")
    .select("user_id, slot, status, updated_at")
    .in("status", ["reconnecting", "connecting"]);
  if (error) throw error;
  return (data || []).map((row) => ({ user_id: buildSessionId(row.user_id, row.slot), status: row.status, updated_at: row.updated_at }));
}

function sessionPath(userId, slot, action) {
  return `/sessions/${encodeURIComponent(buildSessionId(userId, slot))}/${action}`;
}

// phoneNumber (opcional): pareamento por código numérico em vez de QR — só
// tem efeito numa sessão nova, sem credenciais salvas ainda (o microsserviço
// ignora se já estiver registrada).
export async function connectIndividualSession(userId, phoneNumber, { slot = 1 } = {}) {
  // Acesso WhatsApp bloqueado pelo admin/gestor (2026-10-04): não inicia/reinicia sessão nem gera QR.
  await assertWhatsappAccessAllowed(userId);
  // Pareamento por código espera o socket abrir antes de pedir o código
  // (até ~10s) — limite maior que o padrão, abaixo dos 30s da rota.
  return callService(sessionPath(userId, slot, "connect"), { method: "POST", body: phoneNumber ? { phoneNumber } : undefined, timeoutMs: 28000 });
}

export async function disconnectIndividualSession(userId, { slot = 1 } = {}) {
  return callService(sessionPath(userId, slot, "disconnect"), { method: "POST" });
}

export async function fetchIndividualSessionStatusFromService(userId, { slot = 1 } = {}) {
  return callService(sessionPath(userId, slot, "status"));
}

// { to, text, media? } -> { messageId }. Usada por lib/whatsapp-chat.js
// (sendChatMessage/deliverChatMessage) quando pickSendChannel decidiu
// 'individual' — o campo é `messageId` (não `waMessageId`) porque quem chama
// trata os dois canais de forma uniforme (sent.messageId), igual ao retorno
// do canal oficial (sendWhatsappTextMessage). `media` (opcional) = { kind:
// 'image'|'document'|'audio', url, mimeType, fileName } — mesma URL pública
// já usada pelo canal oficial, o Baileys baixa e envia sozinho.
// quoted (opcional): { id, fromMe, text } — resposta citada a uma mensagem.
// `slot` (2026-10-08): por qual número do corretor sai (1 = o de sempre).
export async function sendIndividualMessage(userId, { to, text, media, quoted, slot = 1 } = {}) {
  // ÚLTIMA barreira do controle de acesso (2026-10-04): cron, Chat, automações e qualquer chamador passam por aqui.
  await assertWhatsappAccessAllowed(userId);
  const result = await callService(sessionPath(userId, slot, "send"), { method: "POST", body: { to, text, media, quoted } });
  const messageId = String(result?.waMessageId || result?.id || "");
  if (!messageId) throw new Error("O WhatsApp não retornou o ID da mensagem enviada.");
  return { messageId, remoteJid: String(result?.remoteJid || "") };
}

// Reação (emoji vazio remove), edição e "apagar para todos" pela sessão
// individual (2026-10-02). Editar/apagar só valem para mensagem que ESTE
// número enviou — quem chama confere o autor e o prazo
// (lib/whatsapp-message-actions.mjs).
export async function reactIndividualMessage(userId, { to, targetId, targetFromMe, emoji, slot = 1 }) {
  await assertChatActionsOnPersonalSession();
  await assertWhatsappAccessAllowed(userId);
  return callService(sessionPath(userId, slot, "react"), { method: "POST", body: { to, targetId, targetFromMe, emoji } });
}

export async function editIndividualMessage(userId, { to, targetId, text, slot = 1 }) {
  await assertChatActionsOnPersonalSession();
  await assertWhatsappAccessAllowed(userId);
  return callService(sessionPath(userId, slot, "edit"), { method: "POST", body: { to, targetId, text } });
}

export async function deleteIndividualMessageForEveryone(userId, { to, targetId, slot = 1 }) {
  await assertChatActionsOnPersonalSession();
  await assertWhatsappAccessAllowed(userId);
  return callService(sessionPath(userId, slot, "delete"), { method: "POST", body: { to, targetId } });
}

// Foto de perfil do contato (2026-10-09): só leitura, não envia nada ao contato. `url` null = foto escondida/ausente.
// Online / visto por último do contato (só leitura, 2026-10-09): { state, lastSeen, at }.
export async function fetchIndividualPresence(userId, { to, slot = 1 }) {
  return callService(sessionPath(userId, slot, "presence"), { method: "POST", body: { to }, timeoutMs: 12000 });
}

export async function fetchIndividualProfilePicture(userId, { to, slot = 1 }) {
  return callService(sessionPath(userId, slot, "profile-picture"), { method: "POST", body: { to }, timeoutMs: 12000 });
}
