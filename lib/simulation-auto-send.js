import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { canonicalWhatsappPhone, phoneLookupCandidates } from "./phone-utils";
import { findDoNotContactInboundBlock } from "./client-phone-lookup";
import { findInternalTeamPhone } from "./internal-phones";
import { isChatDisabled } from "./chat-control";
import { getSiteBaseUrl } from "./admin-profiles";
import { findOwnerUserId } from "./simulation-registrations";
import { getSimulation } from "./simulations";
import { countPresentationScenes, ensurePresentation, presentationUrl } from "./simulation-presentation";
import { buildPresentationSendMessage } from "./simulation-presentation-send.mjs";
import { logClientJourneyEvent } from "./client-journey";
import { OFFICIAL_SESSION_KEY } from "./whatsapp-chat-scope.mjs";
import { dispatchSlots, normalizeSlot } from "./whatsapp-session-slots.mjs";
import { getTimeGreeting } from "./daily-report";
import {
  AUTO_FOLLOWUP_EVENTS,
  AUTO_FOLLOWUP_KIND,
  AUTO_SEND_DELAY_MS,
  AUTO_SEND_EVENTS,
  AUTO_SEND_LOOKBACK_MS,
  AUTO_SIMULATION_SEND_KIND,
  FINAL_AUTO_SEND_EVENTS,
  FINAL_AUTO_FOLLOWUP_EVENTS,
  autoFollowupCancelReason,
  autoFollowupClaimKey,
  autoFollowupDueAt,
  autoFollowupJourneyText,
  autoSendClaimKey,
  autoSendJourneyText,
  buildAutoFollowupText,
  isOfficialWindowOpen,
  autoSendSkipReason,
  closedWindowRoute,
  decideAutoSendChannel,
  isWaitReason
} from "./simulation-auto-send-core.mjs";

// Envio automático da simulação automática (SIM-AUTO-ENVIO — REGRA OFICIAL DE NEGÓCIO, dono, 2026-10-23). Regras puras em
// lib/simulation-auto-send-core.mjs. O cadastro novo do formulário com simulação automática grava o evento "programado"
// (scheduleAutoSimulationSend, chamado por app/api/simulation-registrations); o cron whatsapp-flows (a cada 2 min) decide
// o canal e envia SÓ o link da apresentação (mesma mensagem do envio manual). Reserva por cadastro no índice único de
// whatsapp_messages.meta_message_id (sendReservedAutomationMessage): nunca dois envios para o mesmo cadastro, falha nunca
// reenviada. Mensagem de AUTOMAÇÃO: não marca "Em atendimento", não é contato humano nem pontua.

const SYSTEM_ACTOR = { email: "sistema", name: "Sistema", role: "automacao" };
const MAX_CASES_PER_RUN = 15;
// Cada envio aquece a prévia (até 8 s): no máximo 3 envios por rodada para caber no tempo do cron (55 s).
const MAX_SENDS_PER_RUN = 3;

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

/** Marca o cadastro NOVO com simulação automática para o envio automático (evento "programado" na linha do tempo). */
export async function scheduleAutoSimulationSend(registrationId) {
  if (!registrationId) return;
  await logClientJourneyEvent({
    clientId: registrationId,
    eventType: AUTO_SEND_EVENTS.scheduled,
    actor: SYSTEM_ACTOR,
    details: { text: autoSendJourneyText("scheduled") }
  });
}

/**
 * Quantas simulações saíram automaticamente desde `sinceIso` (eventos "simulation_auto_sent" da linha do tempo). Leitura
 * para o bom dia do Henry ("já enviei a simulação para Y"). Global (o Henry é só do dono). Lança em erro de leitura —
 * quem chama decide (nunca um zero falso).
 */
export async function countAutoSimulationSendsSince(sinceIso) {
  const { count, error } = await db().from("client_journey_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", AUTO_SEND_EVENTS.sent)
    .gte("occurred_at", sinceIso);
  if (error) throw error;
  return count || 0;
}

async function recordOutcome(registrationId, outcome, { channel = "", reason = "", extra = {} } = {}) {
  await logClientJourneyEvent({
    clientId: registrationId,
    eventType: AUTO_SEND_EVENTS[outcome],
    actor: SYSTEM_ACTOR,
    details: { text: autoSendJourneyText(outcome, { channel, reason }), ...(channel ? { channel } : {}), ...(reason ? { reason } : {}), ...extra }
  });
}

