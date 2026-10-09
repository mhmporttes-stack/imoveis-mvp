import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { phoneLookupCandidates } from "./phone-utils";
import { findInternalTeamPhone } from "./internal-phones";
import { isChatDisabled, isIndividualChatSendDisabled } from "./chat-control";
import { isWhatsappAccessBlocked } from "./whatsapp-access";
import { conversationSessionOwner } from "./whatsapp-chat-scope.mjs";
import { normalizeSlot } from "./whatsapp-session-slots.mjs";
import { listIndividualSessionRows, sendIndividualMessage } from "./whatsapp-individual";
import { sendWhatsappTextMessage } from "./whatsapp-master";
import { broadcastChatChanged } from "./whatsapp-chat";
import {
  AD_REMINDER_STEPS,
  FORM_REMINDER_BACKLOG_CUTOFF,
  FORM_REMINDER_BACKLOG_DEADLINE_MS,
  FORM_REMINDER_BACKLOG_LOOKBACK_MS,
  FORM_REMINDER_BACKLOG_SENDS_PER_RUN,
  FORM_REMINDER_DELAY_MS,
  FORM_REMINDER_KIND,
  FORM_REMINDER_LOOKBACK_MS,
  buildFormReminderText,
  claimKeysForStep,
  currentReminderStep,
  decideFormReminder,
  formReminderClaimKey,
  latestLinkPerConversation
} from "./whatsapp-form-reminder-core.mjs";

// LEMBRETE DO FORMULÁRIO NÃO PREENCHIDO (regra do dono, 2026-10-09 — BUSINESS_RULES WA-17) e SEQUÊNCIA do cliente do
// anúncio de WhatsApp (1 h, 3 h, 10 h, 23 h — WA-18), no mesmo mecanismo. Roda no cron
// /api/cron/whatsapp-flows (a cada 2 min). Regras de quando envia/não envia: lib/whatsapp-form-reminder-core.mjs.
//
// Idempotência sem tabela nova: a própria linha do lembrete em whatsapp_messages é a "reserva". Ela é inserida ANTES
// do envio com meta_message_id = "form-reminder:<id da mensagem do link>" (lembrete único) ou
// "form-reminder:<id do link>:<etapa>" (sequência do anúncio) (índice único) — duas rodadas nunca enviam
// o mesmo lembrete, e falha/resultado desconhecido nunca é reenviado (a linha fica "failed"). O id da Meta/WhatsApp
// fica em metadata (cloud_message_id / wa_message_id); meta_message_id continua sendo a chave.
// Mensagem AUTOMÁTICA: sender_type "automation" (etiqueta "Automação" no Chat), não marca "Em atendimento", não chama
// registerHumanContact (não é contato humano nem primeiro contato).

const MAX_PER_RUN = 20; // envios por rodada
const MAX_LOADS_PER_RUN = 60; // links avaliados por rodada (cada um lê a conversa)

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

const SITE_HOST_TOKEN = "matheusmachadoimoveis";

// Enquanto o backlog (links anteriores à publicação) ainda pode ter etapas, olha 48 h para trás; depois, 26 h.
function linkLookbackMs(now) {
  const backlogEnds = new Date(FORM_REMINDER_BACKLOG_CUTOFF).getTime() + FORM_REMINDER_BACKLOG_DEADLINE_MS + AD_REMINDER_STEPS.at(-1).delayMs;
  return now.getTime() < backlogEnds ? FORM_REMINDER_BACKLOG_LOOKBACK_MS : FORM_REMINDER_LOOKBACK_MS;
}

