import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getSupabaseAdminClient } from "./supabase";

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
export async function applyIndividualSessionStatus(userId, { status, phoneNumber, qrData, qrExpiresAt, pairingCode, error } = {}) {
  if (!userId) throw new Error("userId não informado.");
  const patch = { user_id: userId, updated_at: new Date().toISOString() };
  if (status) patch.status = status;
  if (phoneNumber !== undefined) patch.phone_number = phoneNumber || null;
  if (qrData !== undefined) patch.qr_data = qrData || null;
  if (qrExpiresAt !== undefined) patch.qr_expires_at = qrExpiresAt || null;
  if (pairingCode !== undefined) patch.pairing_code = pairingCode || null;
  if (error !== undefined) patch.last_error = error || null;
  if (status === "connected") { patch.last_connected_at = new Date().toISOString(); patch.pairing_code = null; }
  const { error: upsertError } = await db().from("whatsapp_individual_sessions").upsert(patch, { onConflict: "user_id" });
  if (upsertError) throw upsertError;
}

async function callService(path, { method = "GET", body } = {}) {
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
    signal: AbortSignal.timeout(20000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || `Falha ao comunicar com o serviço de WhatsApp individual (status ${response.status}).`);
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
  return callService(`/sessions/${encodeURIComponent(userId)}/connect`, { method: "POST", body: phoneNumber ? { phoneNumber } : undefined });
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
export async function sendIndividualMessage(userId, { to, text, media } = {}) {
  const result = await callService(`/sessions/${encodeURIComponent(userId)}/send`, { method: "POST", body: { to, text, media } });
  const messageId = String(result?.waMessageId || result?.id || "");
  if (!messageId) throw new Error("O WhatsApp não retornou o ID da mensagem enviada.");
  return { messageId };
}
