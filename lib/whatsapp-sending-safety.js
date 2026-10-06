import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { phoneLookupCandidates } from "./phone-utils";
import { getIndividualSessionRow } from "./whatsapp-individual";
import { notifyAutoBrake } from "./whatsapp-session-attention";
import {
  BRAKE_CODE, BRAKE_REPLY_WINDOW, brakeStateKey, countConsecutiveFailures, countNewContactsToday, evaluateBrake,
  evaluateReplyRate, isNewContact, nextBrakeStateOnPause, nextBrakeStateOnRelease
} from "./whatsapp-sending-safety-core.mjs";

// Ligação com o banco das regras de lib/whatsapp-sending-safety-core.mjs (limite de contatos novos/dia e freio
// automático). Sem migration: o estado do freio fica em crm_settings (chave por corretor) e a pausa usa os campos que
// já existem (daily_goal_auto_settings.paused / paused_reason — o cron só processa quem está com paused = false).
// Só LÊ a fila/conversas e escreve a pausa; nunca envia nada. Erro de leitura PROPAGA (na dúvida, não envia).

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

const PHONES_PER_QUERY = 20; // cada telefone gera vários formatos; lotes pequenos evitam estourar a URL do PostgREST
const msOf = (value) => {
  const ms = new Date(value || "").getTime();
  return Number.isNaN(ms) ? null : ms;
};

/* ------------------------------ Estado do freio ------------------------------ */

export async function readBrakeState(brokerId) {
  const { data, error } = await db().from("crm_settings").select("setting_value").eq("id", brakeStateKey(brokerId)).maybeSingle();
  if (error) throw error;
  return data?.setting_value || null;
}