async function loadLinkCandidates(now) {
  const since = new Date(now.getTime() - linkLookbackMs(now)).toISOString();
  const until = new Date(now.getTime() - FORM_REMINDER_DELAY_MS).toISOString();
  const pattern = `%${SITE_HOST_TOKEN}%`;
  // Duas consultas (link escrito no texto / botão de link do Fluxo ou do atalho); a regra exata fica no núcleo puro.
  const query = () => db()
    .from("whatsapp_messages")
    .select("id, conversation_id, direction, sender_type, channel, session_user_id, session_slot, body, metadata, status, message_at")
    .eq("direction", "outbound")
    .in("sender_type", ["automation", "user"])
    .neq("status", "failed")
    .gte("message_at", since)
    .lte("message_at", until)
    .order("message_at", { ascending: false })
    .limit(500);
  const [inBody, inButton] = await Promise.all([query().ilike("body", pattern), query().ilike("metadata->link->>url", pattern)]);
  if (inBody.error) throw inBody.error;
  if (inButton.error) throw inButton.error;
  const byId = new Map([...(inBody.data || []), ...(inButton.data || [])].map((row) => [row.id, row]));
  return latestLinkPerConversation([...byId.values()]);
}

// Todas as chaves possíveis de um link (lembrete único + as 4 etapas da sequência).
function allClaimKeys(linkId) {
  return [formReminderClaimKey(linkId), ...AD_REMINDER_STEPS.map((item) => formReminderClaimKey(linkId, item.step))];
}

// Reservas já gravadas: chave -> { status, sentAt }.
async function loadExistingClaims(linkIds) {
  const claims = new Map();
  const keys = linkIds.flatMap(allClaimKeys);
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await db().from("whatsapp_messages").select("meta_message_id, status, sent_at, message_at").in("meta_message_id", keys.slice(i, i + 200));
    if (error) throw error;
    for (const row of data || []) claims.set(row.meta_message_id, { status: row.status, sentAt: row.sent_at || null });
  }
  return claims;
}

// Quando a 1ª da sequência saiu (chave nova ou a antiga do lembrete único) — só se saiu de verdade.
function firstSentAtFor(linkId, claims) {
  for (const key of claimKeysForStep(linkId, "1h")) {
    const claim = claims.get(key);
    if (claim && claim.status !== "failed" && claim.status !== "queued" && claim.sentAt) return claim.sentAt;
  }
  return null;
}

// Vale a pena ler a conversa? Só se alguma etapa (lembrete único ou sequência do anúncio — ainda não se sabe qual) é
// a vez agora, está dentro do prazo e ainda não foi reservada.
function linkMayBeDue(link, claims, now) {
  const firstSentAt = firstSentAtFor(link.id, claims);
  return [false, true].some((ad) => {
    const current = currentReminderStep({ link, ad, firstSentAt }, now);
    if (!current || now > current.lateUntil) return false;
    return !claimKeysForStep(link.id, current.step).some((key) => claims.has(key));
  });
}

async function individualChannelAllowed(ownerId, slot) {
  if (await isIndividualChatSendDisabled()) return false; // Chat híbrido: envio pelo WhatsApp pessoal desativado
  if (await isWhatsappAccessBlocked(ownerId)) return false;
  const rows = await listIndividualSessionRows(ownerId);
  const row = rows.find((item) => (normalizeSlot(item.slot) || 1) === slot);
  // Só número CONECTADO e com "Usar para disparo" ligado (regra da automação, WA-15).
  return Boolean(row && row.status === "connected" && row.dispatch_enabled === true);
}

