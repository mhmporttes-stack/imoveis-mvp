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
import { dispatchSlots, groupSessionRowsByUser, normalizeSlot } from "./whatsapp-session-slots.mjs";
import {
  AUTO_SEND_DELAY_MS,
  AUTO_SEND_EVENTS,
  AUTO_SEND_LOOKBACK_MS,
  AUTO_SIMULATION_SEND_KIND,
  FINAL_AUTO_SEND_EVENTS,
  autoSendClaimKey,
  autoSendJourneyText,
  autoSendSkipReason,
  closedWindowRoute,
  decideAutoSendChannel,
  isWaitReason,
  pickOfflineConnectedBroker
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

// Roleta do caso "Oficial com a janela fechada" (dono, 2026-10-23): on-line com WhatsApp conectado pela roleta de sempre;
// ninguém on-line → corretor da roleta com WhatsApp conectado mesmo off-line (ativo, distribuição ligada, sem restrição
// aberta, liberado da pausa de 10 min da ROL-2h), reservado com claimRouletteReceipt.
async function pickClosedWindowBroker() {
  const distribution = await import("./lead-distribution");
  const roulette = await distribution.assignRoundRobinLead();
  if (roulette.brokerId) return { brokerId: roulette.brokerId, tier: roulette.tier || "online", skipped: roulette.skippedNames || [] };
  const { data: users, error } = await db().from("admin_users").select("id, last_roulette_received_at")
    .eq("status", "active").eq("lead_distribution_enabled", true).in("role", ["admin", "manager", "broker", "associate"]);
  if (error) throw error;
  const ids = (users || []).map((user) => user.id);
  if (!ids.length) return null;
  const [{ data: sessions, error: sessionsError }, { data: restricted, error: restrictedError }] = await Promise.all([
    db().from("whatsapp_individual_sessions").select("user_id, slot, status, dispatch_enabled").in("user_id", ids),
    db().from("whatsapp_restrictions").select("user_id").in("user_id", ids).is("ended_at", null)
  ]);
  if (sessionsError) throw sessionsError;
  if (restrictedError) throw restrictedError;
  const restrictedIds = new Set((restricted || []).map((row) => row.user_id));
  const connected = [...groupSessionRowsByUser(sessions || []).entries()]
    .filter(([userId, rows]) => !restrictedIds.has(userId) && dispatchSlots(rows).length > 0).map(([userId]) => userId);
  const free = new Set(await distribution.filterRouletteCooldownFreeIds(connected));
  const lastById = new Map((users || []).map((user) => [user.id, user.last_roulette_received_at]));
  const remaining = connected.filter((id) => free.has(id)).map((id) => ({ id, lastReceivedAt: lastById.get(id) }));
  while (remaining.length) {
    const brokerId = pickOfflineConnectedBroker(remaining);
    if (await distribution.claimRouletteReceipt(brokerId)) return { brokerId, tier: "conectado_offline", skipped: [] };
    remaining.splice(remaining.findIndex((item) => item.id === brokerId), 1);
  }
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
  return summary;
}
