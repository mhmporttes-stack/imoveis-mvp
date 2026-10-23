import "server-only";
import { createHash } from "node:crypto";
import { getSupabaseAdminClient } from "./supabase";
import { recordAiUsage } from "./ai-usage";
import { getTimeGreeting } from "./daily-report";
import { canonicalWhatsappPhone } from "./phone-utils";
import { findDoNotContactInboundBlock } from "./client-phone-lookup";
import { findInternalTeamPhone } from "./internal-phones";
import { logClientJourneyEvent } from "./client-journey";
import { findChatMediaAt, storeChatMediaAt } from "./media-storage";
import { isDistributionFirstMessageAllowed } from "./distribution-first-message-core.mjs";
import { AUTO_SEND_EVENTS, autoSendSkipReason, isWaitReason } from "./simulation-auto-send-core.mjs";
import {
  buildElevenLabsSpeechRequest,
  estimateElevenLabsCostUsd,
  isElevenLabsQuotaExceeded
} from "./henry-voice-providers.mjs";
import {
  CLIENT_VOICE_AUDIO_FEATURE,
  CLIENT_VOICE_AUDIO_SETTING_ID,
  VOICE_AUDIO_EVENTS,
  VOICE_AUDIO_KINDS,
  VOICE_AUDIO_MAX_BYTES,
  VOICE_AUDIO_MIME,
  VOICE_AUDIO_OUTPUT_FORMAT,
  VOICE_MOMENTS,
  VOICE_PREVIEW_NAMES,
  VOICE_VARIANTS,
  WELCOME_LOOKBACK_MS,
  applyClientVoiceAudioPatch,
  isNewRouletteLead,
  isOggAudio,
  normalizeClientVoiceAudioSettings,
  planVoiceAudio,
  renderVoiceTemplate,
  speakableFirstName,
  templateError,
  voiceAudioClaimKey,
  voiceAudioJourneyText
} from "./client-voice-audio-core.mjs";

// Áudio com a VOZ clonada do dono para o cliente (VOZ-1 — REGRA OFICIAL DE NEGÓCIO, dono, 2026-10-23). Regras puras em
// lib/client-voice-audio-core.mjs. Nasce DESLIGADO (crm_settings `client_voice_audio`). Dois momentos:
//  - simulação: chamado por lib/simulation-auto-send.js logo DEPOIS de o link sair, pelo MESMO canal/conversa;
//  - boas-vindas: cron whatsapp-flows (processWelcomeVoiceAudios), pelo WhatsApp do corretor que recebeu o lead da roleta.
// Travas: um áudio por momento por cadastro (reserva voice-audio:<momento>:<id> no índice único de
// whatsapp_messages.meta_message_id); falha nunca reenviada; sem voz/créditos/modelo aprovado = só pula o áudio (o link
// nunca depende dele); mensagem de AUTOMAÇÃO (não é atendimento humano). Cache: o arquivo é guardado pelo hash de
// voz + modelo + texto final — o mesmo texto nunca é pago duas vezes.

const SYSTEM_ACTOR = { email: "sistema", name: "Sistema", role: "automacao" };
const ELEVENLABS_TIMEOUT_MS = 15000;
const MAX_WELCOME_CASES_PER_RUN = 10;
const MAX_WELCOME_SENDS_PER_RUN = 2;
// Modelo de mais qualidade para voz clonada (o Henry usa o flash, mais rápido). [COMPORTAMENTO ATUAL — A CONFIRMAR]
const voiceModel = () => String(process.env.ELEVENLABS_CLIENT_AUDIO_MODEL || "").trim() || "eleven_multilingual_v2";

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

export class VoiceAudioError extends Error {
  constructor(message, reason, status = 502) {
    super(message);
    this.reason = reason;
    this.status = status;
  }
}

// ---------- Configuração (tela: Automações › Áudio com voz, só admin geral) ----------

async function readRawSettings() {
  const { data, error } = await db().from("crm_settings").select("setting_value").eq("id", CLIENT_VOICE_AUDIO_SETTING_ID).maybeSingle();
  if (error) throw error;
  return data?.setting_value || {};
}

export async function getClientVoiceAudioSettings() {
  return normalizeClientVoiceAudioSettings(await readRawSettings());
}