async function loadDecisionInput(link, now, claims) {
  const { data: conversation, error } = await db()
    .from("whatsapp_conversations")
    .select("id, contact_phone, contact_name, client_id, status, last_inbound_at, last_human_reply_at, deleted_at, session_key, session_slot, origin, private_at")
    .eq("id", link.conversation_id)
    .maybeSingle();
  if (error) throw error;
  // Particular (WA-19, dono 2026-10-09): contato pessoal nunca recebe lembrete automático.
  if (!conversation || conversation.private_at) return null;

  const candidates = phoneLookupCandidates(conversation.contact_phone);
  const owner = conversationSessionOwner(conversation);
  const slot = normalizeSlot(conversation.session_slot) || 1;
  // O lembrete sai pelo MESMO número que mandou o link: se a conversa mudou de número depois do link, não envia.
  const linkIndividual = link.channel === "whatsapp_individual";
  const sameNumber = linkIndividual
    ? Boolean(owner) && link.session_user_id === owner && (normalizeSlot(link.session_slot) || 1) === slot
    : !owner;
  const [messagesAfter, auditsAfter, client, phoneRegistrations, blockedContacts, liveFlows, teamPhone, chatDisabled, individualAllowed] = await Promise.all([
    db().from("whatsapp_messages").select("direction, sender_type, body, metadata, message_type, message_at")
      .eq("conversation_id", conversation.id).neq("id", link.id).neq("direction", "internal").gt("message_at", link.message_at).order("message_at", { ascending: true }).limit(100),
    db().from("whatsapp_conversation_audit").select("action, created_at")
      .eq("conversation_id", conversation.id).gt("created_at", link.message_at).limit(5),
    conversation.client_id
      ? db().from("simulation_registrations").select("id, full_name, status, last_form_submitted_at").eq("id", conversation.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    candidates.length
      ? db().from("simulation_registrations").select("id, status, created_at, last_form_submitted_at").in("phone_normalized", candidates).limit(20)
      : Promise.resolve({ data: [] }),
    candidates.length
      ? db().from("prospecting_contacts").select("id").in("phone_normalized", candidates).eq("status", "do_not_contact").limit(1)
      : Promise.resolve({ data: [] }),
    db().from("whatsapp_flow_sessions").select("id").eq("contact_phone", conversation.contact_phone).in("status", ["active", "waiting"]).limit(1),
    findInternalTeamPhone(conversation.contact_phone),
    isChatDisabled(),
    owner ? individualChannelAllowed(owner, slot) : Promise.resolve(false)
  ]);
  for (const result of [messagesAfter, auditsAfter, client, phoneRegistrations, blockedContacts, liveFlows]) {
    if (result.error) throw result.error;
  }

  const input = {
    link,
    conversation,
    client: client.data || null,
    phoneRegistrations: phoneRegistrations.data || [],
    messagesAfter: messagesAfter.data || [],
    auditsAfter: auditsAfter.data || [],
    isTeamPhone: Boolean(teamPhone),
    isPhoneBlocked: Boolean((blockedContacts.data || []).length),
    hasLiveFlowSession: Boolean((liveFlows.data || []).length),
    claimedKeys: allClaimKeys(link.id).filter((key) => claims.has(key)),
    firstSentAt: firstSentAtFor(link.id, claims),
    chatDisabled,
    channel: !sameNumber
      ? { kind: "numero_mudou" }
      : owner
      ? { kind: "individual", individualAllowed }
      : { kind: "official", officialConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) }
  };
  return { input, conversation, owner, slot, decision: decideFormReminder(input, now) };
}

async function sendReminder({ link, conversation, owner, slot, clientName, step, claimKey }) {
  const text = buildFormReminderText(clientName || conversation.contact_name || "", step);
  const individual = Boolean(owner);
  const startedAt = new Date().toISOString();
  const metadata = { kind: FORM_REMINDER_KIND, form_reminder_of: link.id, ...(step ? { form_reminder_step: step } : {}) };
  // Reserva: o índice único de meta_message_id impede duas rodadas de enviarem o mesmo lembrete.
  const { data: claim, error: claimError } = await db()
    .from("whatsapp_messages")
    .insert({
      conversation_id: conversation.id,
      direction: "outbound",
      sender_type: "automation",
      channel: individual ? "whatsapp_individual" : "whatsapp_cloud_api",
      session_user_id: individual ? owner : null,
      session_slot: individual ? slot : 1,
      meta_message_id: claimKey,
      message_type: "text",
      body: text,
      metadata,
      status: "queued",
      message_at: startedAt
    })
    .select("id")
    .single();
  if (claimError?.code === "23505") return "ja_enviado";
  if (claimError) throw claimError;

  let sent;
  try {
    sent = individual
      ? await sendIndividualMessage(owner, { to: conversation.contact_phone, text, slot })
      : await sendWhatsappTextMessage({ to: conversation.contact_phone, text });
  } catch (sendError) {
    // Falhou ou resultado desconhecido: nunca reenvia (a reserva continua valendo).
    const failedAt = new Date().toISOString();
    const { error: failError } = await db().from("whatsapp_messages")
      .update({ status: "failed", failed_at: failedAt, error_message: String(sendError?.message || "Falha ao enviar").slice(0, 500) })
      .eq("id", claim.id);
    if (failError) console.error("[lembrete-formulario] falha ao marcar o lembrete como não enviado:", failError.message || failError);
    await broadcastChatChanged();
    console.warn(`[lembrete-formulario] envio falhou (link ${link.id}):`, sendError?.message || sendError);
    return "falha_envio";
  }

  const sentAt = new Date().toISOString();
  const { error: updateError } = await db().from("whatsapp_messages")
    .update({
      status: "sent",
      sent_at: sentAt,
      metadata: individual
        ? { ...metadata, wa_message_id: sent.messageId, ...(sent.remoteJid ? { remote_jid: sent.remoteJid } : {}) }
        : { ...metadata, cloud_message_id: sent.messageId }
    })
    .eq("id", claim.id);
  if (updateError) throw updateError;
  const { error: rpcError } = await db().rpc("whatsapp_chat_apply_outbound", {
    p_conversation_id: conversation.id,
    p_at: sentAt,
    p_preview: text.slice(0, 120),
    p_mark_in_service: false
  });
  if (rpcError) throw rpcError;
  await broadcastChatChanged();
  return "enviado";
}