// Casos abertos: "programado" dentro da janela de tentativas, sem evento final.
async function loadOpenCases(now) {
  const since = new Date(now.getTime() - AUTO_SEND_LOOKBACK_MS).toISOString();
  const until = new Date(now.getTime() - AUTO_SEND_DELAY_MS).toISOString();
  const { data, error } = await db().from("client_journey_events")
    .select("client_id, occurred_at").eq("event_type", AUTO_SEND_EVENTS.scheduled)
    .gte("occurred_at", since).lte("occurred_at", until)
    .order("occurred_at", { ascending: true }).limit(300);
  if (error) throw error;
  const ids = [...new Set((data || []).map((row) => row.client_id).filter(Boolean))];
  if (!ids.length) return { ids: [], pendingReasons: new Map() };
  const { data: events, error: eventsError } = await db().from("client_journey_events")
    .select("client_id, event_type, details").in("client_id", ids)
    .in("event_type", [...FINAL_AUTO_SEND_EVENTS, AUTO_SEND_EVENTS.pending]);
  if (eventsError) throw eventsError;
  const closed = new Set();
  const pendingReasons = new Map();
  for (const row of events || []) {
    if (FINAL_AUTO_SEND_EVENTS.includes(row.event_type)) closed.add(row.client_id);
    else {
      if (!pendingReasons.has(row.client_id)) pendingReasons.set(row.client_id, new Set());
      pendingReasons.get(row.client_id).add(row.details?.reason || "");
    }
  }
  return { ids: ids.filter((id) => !closed.has(id)), pendingReasons };
}

async function loadRegistration(id) {
  const { data, error } = await db().from("simulation_registrations")
    .select("id, full_name, phone, phone_normalized, status, responsible_user_id, private_contact_at")
    .eq("id", id).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadLatestSimulation(registrationId) {
  const { data, error } = await db().from("simulations").select("id")
    .eq("registration_id", registrationId).order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0]?.id ? getSimulation(data[0].id) : null;
}

// Conversas em que o CLIENTE escreveu: a do Oficial (pelo card ou pelo telefone) e a do número do corretor responsável.
async function loadInboundConversations(registration, phone) {
  const candidates = phoneLookupCandidates(phone);
  const columns = "id, contact_phone, last_inbound_at, session_key, session_slot";
  const [byClient, byPhone, broker] = await Promise.all([
    db().from("whatsapp_conversations").select(columns).eq("client_id", registration.id).eq("session_key", OFFICIAL_SESSION_KEY)
      .is("deleted_at", null).is("private_at", null).not("last_inbound_at", "is", null).order("last_inbound_at", { ascending: false }).limit(1),
    db().from("whatsapp_conversations").select(columns).in("contact_phone", candidates).eq("session_key", OFFICIAL_SESSION_KEY)
      .is("deleted_at", null).is("private_at", null).not("last_inbound_at", "is", null).order("last_inbound_at", { ascending: false }).limit(1),
    registration.responsible_user_id
      ? db().from("whatsapp_conversations").select(columns).in("contact_phone", candidates).eq("session_key", registration.responsible_user_id)
        .is("deleted_at", null).is("private_at", null).not("last_inbound_at", "is", null).order("last_inbound_at", { ascending: false }).limit(1)
      : Promise.resolve({ data: [] })
  ]);
  for (const result of [byClient, byPhone, broker]) if (result.error) throw result.error;
  const official = [...(byClient.data || []), ...(byPhone.data || [])]
    .sort((a, b) => new Date(b.last_inbound_at) - new Date(a.last_inbound_at))[0] || null;
  const brokerRow = broker.data?.[0] || null;
  return {
    official: official ? { conversationId: official.id, lastInboundAt: official.last_inbound_at, contactPhone: official.contact_phone } : null,
    broker: brokerRow ? { conversationId: brokerRow.id, lastInboundAt: brokerRow.last_inbound_at, slot: normalizeSlot(brokerRow.session_slot) || 1, contactPhone: brokerRow.contact_phone } : null
  };
}

async function hasConnectedDispatchNumber(userId) {
  if (!userId) return false;
  const { data, error } = await db().from("whatsapp_individual_sessions").select("user_id, slot, status, dispatch_enabled").eq("user_id", userId);
  if (error) throw error;
  return dispatchSlots(data || []).length > 0;
}