/** Alteração da tela (ver applyClientVoiceAudioPatch). Lança VoiceAudioError(400) com a frase do erro. */
export async function updateClientVoiceAudioSettings(auth, patch) {
  const result = applyClientVoiceAudioPatch(await readRawSettings(), patch);
  if (result.error) throw new VoiceAudioError(result.error, "invalido", 400);
  const { error } = await db().from("crm_settings").upsert({
    id: CLIENT_VOICE_AUDIO_SETTING_ID,
    setting_value: result.settings,
    updated_by: auth?.profile?.id || null,
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
  return result.settings;
}

export function clientVoiceAudioEnvironment() {
  return { hasKey: Boolean(String(process.env.ELEVENLABS_API_KEY || "").trim()), model: voiceModel() };
}

// ---------- Geração (ElevenLabs) com cache ----------

function cachePath(voiceId, model, text) {
  const hash = createHash("sha256").update(`${voiceId}|${model}|${VOICE_AUDIO_OUTPUT_FORMAT}|${text}`).digest("hex").slice(0, 40);
  return `voice-audio/${hash}.ogg`;
}

/**
 * Áudio Ogg/Opus do texto final na voz `voiceId`. Devolve { url, cached }. Erros viram VoiceAudioError com motivo
 * (sem_chave, creditos_esgotados, voz_indisponivel, formato_invalido) — quem chama decide (envio: só pula o áudio).
 */
export async function synthesizeVoiceAudio({ text, voiceId, clientId = null, triggeredBy = null }) {
  const model = voiceModel();
  const path = cachePath(voiceId, model, text);
  const cached = await findChatMediaAt(path);
  if (cached) return { url: cached, cached: true };
  const token = String(process.env.ELEVENLABS_API_KEY || "").trim();
  if (!token) throw new VoiceAudioError("Chave da ElevenLabs não configurada (ELEVENLABS_API_KEY).", "sem_chave", 503);
  const request = buildElevenLabsSpeechRequest({ text, voiceId, modelId: model, outputFormat: VOICE_AUDIO_OUTPUT_FORMAT });
  const costUsd = estimateElevenLabsCostUsd(text, model);
  let bytes;
  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: { "xi-api-key": token, "content-type": "application/json", accept: "audio/ogg" },
      body: JSON.stringify(request.body),
      cache: "no-store",
      signal: AbortSignal.timeout(ELEVENLABS_TIMEOUT_MS)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const quota = isElevenLabsQuotaExceeded(payload);
      throw new VoiceAudioError(
        quota ? "Os créditos da ElevenLabs acabaram." : `A ElevenLabs respondeu com erro (${response.status}).`,
        quota ? "creditos_esgotados" : "voz_indisponivel",
        quota ? 402 : 502
      );
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    const failure = error instanceof VoiceAudioError ? error : new VoiceAudioError("Não consegui falar com a ElevenLabs agora.", "voz_indisponivel");
    await recordAiUsage({ feature: CLIENT_VOICE_AUDIO_FEATURE, model, clientId, triggeredBy, success: false, errorMessage: failure.message });
    throw failure;
  }
  await recordAiUsage({ feature: CLIENT_VOICE_AUDIO_FEATURE, model, clientId, triggeredBy, costUsd, success: true });
  if (!isOggAudio(bytes)) throw new VoiceAudioError("A ElevenLabs não devolveu áudio Ogg/Opus.", "formato_invalido");
  if (bytes.length > VOICE_AUDIO_MAX_BYTES) throw new VoiceAudioError("Áudio grande demais para nota de voz: encurte o texto.", "formato_invalido", 422);
  const url = await storeChatMediaAt({ path, buffer: Buffer.from(bytes), contentType: "audio/ogg" });
  return { url, cached: false };
}

/** "Ouvir prévia" da tela: gera (ou reaproveita) o áudio com um nome de exemplo. Nunca envia a ninguém. */
export async function previewClientVoiceAudio(auth, { moment, variant, text, voiceId }) {
  if (!VOICE_MOMENTS.includes(moment) || !VOICE_VARIANTS.includes(variant)) throw new VoiceAudioError("Modelo inválido.", "invalido", 400);
  const settings = await getClientVoiceAudioSettings();
  const chosenVoice = String(voiceId || settings.voiceId || "").trim();
  if (!/^[A-Za-z0-9]{10,40}$/.test(chosenVoice)) throw new VoiceAudioError("Informe o voice_id da voz clonada para ouvir a prévia.", "sem_voice_id", 400);
  const template = String(text ?? settings.templates[moment][variant].text);
  const invalid = templateError(moment, variant, template);
  if (invalid) throw new VoiceAudioError(invalid, "invalido", 400);
  const finalText = renderVoiceTemplate(template, {
    saudacao: getTimeGreeting(),
    cliente: VOICE_PREVIEW_NAMES[variant],
    corretor: speakableFirstName(auth?.profile?.name) || "Matheus"
  });
  const audio = await synthesizeVoiceAudio({ text: finalText, voiceId: chosenVoice, triggeredBy: auth?.profile?.id || null });
  return { ...audio, text: finalText };
}

// ---------- Envio ----------

async function recordOutcome(registrationId, outcome, { moment, reason = "", extra = {} } = {}) {
  await logClientJourneyEvent({
    clientId: registrationId,
    eventType: VOICE_AUDIO_EVENTS[outcome],
    actor: SYSTEM_ACTOR,
    details: { text: voiceAudioJourneyText(outcome, { moment, reason }), moment, ...(reason ? { reason } : {}), ...extra }
  });
}

/**
 * Prepara o áudio de um momento: plano (liga/desliga, voz, modelo aprovado) + geração. Devolve { url, variant } ou
 * { skip: reason } — "desligado" não vai para a linha do tempo (a funcionalidade inteira está desligada).
 */
async function prepareAudio({ moment, registration, brokerName = "" }) {
  const settings = await getClientVoiceAudioSettings();
  const plan = planVoiceAudio({ settings, moment, clientName: registration.full_name, brokerName, greeting: getTimeGreeting() });
  if (!plan.ok) return { skip: plan.reason, variant: plan.variant };
  try {
    const audio = await synthesizeVoiceAudio({ text: plan.text, voiceId: settings.voiceId, clientId: registration.id });
    return { url: audio.url, variant: plan.variant };
  } catch (error) {
    if (error instanceof VoiceAudioError) return { skip: error.reason, variant: plan.variant };
    throw error;
  }
}

async function sendReservedAudio({ moment, registration, variant, url, conversationId, individual, owner = null, slot = 1, send }) {
  const { sendReservedAutomationMessage } = await import("./whatsapp-form-reminder");
  return sendReservedAutomationMessage({
    conversationId,
    claimKey: voiceAudioClaimKey(moment, registration.id),
    text: "",
    messageType: "audio",
    preview: "[Áudio]",
    metadata: { kind: VOICE_AUDIO_KINDS[moment], client_id: registration.id, variant, voice: true, media: { url, mime: "audio/ogg", name: "audio.ogg" } },
    individual,
    owner,
    slot,
    logLabel: "[audio-voz]",
    send
  });
}

/**
 * Áudio da SIMULAÇÃO, logo depois do link (SIM-AUTO-ENVIO), pela MESMA conversa e canal. Vai junto do link, que já passou
 * pela cadência anti-ban do número (individualAutomationSendGate) — não pede outra vaga. Nunca lança: o link já saiu.
 * channel: { kind: "official", conversationId, contactPhone } | { kind: "individual", conversationId, contactPhone, senderId, slot }.
 */
export async function sendSimulationVoiceAudio({ registration, channel }) {
  try {
    if (!registration?.id || !channel?.conversationId || !channel.contactPhone) return { outcome: "skipped", reason: "sem_conversa" };
    const audio = await prepareAudio({ moment: "simulation", registration });
    if (audio.skip) {
      if (audio.skip !== "desligado") await recordOutcome(registration.id, "skipped", { moment: "simulation", reason: audio.skip });
      return { outcome: "skipped", reason: audio.skip };
    }
    const official = channel.kind === "official";
    const [{ sendWhatsappMessagePayload }, { sendIndividualMessage }] = await Promise.all([import("./whatsapp-master"), import("./whatsapp-individual")]);
    const outcome = await sendReservedAudio({
      moment: "simulation",
      registration,
      variant: audio.variant,
      url: audio.url,
      conversationId: channel.conversationId,
      individual: !official,
      owner: official ? null : channel.senderId,
      slot: official ? 1 : channel.slot || 1,
      send: () => official
        ? sendWhatsappMessagePayload({ to: channel.contactPhone, message: { type: "audio", audio: { link: audio.url, voice: true } } })
        : sendIndividualMessage(channel.senderId, { to: channel.contactPhone, media: { kind: "audio", url: audio.url, mimeType: VOICE_AUDIO_MIME, ptt: true }, slot: channel.slot || 1 })
    });
    if (outcome === "enviado") await recordOutcome(registration.id, "sent", { moment: "simulation", extra: { variant: audio.variant, channel: channel.kind } });
    else if (outcome === "falha_envio") await recordOutcome(registration.id, "failed", { moment: "simulation", reason: "falha_envio" });
    return { outcome };
  } catch (error) {
    console.error("[audio-voz] áudio da simulação não enviado:", error?.message || error);
    return { outcome: "error" };
  }
}

// ---------- Boas-vindas do lead novo da roleta (cron whatsapp-flows) ----------

async function loadWelcomeCandidates(settings, now) {
  const enabledMs = Date.parse(settings.enabledAt || "");
  if (!Number.isFinite(enabledMs)) return [];
  const since = new Date(Math.max(enabledMs, now.getTime() - WELCOME_LOOKBACK_MS)).toISOString();
  const { data, error } = await db().from("lead_distribution_history")
    .select("registration_id, created_at").eq("event_type", "assigned").gte("created_at", since)
    .order("created_at", { ascending: true }).limit(100);
  if (error) throw error;
  const ids = [...new Set((data || []).map((row) => row.registration_id).filter(Boolean))];
  if (!ids.length) return [];
  const claimKeys = ids.map((id) => voiceAudioClaimKey("welcome", id));
  const [history, claims, finals] = await Promise.all([
    db().from("lead_distribution_history").select("registration_id, event_type, to_user_id, created_at").in("registration_id", ids).order("created_at", { ascending: true }),
    db().from("whatsapp_messages").select("meta_message_id").in("meta_message_id", claimKeys),
    db().from("client_journey_events").select("client_id").in("client_id", ids)
      .in("event_type", Object.values(VOICE_AUDIO_EVENTS)).eq("details->>moment", "welcome")
  ]);
  for (const result of [history, claims, finals]) if (result.error) throw result.error;
  const done = new Set([
    ...(claims.data || []).map((row) => String(row.meta_message_id).split(":").pop()),
    ...(finals.data || []).map((row) => row.client_id)
  ]);
  const byId = new Map();
  for (const row of history.data || []) {
    const entry = byId.get(row.registration_id) || { firstAssignedAt: null, latest: null };
    if (row.event_type === "assigned" && !entry.firstAssignedAt) entry.firstAssignedAt = row.created_at;
    entry.latest = row;
    byId.set(row.registration_id, entry);
  }
  // Só quem entrou na roleta pela 1ª vez dentro da janela (cliente redistribuído/reativado já teve a 1ª entrega antes).
  return ids.filter((id) => !done.has(id)).map((id) => ({ id, ...byId.get(id) }))
    .filter((item) => item.firstAssignedAt && item.firstAssignedAt >= since);
}

async function brokerSpokeAlready(conversationId) {
  const { data, error } = await db().from("whatsapp_messages").select("id")
    .eq("conversation_id", conversationId).eq("direction", "outbound").eq("sender_type", "user").limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

async function simulationWentThroughBroker(registrationId) {
  const { data, error } = await db().from("client_journey_events").select("details")
    .eq("client_id", registrationId).eq("event_type", AUTO_SEND_EVENTS.sent).limit(5);
  if (error) throw error;
  return (data || []).some((row) => ["broker", "roulette", "responsible"].includes(row.details?.channel));
}

async function handleWelcome(candidate, { now, sentThisRun, enabledAt }) {
  const { data: registration, error } = await db().from("simulation_registrations")
    .select("id, full_name, phone, phone_normalized, status, responsible_user_id, responsible_changed_at, pending_distribution_at, private_contact_at, created_at")
    .eq("id", candidate.id).maybeSingle();
  if (error) throw error;
  if (!registration) return { outcome: "ignored" };
  if (!isNewRouletteLead({ firstAssignedAt: candidate.firstAssignedAt, registrationCreatedAt: registration.created_at, enabledAt, nowMs: now.getTime() })) {
    return { outcome: "ignored" };
  }
  const phone = canonicalWhatsappPhone(registration.phone_normalized || registration.phone || "");
  const [doNotContactReason, teamPhone] = phone
    ? await Promise.all([findDoNotContactInboundBlock(phone, registration.id), findInternalTeamPhone(phone)])
    : [null, null];
  const skip = autoSendSkipReason({ registration, doNotContactReason, isTeamPhone: Boolean(teamPhone), phone, hasScenes: true });
  if (skip) {
    await recordOutcome(registration.id, "skipped", { moment: "welcome", reason: skip });
    return { outcome: "skipped", reason: skip };
  }
  const brokerId = registration.responsible_user_id;
  if (!isDistributionFirstMessageAllowed({ client: registration, latestDistribution: candidate.latest, sessionOwnerId: brokerId })) {
    await recordOutcome(registration.id, "skipped", { moment: "welcome", reason: "nao_veio_da_roleta" });
    return { outcome: "skipped", reason: "nao_veio_da_roleta" };
  }
  if (await simulationWentThroughBroker(registration.id)) {
    await recordOutcome(registration.id, "skipped", { moment: "welcome", reason: "simulacao_enviada_pelo_corretor" });
    return { outcome: "skipped", reason: "simulacao_enviada_pelo_corretor" };
  }
  if (sentThisRun.has(brokerId)) return { outcome: "wait", reason: "ja_enviado_nesta_rodada" };
  // Cadência anti-ban do número do corretor (mesma trava da SIM-AUTO-ENVIO). Qualquer bloqueio aqui só espera a próxima
  // rodada (número pode reconectar); passado o prazo das boas-vindas o caso sai da lista sem enviar.
  const { individualAutomationSendGate } = await import("./daily-goal-auto");
  const gate = await individualAutomationSendGate(brokerId);
  if (!gate.ok) return { outcome: "wait", reason: gate.reason, transient: isWaitReason(gate.reason) };
  const { ensureIndividualConversation } = await import("./whatsapp-individual-inbound");
  const conversation = await ensureIndividualConversation(phone, brokerId, gate.slot);
  const conversationId = conversation?.conversationId || conversation?.id;
  if (!conversationId) return { outcome: "wait", reason: "whatsapp_nao_conectado" };
  if (await brokerSpokeAlready(conversationId)) {
    await recordOutcome(registration.id, "skipped", { moment: "welcome", reason: "corretor_ja_falou" });
    return { outcome: "skipped", reason: "corretor_ja_falou" };
  }
  const { data: broker, error: brokerError } = await db().from("admin_users").select("name").eq("id", brokerId).maybeSingle();
  if (brokerError) throw brokerError;
  const audio = await prepareAudio({ moment: "welcome", registration, brokerName: broker?.name || "" });
  if (audio.skip) {
    if (audio.skip !== "desligado") await recordOutcome(registration.id, "skipped", { moment: "welcome", reason: audio.skip });
    return { outcome: "skipped", reason: audio.skip };
  }
  const to = conversation?.contactPhone || conversation?.contact_phone || phone;
  const { sendIndividualMessage } = await import("./whatsapp-individual");
  sentThisRun.add(brokerId);
  const outcome = await sendReservedAudio({
    moment: "welcome",
    registration,
    variant: audio.variant,
    url: audio.url,
    conversationId,
    individual: true,
    owner: brokerId,
    slot: gate.slot,
    send: () => sendIndividualMessage(brokerId, { to, media: { kind: "audio", url: audio.url, mimeType: VOICE_AUDIO_MIME, ptt: true }, slot: gate.slot })
  });
  if (outcome === "enviado") {
    await recordOutcome(registration.id, "sent", { moment: "welcome", extra: { variant: audio.variant, brokerId } });
    // Liga a conversa nova ao card do cliente pelo telefone (mesma função das demais automações, WA-26).
    const { applyAutoPrivacy } = await import("./whatsapp-auto-private");
    await applyAutoPrivacy(conversationId).catch((linkError) => console.warn("[audio-voz] vínculo da conversa:", linkError?.message || linkError));
    return { outcome: "sent" };
  }
  if (outcome === "falha_envio") {
    await recordOutcome(registration.id, "failed", { moment: "welcome", reason: "falha_envio" });
    return { outcome: "failed" };
  }
  return { outcome };
}

/** Uma rodada das boas-vindas (cron whatsapp-flows, a cada 2 min). Desligado = não lê nada além da configuração. */
export async function processWelcomeVoiceAudios({ now = new Date() } = {}) {
  const settings = await getClientVoiceAudioSettings();
  if (!settings.enabled) return { enabled: false };
  const candidates = await loadWelcomeCandidates(settings, now);
  const summary = { enabled: true, open: candidates.length, sent: 0, failed: 0, skipped: 0, waiting: 0, errors: 0 };
  const sentThisRun = new Set();
  for (const candidate of candidates.slice(0, MAX_WELCOME_CASES_PER_RUN)) {
    if (summary.sent + summary.failed >= MAX_WELCOME_SENDS_PER_RUN) break;
    try {
      const result = await handleWelcome(candidate, { now, sentThisRun, enabledAt: settings.enabledAt });
      if (result.outcome === "sent") summary.sent += 1;
      else if (result.outcome === "failed") summary.failed += 1;
      else if (result.outcome === "skipped") summary.skipped += 1;
      else if (result.outcome === "wait") summary.waiting += 1;
    } catch (error) {
      summary.errors += 1;
      console.error("[audio-voz] boas-vindas: falha no caso", candidate.id, error?.message || error);
    }
  }
  return summary;
}