// Uma rodada: procura links de formulário com alguma etapa vencida e decide cada um. Sem horário de silêncio (24 h).
// Backlog (1ª mensagem de link anterior à publicação): no máximo FORM_REMINDER_BACKLOG_SENDS_PER_RUN por rodada.
export async function processFormReminders({ now = new Date() } = {}) {
  const links = await loadLinkCandidates(now);
  const claims = await loadExistingClaims(links.map((link) => link.id));
  const due = links.filter((link) => linkMayBeDue(link, claims, now));
  const result = { links: links.length, due: due.length, sent: 0, failed: 0, backlogSent: 0, skipped: {}, waiting: {} };
  for (const link of due.slice(0, MAX_LOADS_PER_RUN)) {
    if (result.sent + result.failed >= MAX_PER_RUN) break;
    const loaded = await loadDecisionInput(link, now, claims);
    if (!loaded) continue;
    const { decision } = loaded;
    if (decision.action === "skip") {
      result.skipped[decision.reason] = (result.skipped[decision.reason] || 0) + 1;
      continue;
    }
    if (decision.action === "wait") {
      result.waiting[decision.reason] = (result.waiting[decision.reason] || 0) + 1;
      continue;
    }
    const backlogFirst = new Date(link.message_at) < new Date(FORM_REMINDER_BACKLOG_CUTOFF) && (decision.step === "1h" || decision.step === "");
    if (backlogFirst && result.backlogSent >= FORM_REMINDER_BACKLOG_SENDS_PER_RUN) {
      result.waiting.backlog_espacado = (result.waiting.backlog_espacado || 0) + 1;
      continue;
    }
    const outcome = await sendReminder({ link, conversation: loaded.conversation, owner: loaded.owner, slot: loaded.slot, clientName: loaded.input.client?.full_name, step: decision.step, claimKey: decision.claimKey });
    if (outcome === "enviado") result.sent += 1;
    else if (outcome === "falha_envio") result.failed += 1;
    if (backlogFirst && outcome !== "ja_enviado") result.backlogSent += 1;
  }
  return result;
}

// Eco, no webhook do WhatsApp pessoal, do lembrete que ESTA automação acabou de enviar (o celular devolve a própria
// mensagem como "fromMe"): não é o corretor digitando — não vira mensagem da pessoa nem contato humano.
export async function isFormReminderEcho({ conversationId, body }) {
  if (!conversationId || !body) return false;
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data, error } = await db()
    .from("whatsapp_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("sender_type", "automation")
    .eq("metadata->>kind", FORM_REMINDER_KIND)
    .eq("body", body)
    .gte("created_at", since)
    .limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}
