import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getSupabaseAdminClient } from "./supabase";
import { endRestrictionIfConnected, recordSessionEvent } from "./whatsapp-restriction";
import { normalizeDisconnectCode } from "./whatsapp-restriction-core.mjs";
import { notifyWhatsappConnectionChange } from "./whatsapp-connection-alert";

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
export async function applyIndividualSessionStatus(userId, { status, phoneNumber, qrData, qrExpiresAt, pairingCode, error, statusCode, output } = {}) {
  if (!userId) throw new Error("userId não informado.");
  const patch = { user_id: userId, updated_at: new Date().toISOString() };
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
  const prevRow = status ? await getIndividualSessionRow(userId).catch(() => null) : null;
  const { error: upsertError } = await db().from("whatsapp_individual_sessions").upsert(patch, { onConflict: "user_id" });
  if (upsertError) throw upsertError;
  // Alerta informativo SÓ para a gestora do corretor (conectado <-> desconectado; 'reconnecting' não conta).
  if (status && prevRow) await notifyWhatsappConnectionChange(userId, prevRow, status);
  // Voltou a conectar: a restrição informada pelo corretor encerra sozinha
  // (motivo automatic_connected). Falha aqui nunca derruba o status da sessão.
  if (disconnectCode !== null || (error && status && status !== "connected")) await recordSessionEvent(userId, { status, statusCode: disconnectCode, message: error, output }).catch(() => {});
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

// Linha crua de whatsapp_individual_sessions do usuário (sem as credenciais
// cifradas — nunca selecionadas aqui). null se ele nunca configurou sessão.
export async function getIndividualSessionRow(userId) {
  if (!userId) return null;
  const { data, error } = await db()
    .from("whatsapp_individual_sessions")
    .select("user_id, status, phone_number, qr_data, qr_expires_at, pairing_code, last_connected_at, last_error, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Só o status (usado pela decisão de canal de envio, lib/whatsapp-chat.js) —
// leitura direta da tabela, sem chamar o microsserviço a cada mensagem.
export async function getIndividualSessionStatusForUser(userId) {
  const row = await getIndividualSessionRow(userId);
  return row?.status || null;
}

// Status de vários corretores de uma vez (aba "Corretores" da Supervisão do
// Chat, getChatBrokerCards) — mesmo padrão de busca em lote já usado no
// resto do Chat, evita N+1 (uma chamada por corretor).
export async function listIndividualSessionStatuses(userIds) {
  if (!userIds?.length) return new Map();
  const { data, error } = await db()
    .from("whatsapp_individual_sessions")
    .select("user_id, status")
    .in("user_id", userIds);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.user_id, row.status]));
}

// Credenciais cifradas do Baileys (session_creds_encrypted) — únicas duas
// funções que tocam essa coluna. Só o microsserviço chama isso, via
// app/api/webhooks/whatsapp-individual/state (X-Service-Secret): o host da
// Railway não guarda SUPABASE_SERVICE_ROLE_KEY, só o Next.js tem esse
// segredo, então o microsserviço lê/grava credenciais por HTTP em vez de
// falar com o Supabase direto.
export async function readIndividualSessionCredsInternal(userId) {
  const { data, error } = await db()
    .from("whatsapp_individual_sessions")
    .select("session_creds_encrypted")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.session_creds_encrypted || null;
}

export async function writeIndividualSessionCredsInternal(userId, encrypted) {
  const { error } = await db()
    .from("whatsapp_individual_sessions")
    .upsert({ user_id: userId, session_creds_encrypted: encrypted ?? null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
}

// user_ids com credenciais salvas — o microsserviço chama isso UMA VEZ ao
// subir (server.js) para retomar sozinho as sessões que existiam antes do
// restart/redeploy (o socket em memória se perde a cada deploy, mas as
// credenciais persistidas continuam válidas; sem isso o corretor ficava
// "conectado" no banco mas sem socket vivo nenhum até clicar Reconectar).
export async function listIndividualSessionsWithCreds() {
  const { data, error } = await db()
    .from("whatsapp_individual_sessions")
    .select("user_id")
    .not("session_creds_encrypted", "is", null);
  if (error) throw error;
  return (data || []).map((row) => row.user_id);
}

// phoneNumber (opcional): pareamento por código numérico em vez de QR — só
// tem efeito numa sessão nova, sem credenciais salvas ainda (o microsserviço
// ignora se já estiver registrada).
export async function connectIndividualSession(userId, phoneNumber) {
  // Pareamento por código espera o socket abrir antes de pedir o código
  // (até ~10s) — limite maior que o padrão, abaixo dos 30s da rota.
  return callService(`/sessions/${encodeURIComponent(userId)}/connect`, { method: "POST", body: phoneNumber ? { phoneNumber } : undefined, timeoutMs: 28000 });
}

export async function disconnectIndividualSession(userId) {
  return callService(`/sessions/${encodeURIComponent(userId)}/disconnect`, { method: "POST" });
}

export async function fetchIndividualSessionStatusFromService(userId) {
  return callService(`/sessions/${encodeURIComponent(userId)}/status`);
}

// { to, text, media? } -> { messageId }. Usada por lib/whatsapp-chat.js
// (sendChatMessage/deliverChatMessage) quando pickSendChannel decidiu
// 'individual' — o campo é `messageId` (não `waMessageId`) porque quem chama
// trata os dois canais de forma uniforme (sent.messageId), igual ao retorno
// do canal oficial (sendWhatsappTextMessage). `media` (opcional) = { kind:
// 'image'|'document'|'audio', url, mimeType, fileName } — mesma URL pública
// já usada pelo canal oficial, o Baileys baixa e envia sozinho.
// quoted (opcional): { id, fromMe, text } — resposta citada a uma mensagem.
export async function sendIndividualMessage(userId, { to, text, media, quoted } = {}) {
  const result = await callService(`/sessions/${encodeURIComponent(userId)}/send`, { method: "POST", body: { to, text, media, quoted } });
  const messageId = String(result?.waMessageId || result?.id || "");
  if (!messageId) throw new Error("O WhatsApp não retornou o ID da mensagem enviada.");
  return { messageId, remoteJid: String(result?.remoteJid || "") };
}

// Reação (emoji vazio remove), edição e "apagar para todos" pela sessão
// individual (2026-10-02). Editar/apagar só valem para mensagem que ESTE
// número enviou — quem chama confere o autor e o prazo
// (lib/whatsapp-message-actions.mjs).
export async function reactIndividualMessage(userId, { to, targetId, targetFromMe, emoji }) {
  return callService(`/sessions/${encodeURIComponent(userId)}/react`, { method: "POST", body: { to, targetId, targetFromMe, emoji } });
}

export async function editIndividualMessage(userId, { to, targetId, text }) {
  return callService(`/sessions/${encodeURIComponent(userId)}/edit`, { method: "POST", body: { to, targetId, text } });
}

export async function deleteIndividualMessageForEveryone(userId, { to, targetId }) {
  return callService(`/sessions/${encodeURIComponent(userId)}/delete`, { method: "POST", body: { to, targetId } });
}