// Roleta do caso "Oficial com a janela fechada" (dono, 2026-10-23): on-line com WhatsApp conectado pela roleta de sempre
// (assignRoundRobinLead). [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] corretor desconectado (off-line ou sem WhatsApp
// conectado) NUNCA recebe cliente da roleta: ninguém on-line → ninguém recebe (o envio fica pendente e o cliente segue
// onde está — fila de espera da roleta, se estiver nela — até alguém ficar on-line). Antes ia ao conectado off-line.
async function pickClosedWindowBroker() {
  const distribution = await import("./lead-distribution");
  const roulette = await distribution.assignRoundRobinLead();
  if (roulette.brokerId) return { brokerId: roulette.brokerId, tier: roulette.tier || "online", skipped: roulette.skippedNames || [] };
  return null;
}

// Mesma gravação da entrega da fila de espera da roleta (reassignPendingRouletteLeads): responsável, histórico da roleta
// (o "de quem" abre a conversa anterior, FUN-15h), linha do tempo e aviso "Novo lead para você".
async function assignBroker(registration, pick) {
  const now = new Date().toISOString();
  const { error } = await db().from("simulation_registrations").update({
    responsible_user_id: pick.brokerId,
    pending_distribution_at: null,
    responsible_changed_at: now,
    ...(registration.responsible_user_id ? { previous_responsible_user_id: registration.responsible_user_id } : {})
  }).eq("id", registration.id);
  if (error) throw error;
  const { recordLeadDistributionHistory } = await import("./lead-distribution");
  await recordLeadDistributionHistory({
    registration: { id: registration.id, fullName: registration.full_name },
    eventType: "assigned",
    fromUserId: registration.responsible_user_id || null,
    toUserId: pick.brokerId,
    details: { presenceTier: pick.tier, skipped: pick.skipped, source: "simulacao_automatica_janela_fechada" }
  }).catch((historyError) => console.warn("[simulacao-automatica-envio] histórico da roleta não gravado:", historyError?.message || historyError));
  await logClientJourneyEvent({ clientId: registration.id, eventType: "responsible_assigned", actor: SYSTEM_ACTOR, details: { source: "simulacao_automatica_janela_fechada", brokerId: pick.brokerId } });
  const { error: notifyError } = await db().from("crm_notifications").insert({
    recipient_user_id: pick.brokerId,
    client_id: registration.id,
    title: "Novo lead para você",
    description: `${registration.full_name || "Um cliente"} veio pelo WhatsApp oficial e foi enviado(a) para você pela roleta. A simulação sai pelo seu WhatsApp.`,
    notification_type: "new_client",
    scheduled_at: now
  });
  if (notifyError) console.warn("[simulacao-automatica-envio] aviso ao corretor não gravado:", notifyError.message || notifyError);
}

async function buildLink(simulation) {
  const result = await ensurePresentation({ simulation, userId: "" });
  if (!result?.schemaReady || !result.presentation?.token) return "";
  const base = getSiteBaseUrl().replace(/[/]$/, "");
  const link = presentationUrl(result.presentation.token, base);
  // Mesmo aquecimento do envio manual (prévia grande no WhatsApp); nunca bloqueia mais de 8 s.
  await Promise.race([
    Promise.allSettled([fetch(`${link}/og`, { cache: "no-store" }), fetch(link, { cache: "no-store", headers: { "User-Agent": "WhatsApp/2" } })]),
    new Promise((resolve) => setTimeout(resolve, 8000))
  ]).catch(() => {});
  return `${link}?p=${Math.random().toString(36).slice(2, 8)}`;
}

async function sendOfficial({ registration, conversation, simulation }) {
  if (await isChatDisabled()) return { status: "pending", reason: "chat_desligado" };
  if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) return { status: "pending", reason: "oficial_nao_configurado" };
  const link = await buildLink(simulation);
  if (!link) return { status: "pending", reason: "link_indisponivel" };
  const text = buildPresentationSendMessage({ link });
  const [{ sendReservedAutomationMessage }, { sendWhatsappTextMessage }] = await Promise.all([import("./whatsapp-form-reminder"), import("./whatsapp-master")]);
  const outcome = await sendReservedAutomationMessage({
    conversationId: conversation.conversationId,
    claimKey: autoSendClaimKey(registration.id),
    text,
    metadata: { kind: AUTO_SIMULATION_SEND_KIND, client_id: registration.id, simulation_id: simulation.id },
    logLabel: "[simulacao-automatica-envio]",
    send: () => sendWhatsappTextMessage({ to: conversation.contactPhone, text })
  });
  return { status: outcome, conversationId: conversation.conversationId, audioChannel: { kind: "official", conversationId: conversation.conversationId, contactPhone: conversation.contactPhone } };
}