async function writeBrakeState(brokerId, value) {
  const { error } = await db().from("crm_settings").upsert({ id: brakeStateKey(brokerId), setting_value: value, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw error;
}

// Chamada por quem LIBERA (admin/gestor) ANTES de despausar: marca o instante da liberação (a avaliação só olha envios
// depois dele, senão o mesmo histórico ruim pausaria de novo na hora). Sem freio ativo = nada a fazer.
export async function recordBrakeRelease(brokerId, byId = null) {
  const prev = await readBrakeState(brokerId);
  const next = nextBrakeStateOnRelease(prev, { atIso: new Date().toISOString(), byId });
  if (!next) return false;
  await writeBrakeState(brokerId, next);
  return true;
}

/* ------------------------- Contatos novos por dia ------------------------- */

// Primeira prova de contato deste chip com cada contato: primeira mensagem enviada pela fila OU primeira conversa do chip
// (whatsapp_conversations.session_key = corretor) com o número. Map(contactId -> ms | null).
async function loadFirstEvidenceByContact(brokerId, contactIds) {
  const ids = [...new Set((contactIds || []).filter(Boolean))];
  const evidence = new Map(ids.map((id) => [id, null]));
  if (!ids.length) return evidence;
  const bump = (id, ms) => {
    if (ms === null || !evidence.has(id)) return;
    const current = evidence.get(id);
    if (current === null || ms < current) evidence.set(id, ms);
  };

  const [{ data: contacts, error: contactsError }, { data: sent, error: sentError }] = await Promise.all([
    db().from("prospecting_contacts").select("id, phone_normalized").in("id", ids),
    db().from("daily_goal_auto_queue").select("contact_id, sent_at, send_started_at, wa_message_id, status")
      .eq("broker_id", brokerId).in("contact_id", ids).or("status.eq.sent,wa_message_id.not.is.null")
  ]);
  if (contactsError) throw contactsError;
  if (sentError) throw sentError;
  for (const row of sent || []) bump(row.contact_id, msOf(row.sent_at) ?? msOf(row.send_started_at));

  const contactsByCandidate = new Map();
  for (const contact of contacts || []) {
    for (const candidate of phoneLookupCandidates(contact.phone_normalized)) {
      const list = contactsByCandidate.get(candidate) || [];
      list.push(contact.id);
      contactsByCandidate.set(candidate, list);
    }
  }
  const candidates = [...contactsByCandidate.keys()];
  for (let offset = 0; offset < candidates.length; offset += PHONES_PER_QUERY * 4) {
    const { data: conversations, error } = await db().from("whatsapp_conversations")
      .select("contact_phone, created_at, last_message_at").eq("session_key", brokerId)
      .in("contact_phone", candidates.slice(offset, offset + PHONES_PER_QUERY * 4)).not("last_message_at", "is", null);
    if (error) throw error;
    for (const conversation of conversations || []) {
      for (const contactId of contactsByCandidate.get(conversation.contact_phone) || []) bump(contactId, msOf(conversation.created_at));
    }
  }
  return evidence;
}

// Avalia o item que está para sair: ele é um contato NOVO para este chip? Quantos novos já saíram hoje?
// `excludeItemId` = o item reivindicado agora (nunca conta contra si mesmo).
export async function loadNewContactStatus(brokerId, { contactId, dayStartMs, excludeItemId = null }) {
  const dayStartIso = new Date(dayStartMs).toISOString();
  const { data: todayRows, error } = await db().from("daily_goal_auto_queue")
    .select("id, contact_id, status, wa_message_id")
    .eq("broker_id", brokerId).or(`send_started_at.gte.${dayStartIso},sent_at.gte.${dayStartIso}`).limit(500);
  if (error) throw error;
  const todayContactIds = (todayRows || [])
    .filter((row) => row.id !== excludeItemId && (row.status === "sent" || row.status === "sending" || row.wa_message_id))
    .map((row) => row.contact_id);
  const evidence = await loadFirstEvidenceByContact(brokerId, [...todayContactIds, contactId]);
  return {
    isNew: isNewContact(evidence.get(contactId) ?? null, dayStartMs),
    newUsedToday: countNewContactsToday([...new Set(todayContactIds)].map((id) => evidence.get(id) ?? null), dayStartMs)
  };
}

/* ------------------------------ Freio automático ------------------------------ */

// Taxa de resposta: dos últimos 50 envios ENTREGUES (depois da última liberação), quantos contatos escreveram depois
// da mensagem (conversa deste chip com last_inbound_at posterior ao envio).
async function loadReplyStats(brokerId, sinceMs) {
  let query = db().from("daily_goal_auto_queue").select("contact_id, sent_at")
    .eq("broker_id", brokerId).eq("status", "sent").not("delivered_at", "is", null).not("sent_at", "is", null)
    .order("sent_at", { ascending: false }).limit(BRAKE_REPLY_WINDOW);
  if (sinceMs !== null) query = query.gt("sent_at", new Date(sinceMs).toISOString());
  const { data: rows, error } = await query;
  if (error) throw error;
  if ((rows || []).length < BRAKE_REPLY_WINDOW) return evaluateReplyRate((rows || []).map((row) => ({ sentMs: msOf(row.sent_at), replied: false })));

  const contactIds = [...new Set(rows.map((row) => row.contact_id).filter(Boolean))];
  const { data: contacts, error: contactsError } = await db().from("prospecting_contacts").select("id, phone_normalized").in("id", contactIds);
  if (contactsError) throw contactsError;
  const idsByCandidate = new Map();
  for (const contact of contacts || []) {
    for (const candidate of phoneLookupCandidates(contact.phone_normalized)) {
      const list = idsByCandidate.get(candidate) || [];
      list.push(contact.id);
      idsByCandidate.set(candidate, list);
    }
  }
  const lastInboundByContact = new Map();
  const candidates = [...idsByCandidate.keys()];
  for (let offset = 0; offset < candidates.length; offset += PHONES_PER_QUERY * 4) {
    const { data: conversations, error: conversationsError } = await db().from("whatsapp_conversations")
      .select("contact_phone, last_inbound_at").eq("session_key", brokerId)
      .in("contact_phone", candidates.slice(offset, offset + PHONES_PER_QUERY * 4)).not("last_inbound_at", "is", null);
    if (conversationsError) throw conversationsError;
    for (const conversation of conversations || []) {
      const inboundMs = msOf(conversation.last_inbound_at);
      for (const contactId of idsByCandidate.get(conversation.contact_phone) || []) {
        if (inboundMs !== null && inboundMs > (lastInboundByContact.get(contactId) ?? 0)) lastInboundByContact.set(contactId, inboundMs);
      }
    }
  }
  return evaluateReplyRate(rows.map((row) => {
    const sentMs = msOf(row.sent_at);
    return { sentMs, replied: (lastInboundByContact.get(row.contact_id) ?? 0) > sentMs };
  }), { sinceMs });
}

async function loadRecentAttempts(brokerId, sinceMs) {
  let query = db().from("daily_goal_auto_queue")
    .select("status, wa_message_id, skip_reason, last_error, send_started_at")
    .eq("broker_id", brokerId).not("send_started_at", "is", null).in("status", ["sent", "error", "pending"])
    .order("send_started_at", { ascending: false }).limit(8);
  if (sinceMs !== null) query = query.gt("send_started_at", new Date(sinceMs).toISOString());
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Pausa o corretor (atômico: só quem ainda NÃO estava pausado muda — evita pausa e alerta duplicados entre ciclos
// concorrentes), grava motivo/histórico e avisa a gestão. A pausa só sai por liberação de admin/gestor.
async function applyBrakePause(brokerId, decision) {
  const atIso = new Date().toISOString();
  const { data: changed, error } = await db().from("daily_goal_auto_settings")
    .update({ paused: true, paused_reason: decision.reason, updated_at: atIso })
    .eq("broker_id", brokerId).eq("paused", false).select("broker_id");
  if (error) throw error;
  if (!changed?.length) return { paused: true, changed: false, code: decision.code }; // já estava pausado: sem novo registro/alerta
  await writeBrakeState(brokerId, nextBrakeStateOnPause(await readBrakeState(brokerId), { code: decision.code, reason: decision.reason, atIso }));
  // Pausa por sessão: o alerta da própria sessão (whatsapp-session-attention) já avisou — não duplica.
  const alert = decision.code === BRAKE_CODE.SESSION ? { alerted: false, reason: "alerta_da_sessao" } : await notifyAutoBrake(brokerId, { code: decision.code, atIso });
  return { paused: true, changed: true, code: decision.code, alerted: alert.alerted };
}

// Avalia os 3 gatilhos e, se algum disparar, pausa. `checks` limita o que avaliar (após uma falha de envio só falhas).
export async function checkAndApplyAutoBrake(brokerId, { checks = ["session", "failures", "reply"] } = {}) {
  const state = await readBrakeState(brokerId);
  const sinceMs = state?.status === "released" ? msOf(state.releasedAt) : null;

  const sessionRow = checks.includes("session") ? await getIndividualSessionRow(brokerId) : null;
  let decision = evaluateBrake({ sessionRow });
  if (!decision && checks.includes("failures")) {
    decision = evaluateBrake({ consecutiveFailures: countConsecutiveFailures(await loadRecentAttempts(brokerId, sinceMs)) });
  }
  if (!decision && checks.includes("reply")) {
    decision = evaluateBrake({ replyStats: await loadReplyStats(brokerId, sinceMs) });
  }
  if (!decision) return { paused: false };
  return applyBrakePause(brokerId, decision);
}