async function sendIndividual({ registration, senderId, slot = null, conversation = null, phone, simulation, sentThisRun }) {
  if (!senderId) return { status: "pending", reason: "sem_dono" };
  if (sentThisRun.has(senderId)) return { status: "wait", reason: "ja_enviado_nesta_rodada" };
  const { individualAutomationSendGate } = await import("./daily-goal-auto");
  const gate = await individualAutomationSendGate(senderId, { slot });
  if (!gate.ok) return isWaitReason(gate.reason) ? { status: "wait", reason: gate.reason } : { status: "pending", reason: gate.reason };
  const { ensureIndividualConversation } = await import("./whatsapp-individual-inbound");
  const target = conversation || await ensureIndividualConversation(phone, senderId, gate.slot);
  const conversationId = target?.conversationId || target?.id;
  const to = target?.contactPhone || target?.contact_phone || phone;
  if (!conversationId) return { status: "pending", reason: "whatsapp_nao_conectado" };
  const link = await buildLink(simulation);
  if (!link) return { status: "pending", reason: "link_indisponivel" };
  const text = buildPresentationSendMessage({ link });
  const [{ sendReservedAutomationMessage }, { sendIndividualMessage }] = await Promise.all([import("./whatsapp-form-reminder"), import("./whatsapp-individual")]);
  sentThisRun.add(senderId);
  const outcome = await sendReservedAutomationMessage({
    conversationId,
    claimKey: autoSendClaimKey(registration.id),
    text,
    metadata: { kind: AUTO_SIMULATION_SEND_KIND, client_id: registration.id, simulation_id: simulation.id },
    individual: true,
    owner: senderId,
    slot: gate.slot,
    logLabel: "[simulacao-automatica-envio]",
    send: () => sendIndividualMessage(senderId, { to, text, slot: gate.slot })
  });
  if (outcome === "enviado") {
    // Liga a conversa nova ao card do cliente pelo telefone (mesma função das mensagens automáticas, WA-26).
    const { applyAutoPrivacy } = await import("./whatsapp-auto-private");
    await applyAutoPrivacy(conversationId).catch((error) => console.warn("[simulacao-automatica-envio] vínculo da conversa:", error?.message || error));
  }
  return { status: outcome, conversationId, audioChannel: { kind: "individual", conversationId, contactPhone: to, senderId, slot: gate.slot } };
}

async function handleCase(registrationId, { now, sentThisRun, pendingReasons }) {
  const registration = await loadRegistration(registrationId);
  const phone = canonicalWhatsappPhone(registration?.phone_normalized || registration?.phone || "");
  const [doNotContactReason, teamPhone, simulation] = registration && phone
    ? await Promise.all([findDoNotContactInboundBlock(phone, registration.id), findInternalTeamPhone(phone), loadLatestSimulation(registration.id)])
    : [null, null, null];
  const skip = autoSendSkipReason({ registration, doNotContactReason, isTeamPhone: Boolean(teamPhone), phone, hasScenes: simulation ? countPresentationScenes(simulation) > 0 : false });
  if (skip) {
    await recordOutcome(registrationId, "skipped", { reason: simulation || skip !== "simulacao_sem_valores" ? skip : "sem_simulacao" });
    return { outcome: "skipped", reason: skip };
  }

  const conversations = await loadInboundConversations(registration, phone);
  const channel = decideAutoSendChannel({ official: conversations.official, broker: conversations.broker, nowMs: now.getTime() });
  let result;
  let channelName = channel.kind;
  if (channel.kind === "official") {
    result = await sendOfficial({ registration, conversation: conversations.official, simulation });
  } else if (channel.kind === "broker") {
    result = await sendIndividual({ registration, senderId: registration.responsible_user_id, slot: channel.slot, conversation: conversations.broker, phone, simulation, sentThisRun });
  } else if (channel.kind === "official_closed") {
    const route = closedWindowRoute({ responsibleId: registration.responsible_user_id, responsibleConnected: await hasConnectedDispatchNumber(registration.responsible_user_id) });
    let senderId = route.brokerId || "";
    channelName = route.kind;
    if (route.kind === "roulette") {
      const pick = await pickClosedWindowBroker();
      if (!pick) result = { status: "pending", reason: "sem_corretor_conectado" };
      else {
        await assignBroker(registration, pick);
        senderId = pick.brokerId;
      }
    }
    if (!result) result = await sendIndividual({ registration, senderId, phone, simulation, sentThisRun });
  } else {
    result = await sendIndividual({ registration, senderId: await findOwnerUserId(), phone, simulation, sentThisRun });
  }

  if (result.status === "enviado") {
    await recordOutcome(registrationId, "sent", { channel: channelName, extra: { conversationId: result.conversationId || null } });
    // Lembrete de 20 min "ficou alguma dúvida?" pela MESMA conversa (dono, 2026-10-23); sai só se ninguém falar antes.
    await scheduleAutoSimulationFollowup(registrationId, result.audioChannel);
    // Áudio com a voz do dono (VOZ-1, dono 2026-10-23) logo DEPOIS do link ("aí em cima tem um link"), pela mesma conversa.
    // Desligado, sem voz/créditos ou modelo não aprovado = só pula; nunca lança nem muda o resultado do link.
    const { sendSimulationVoiceAudio } = await import("./client-voice-audio");
    await sendSimulationVoiceAudio({ registration, channel: result.audioChannel });
    return { outcome: "sent", channel: channelName };
  }
  if (result.status === "falha_envio") {
    await recordOutcome(registrationId, "failed", { channel: channelName, reason: "falha_envio" });
    return { outcome: "failed", channel: channelName };
  }
  if (result.status === "ja_enviado") return { outcome: "already_sent" };
  if (result.status === "pending" && !pendingReasons.get(registrationId)?.has(result.reason)) {
    await recordOutcome(registrationId, "pending", { channel: channelName, reason: result.reason });
  }
  return { outcome: result.status, reason: result.reason, channel: channelName };
}

// ── Lembrete "ficou alguma dúvida?" 20 min depois do envio (dono, 2026-10-23; regras puras no core). ──
const MAX_FOLLOWUP_CASES_PER_RUN = 20;
const MAX_FOLLOWUP_SENDS_PER_RUN = 5;
const FOLLOWUP_EXPIRY_MARGIN_MS = 2 * 60 * 60 * 1000; // casos que passaram do prazo ainda são lidos para registrar o fim

async function recordFollowupOutcome(registrationId, outcome, { reason = "", extra = {} } = {}) {
  await logClientJourneyEvent({
    clientId: registrationId,
    eventType: AUTO_FOLLOWUP_EVENTS[outcome],
    actor: SYSTEM_ACTOR,
    details: { text: autoFollowupJourneyText(outcome, { reason }), ...(reason ? { reason } : {}), ...extra }
  });
}

/** Programa o lembrete pela MESMA conversa do envio (`channel` = audioChannel do envio). Uma vez por cadastro. */
async function scheduleAutoSimulationFollowup(registrationId, channel) {
  if (!registrationId || !channel?.conversationId) return;
  const sentAt = new Date().toISOString();
  await logClientJourneyEvent({
    clientId: registrationId,
    eventType: AUTO_FOLLOWUP_EVENTS.scheduled,
    actor: SYSTEM_ACTOR,
    details: {
      text: autoFollowupJourneyText("scheduled"),
      sentAt,
      dueAt: autoFollowupDueAt(sentAt)?.toISOString() || null,
      conversationId: channel.conversationId,
      channel: channel.kind === "official" ? "official" : "individual",
      ...(channel.kind === "official" ? {} : { senderId: channel.senderId, slot: channel.slot || 1 })
    }
  });
}

async function loadOpenFollowups(now) {
  const since = new Date(now.getTime() - AUTO_SEND_LOOKBACK_MS - FOLLOWUP_EXPIRY_MARGIN_MS).toISOString();
  const { data, error } = await db().from("client_journey_events")
    .select("client_id, occurred_at, details").eq("event_type", AUTO_FOLLOWUP_EVENTS.scheduled)
    .gte("occurred_at", since).order("occurred_at", { ascending: true }).limit(300);
  if (error) throw error;
  const ids = [...new Set((data || []).map((row) => row.client_id).filter(Boolean))];
  if (!ids.length) return [];
  const { data: finals, error: finalsError } = await db().from("client_journey_events")
    .select("client_id").in("client_id", ids).in("event_type", FINAL_AUTO_FOLLOWUP_EVENTS);
  if (finalsError) throw finalsError;
  const closed = new Set((finals || []).map((row) => row.client_id));
  const seen = new Set();
  return (data || []).filter((row) => row.client_id && !closed.has(row.client_id) && !seen.has(row.client_id) && seen.add(row.client_id));
}

// Tudo o que aconteceu depois do envio: mensagens de QUALQUER conversa do cliente (pelo card ou pelo telefone) e mudanças
// de status.
async function loadActivitySince(registration, phone, sinceIso) {
  const candidates = phoneLookupCandidates(phone);
  const [byClient, byPhone, statusRows] = await Promise.all([
    db().from("whatsapp_conversations").select("id").eq("client_id", registration.id).limit(50),
    candidates.length ? db().from("whatsapp_conversations").select("id").in("contact_phone", candidates).limit(50) : Promise.resolve({ data: [] }),
    db().from("client_status_history").select("changed_by").eq("client_id", registration.id).gt("changed_at", sinceIso).limit(50)
  ]);
  for (const result of [byClient, byPhone, statusRows]) if (result.error) throw result.error;
  const conversationIds = [...new Set([...(byClient.data || []), ...(byPhone.data || [])].map((row) => row.id))];
  let messagesAfter = [];
  if (conversationIds.length) {
    const { data, error } = await db().from("whatsapp_messages")
      .select("direction, sender_type, status, message_type, metadata")
      .in("conversation_id", conversationIds).neq("direction", "internal").gt("message_at", sinceIso).limit(100);
    if (error) throw error;
    messagesAfter = data || [];
  }
  return { messagesAfter, statusChangesAfter: statusRows.data || [] };
}

async function handleFollowup(event, { now, sentThisRun }) {
  const registrationId = event.client_id;
  const details = event.details || {};
  const sinceIso = details.sentAt || event.occurred_at;
  const dueAt = autoFollowupDueAt(sinceIso);
  if (!dueAt || now < dueAt) return { outcome: "not_due" };
  if (now.getTime() - new Date(event.occurred_at).getTime() > AUTO_SEND_LOOKBACK_MS) {
    await recordFollowupOutcome(registrationId, "skipped", { reason: "prazo_esgotado" });
    return { outcome: "skipped" };
  }

  const registration = await loadRegistration(registrationId);
  const phone = canonicalWhatsappPhone(registration?.phone_normalized || registration?.phone || "");
  const [doNotContactReason, teamPhone] = registration && phone
    ? await Promise.all([findDoNotContactInboundBlock(phone, registration.id), findInternalTeamPhone(phone)])
    : [null, null];
  const stop = autoSendSkipReason({ registration, doNotContactReason, isTeamPhone: Boolean(teamPhone), phone, hasScenes: true });
  const cancel = stop || autoFollowupCancelReason(await loadActivitySince(registration, phone, sinceIso));
  if (cancel) {
    await recordFollowupOutcome(registrationId, "cancelled", { reason: cancel });
    return { outcome: "cancelled", reason: cancel };
  }

  const { data: conversation, error } = await db().from("whatsapp_conversations")
    .select("id, contact_phone, last_inbound_at, deleted_at").eq("id", details.conversationId || "").maybeSingle();
  if (error) throw error;
  if (!conversation || conversation.deleted_at) {
    await recordFollowupOutcome(registrationId, "skipped", { reason: "conversa_indisponivel" });
    return { outcome: "skipped" };
  }

  // Saudação na hora do envio REAL (madrugada adiada para as 8 h = "Bom dia").
  const text = buildAutoFollowupText(registration.full_name, getTimeGreeting());
  const metadata = { kind: AUTO_FOLLOWUP_KIND, client_id: registration.id };
  const { sendReservedAutomationMessage } = await import("./whatsapp-form-reminder");
  let outcome;
  if (details.channel === "official") {
    if (await isChatDisabled()) return { outcome: "wait", reason: "chat_desligado" };
    if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) return { outcome: "wait", reason: "oficial_nao_configurado" };
    if (!isOfficialWindowOpen(conversation.last_inbound_at, now.getTime())) {
      await recordFollowupOutcome(registrationId, "skipped", { reason: "janela_fechada" });
      return { outcome: "skipped" };
    }
    const { sendWhatsappTextMessage } = await import("./whatsapp-master");
    outcome = await sendReservedAutomationMessage({
      conversationId: conversation.id, claimKey: autoFollowupClaimKey(registration.id), text, metadata,
      logLabel: "[simulacao-automatica-lembrete]",
      send: () => sendWhatsappTextMessage({ to: conversation.contact_phone, text })
    });
  } else {
    const senderId = details.senderId || "";
    if (!senderId) {
      await recordFollowupOutcome(registrationId, "skipped", { reason: "conversa_indisponivel" });
      return { outcome: "skipped" };
    }
    if (sentThisRun.has(senderId)) return { outcome: "wait", reason: "ja_enviado_nesta_rodada" };
    const { individualAutomationSendGate } = await import("./daily-goal-auto");
    const gate = await individualAutomationSendGate(senderId, { slot: details.slot || 1 });
    // Cadência anti-ban/número fora do ar: tenta de novo nas próximas rodadas (até o prazo, depois "skipped").
    if (!gate.ok) return { outcome: "wait", reason: gate.reason };
    const { sendIndividualMessage } = await import("./whatsapp-individual");
    sentThisRun.add(senderId);
    outcome = await sendReservedAutomationMessage({
      conversationId: conversation.id, claimKey: autoFollowupClaimKey(registration.id), text, metadata,
      individual: true, owner: senderId, slot: gate.slot,
      logLabel: "[simulacao-automatica-lembrete]",
      send: () => sendIndividualMessage(senderId, { to: conversation.contact_phone, text, slot: gate.slot })
    });
  }
  if (outcome === "enviado") {
    await recordFollowupOutcome(registrationId, "sent", { extra: { conversationId: conversation.id, channel: details.channel } });
    return { outcome: "sent" };
  }
  // Reserva já existente (outra rodada) ou falha: nunca reenvia.
  await recordFollowupOutcome(registrationId, "skipped", { reason: outcome === "ja_enviado" ? "ja_enviado" : "falha_envio" });
  return { outcome: outcome === "ja_enviado" ? "skipped" : "failed" };
}

async function processAutoSimulationFollowups({ now, sentThisRun }) {
  const events = await loadOpenFollowups(now);
  const summary = { open: events.length, sent: 0, cancelled: 0, skipped: 0, failed: 0, waiting: 0, errors: 0 };
  let handled = 0;
  for (const event of events) {
    if (summary.sent + summary.failed >= MAX_FOLLOWUP_SENDS_PER_RUN || handled >= MAX_FOLLOWUP_CASES_PER_RUN) break;
    try {
      const result = await handleFollowup(event, { now, sentThisRun });
      if (result.outcome === "not_due") continue;
      handled += 1;
      if (result.outcome === "wait") summary.waiting += 1;
      else if (summary[result.outcome] !== undefined) summary[result.outcome] += 1;
    } catch (error) {
      handled += 1;
      summary.errors += 1;
      console.error("[simulacao-automatica-lembrete] falha no caso", event.client_id, error?.message || error);
    }
  }
  return summary;
}

/** Uma rodada (cron whatsapp-flows, a cada 2 min). Nunca envia duas vezes para o mesmo cadastro. */
export async function processAutoSimulationSends({ now = new Date() } = {}) {
  const { ids, pendingReasons } = await loadOpenCases(now);
  const summary = { open: ids.length, sent: 0, failed: 0, skipped: 0, pending: 0, waiting: 0, errors: 0 };
  const sentThisRun = new Set();
  for (const id of ids.slice(0, MAX_CASES_PER_RUN)) {
    if (summary.sent + summary.failed >= MAX_SENDS_PER_RUN) break;
    try {
      const result = await handleCase(id, { now, sentThisRun, pendingReasons });
      if (result.outcome === "sent") summary.sent += 1;
      else if (result.outcome === "failed") summary.failed += 1;
      else if (result.outcome === "skipped") summary.skipped += 1;
      else if (result.outcome === "pending") summary.pending += 1;
      else if (result.outcome === "wait") summary.waiting += 1;
    } catch (error) {
      summary.errors += 1;
      console.error("[simulacao-automatica-envio] falha no caso", id, error?.message || error);
    }
  }
  // Lembrete de 20 min, na mesma rodada (mesma cadência por número: `sentThisRun` compartilhado). Erro aparece no resumo/log.
  try {
    summary.followups = await processAutoSimulationFollowups({ now, sentThisRun });
  } catch (error) {
    console.error("[simulacao-automatica-lembrete] falha na rodada", error?.message || error);
    summary.followups = { error: "Falha ao processar o lembrete da simulação." };
  }
  return summary;
}
