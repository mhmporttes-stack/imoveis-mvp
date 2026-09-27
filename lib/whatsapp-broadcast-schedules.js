import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { ADMIN_ROLE, isOwnerAdminEmail } from "./admin-profiles";
import { createBroadcast, getLocalTemplate, queueBroadcastForCron } from "./whatsapp-broadcasts";
import { sendPushToUser } from "./push-subscriptions";
import {
  DEFAULT_MIN_DAYS_SINCE_CONTACT,
  brtNowParts,
  evaluateFailureBrake,
  isScheduleDueNow,
  normalizeDaysOfWeek,
  normalizeRunTime
} from "./whatsapp-broadcast-schedule-core.mjs";

// Disparo — sorteio de contatos da Base e ROTINAS (ex.: todo dia às 8h, 30 mensagens da campanha X).
// A lógica de horário/freio é pura (whatsapp-broadcast-schedule-core.mjs, testada); aqui liga ao banco.

function db() {
  return getSupabaseAdminClient();
}

// Quem executa a rotina (cron): não há usuário logado — usa um "usuário de sistema" que passa na verificação de
// administrador das funções do Disparo, sem se passar por uma pessoa (created_by fica vazio).
const SYSTEM_AUTH = { profile: { id: null, role: ADMIN_ROLE.ADMIN, name: "Rotina automática" }, user: null };

// Donos "livres": o administrador principal e usuários inativos — clientes da base que estão com eles são
// considerados sem corretor de verdade (podem entrar no sorteio dos já contatados).
async function listFreeOwnerIds() {
  const { data, error } = await db().from("admin_users").select("id, email, status");
  if (error) throw error;
  return (data || []).filter((user) => isOwnerAdminEmail(user.email) || user.status === "inactive").map((user) => user.id);
}

// Sorteio: Grupo 1 = nunca contatados (ao acaso); Grupo 2 = só se faltar, os de contato mais antigo.
export async function pickBaseContacts({ count, minDays = DEFAULT_MIN_DAYS_SINCE_CONTACT } = {}, auth) {
  if (auth) assertGeneralAdminOrManager(auth);
  const limit = Math.min(Math.max(Math.round(Number(count) || 0), 0), 1000);
  if (!limit) return { contacts: [], tier1: 0, tier2: 0 };
  const { data, error } = await db().rpc("pick_broadcast_base_contacts", {
    p_limit: limit,
    p_min_days: Math.max(Math.round(Number(minDays)) || 0, 0),
    p_free_owner_ids: await listFreeOwnerIds()
  });
  if (error) throw error;
  const contacts = (data || []).map((row) => ({ id: row.contact_id, name: row.name, phone: row.phone, tier: row.tier, lastContactAt: row.last_contact_at || null }));
  return { contacts, tier1: contacts.filter((item) => item.tier === 1).length, tier2: contacts.filter((item) => item.tier === 2).length };
}

// ---------------------------------------------------------------------------
// CRUD das rotinas
// ---------------------------------------------------------------------------

function rowToSchedule(row) {
  return {
    id: row.id,
    name: row.name,
    templateId: row.template_id,
    dailyCount: row.daily_count,
    runTime: row.run_time,
    daysOfWeek: row.days_of_week || [],
    minDaysSinceContact: row.min_days_since_contact,
    destinationJourney: row.destination_journey,
    enabled: row.enabled === true,
    maxFailureRate: Number(row.max_failure_rate),
    pausedReason: row.paused_reason || "",
    lastRunDate: row.last_run_date || null,
    lastRunAt: row.last_run_at || null,
    lastBroadcastId: row.last_broadcast_id || null,
    lastError: row.last_error || "",
    totalRuns: row.total_runs || 0,
    createdAt: row.created_at
  };
}

export async function listSchedules(auth) {
  assertGeneralAdminOrManager(auth);
  const { data, error } = await db().from("whatsapp_broadcast_schedules").select("*, template:whatsapp_templates(name, status)").order("created_at", { ascending: false });
  if (error) throw error;
  const schedules = (data || []).map((row) => ({ ...rowToSchedule(row), templateName: row.template?.name || "", templateStatus: row.template?.status || "" }));
  const stats = await Promise.all(schedules.map((schedule) => getScheduleStats(schedule.id)));
  return schedules.map((schedule, index) => ({ ...schedule, stats: stats[index] }));
}

export async function createSchedule(payload = {}, auth) {
  assertGeneralAdminOrManager(auth);
  const name = String(payload.name || "").trim().slice(0, 120);
  if (name.length < 2) throw new Error("Dê um nome à rotina.");
  const template = await getLocalTemplate(payload.templateId, auth);
  if (!template) throw new Error("Modelo não encontrado.");
  if (template.status !== "APPROVED") throw new Error("Só modelos com status Aprovado podem ser usados em rotinas.");
  const dailyCount = Math.round(Number(payload.dailyCount));
  if (!Number.isFinite(dailyCount) || dailyCount < 1 || dailyCount > 500) throw new Error("Informe de 1 a 500 mensagens por dia.");

  const { data, error } = await db().from("whatsapp_broadcast_schedules").insert({
    name,
    template_id: template.id,
    daily_count: dailyCount,
    run_time: normalizeRunTime(payload.runTime),
    days_of_week: normalizeDaysOfWeek(payload.daysOfWeek),
    min_days_since_contact: Math.min(Math.max(Math.round(Number(payload.minDaysSinceContact)) || DEFAULT_MIN_DAYS_SINCE_CONTACT, 0), 3650),
    destination_journey: ["quick_service", "simulation", "choice"].includes(payload.destinationJourney) ? payload.destinationJourney : "choice",
    max_failure_rate: Math.min(Math.max(Number(payload.maxFailureRate) || 0.3, 0.05), 1),
    enabled: false, // nasce desligada: ativar é uma decisão explícita
    created_by: auth?.profile?.id || null
  }).select("*").single();
  if (error) throw error;
  return rowToSchedule(data);
}

export async function updateSchedule(id, payload = {}, auth) {
  assertGeneralAdminOrManager(auth);
  const patch = { updated_at: new Date().toISOString() };
  if (payload.name !== undefined) {
    const name = String(payload.name || "").trim().slice(0, 120);
    if (name.length < 2) throw new Error("Dê um nome à rotina.");
    patch.name = name;
  }
  if (payload.dailyCount !== undefined) {
    const dailyCount = Math.round(Number(payload.dailyCount));
    if (!Number.isFinite(dailyCount) || dailyCount < 1 || dailyCount > 500) throw new Error("Informe de 1 a 500 mensagens por dia.");
    patch.daily_count = dailyCount;
  }
  if (payload.runTime !== undefined) patch.run_time = normalizeRunTime(payload.runTime);
  if (payload.daysOfWeek !== undefined) patch.days_of_week = normalizeDaysOfWeek(payload.daysOfWeek);
  if (payload.minDaysSinceContact !== undefined) patch.min_days_since_contact = Math.min(Math.max(Math.round(Number(payload.minDaysSinceContact)) || 0, 0), 3650);
  if (payload.maxFailureRate !== undefined) patch.max_failure_rate = Math.min(Math.max(Number(payload.maxFailureRate) || 0.3, 0.05), 1);
  if (payload.enabled !== undefined) {
    patch.enabled = payload.enabled === true;
    if (patch.enabled) {
      patch.paused_reason = null; // religar limpa o motivo da pausa
      patch.last_error = null;
    }
  }
  const { data, error } = await db().from("whatsapp_broadcast_schedules").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Rotina não encontrada.");
  return rowToSchedule(data);
}

export async function deleteSchedule(id, auth) {
  assertGeneralAdminOrManager(auth);
  const { error } = await db().from("whatsapp_broadcast_schedules").delete().eq("id", id);
  if (error) throw error;
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Estatísticas: enviados / entregues / lidos / RESPOSTAS (por corretor) de todos os lotes da rotina.
// ---------------------------------------------------------------------------

const REPLY_WINDOW_DAYS = 3;

export async function getScheduleStats(scheduleId) {
  const { data: batches } = await db().from("whatsapp_broadcasts").select("id, total_sent, total_delivered, total_read, total_failed, total_selected, run_date").eq("schedule_id", scheduleId);
  const totals = (batches || []).reduce((sum, row) => ({
    batches: sum.batches + 1,
    selected: sum.selected + (row.total_selected || 0),
    sent: sum.sent + (row.total_sent || 0),
    delivered: sum.delivered + (row.total_delivered || 0),
    read: sum.read + (row.total_read || 0),
    failed: sum.failed + (row.total_failed || 0)
  }), { batches: 0, selected: 0, sent: 0, delivered: 0, read: 0, failed: 0 });
  if (!batches?.length) return { ...totals, replies: 0, byBroker: [] };

  const { data: recipients } = await db().from("whatsapp_broadcast_messages").select("phone_normalized, sent_at").in("broadcast_id", batches.map((row) => row.id)).not("sent_at", "is", null).limit(5000);
  const phones = [...new Set((recipients || []).map((row) => row.phone_normalized).filter(Boolean))];
  if (!phones.length) return { ...totals, replies: 0, byBroker: [] };
  const sentAtByPhone = new Map((recipients || []).map((row) => [row.phone_normalized, row.sent_at]));

  const replied = new Map(); // telefone -> conversa
  for (let index = 0; index < phones.length; index += 150) {
    const { data: conversations } = await db().from("whatsapp_conversations").select("contact_phone, client_id, assigned_user_id, last_inbound_at").in("contact_phone", phones.slice(index, index + 150)).is("deleted_at", null);
    for (const conversation of conversations || []) {
      const sentAt = new Date(sentAtByPhone.get(conversation.contact_phone) || 0).getTime();
      const inboundAt = conversation.last_inbound_at ? new Date(conversation.last_inbound_at).getTime() : 0;
      if (inboundAt > sentAt && inboundAt - sentAt < REPLY_WINDOW_DAYS * 24 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000) replied.set(conversation.contact_phone, conversation);
    }
  }

  const brokerIds = [...new Set([...replied.values()].map((conversation) => conversation.assigned_user_id).filter(Boolean))];
  const names = new Map();
  if (brokerIds.length) {
    const { data: users } = await db().from("admin_users").select("id, name").in("id", brokerIds);
    for (const user of users || []) names.set(user.id, user.name);
  }
  const counts = new Map();
  for (const conversation of replied.values()) {
    const key = conversation.assigned_user_id ? names.get(conversation.assigned_user_id) || "Corretor" : "Sem corretor";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return { ...totals, replies: replied.size, byBroker: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) };
}

// ---------------------------------------------------------------------------
// Execução (cron, a cada minuto)
// ---------------------------------------------------------------------------

async function notifyAdmins({ title, description }) {
  try {
    const { data: users } = await db().from("admin_users").select("id, role, email, status");
    const recipients = (users || []).filter((user) => user.status !== "inactive" && (user.role === ADMIN_ROLE.ADMIN || isOwnerAdminEmail(user.email)));
    if (!recipients.length) return;
    const now = new Date().toISOString();
    await db().from("crm_notifications").insert(recipients.map((user) => ({ recipient_user_id: user.id, title, description, notification_type: "automation", scheduled_at: now })));
    for (const user of recipients) await sendPushToUser(user.id, { title, body: description, url: "/admin/automacoes?tab=whatsapp-master" });
  } catch (error) {
    console.warn("Falha ao avisar sobre a rotina de disparo:", error?.message || error);
  }
}

async function pauseSchedule(schedule, reason) {
  await db().from("whatsapp_broadcast_schedules").update({ enabled: false, paused_reason: reason, updated_at: new Date().toISOString() }).eq("id", schedule.id);
  await notifyAdmins({ title: `Rotina de disparo pausada: ${schedule.name}`, description: reason });
}

async function runSchedule(schedule, { dateKey }) {
  // 1) Freio: o lote anterior teve muitas falhas?
  if (schedule.last_broadcast_id) {
    const { data: previous } = await db().from("whatsapp_broadcasts").select("status, total_sent, total_failed").eq("id", schedule.last_broadcast_id).maybeSingle();
    const verdict = evaluateFailureBrake({ status: previous?.status, sent: previous?.total_sent, failed: previous?.total_failed, maxFailureRate: Number(schedule.max_failure_rate) });
    if (verdict.pause) {
      await pauseSchedule(schedule, verdict.reason);
      return { paused: true };
    }
  }

  // 2) Modelo ainda aprovado?
  const template = await getLocalTemplate(schedule.template_id, SYSTEM_AUTH);
  if (!template || template.status !== "APPROVED") {
    await pauseSchedule(schedule, `O modelo "${template?.name || "da rotina"}" não está mais aprovado na Meta.`);
    return { paused: true };
  }

  // 3) Sorteio
  const picked = await pickBaseContacts({ count: schedule.daily_count, minDays: schedule.min_days_since_contact });
  if (!picked.contacts.length) {
    await pauseSchedule(schedule, "Acabaram os contatos elegíveis da base para esta rotina.");
    return { paused: true };
  }

  // 4) Lote do dia (único por rotina/dia) e fila; o envio é feito pelo cron do Disparo.
  const [day, month] = [dateKey.slice(8, 10), dateKey.slice(5, 7)];
  const broadcast = await createBroadcast({
    campaignName: `${schedule.name} — ${day}/${month}`,
    templateId: schedule.template_id,
    sourceType: "base",
    contactIds: picked.contacts.map((contact) => contact.id),
    variableMapping: schedule.variable_mapping || undefined,
    destinationJourney: schedule.destination_journey
  }, SYSTEM_AUTH, { scheduleId: schedule.id, runDate: dateKey, linkCampaignId: schedule.link_campaign_id || null });

  if (!schedule.link_campaign_id && broadcast.linkCampaignId) {
    await db().from("whatsapp_broadcast_schedules").update({ link_campaign_id: broadcast.linkCampaignId }).eq("id", schedule.id);
  }
  await queueBroadcastForCron(broadcast.id);
  await db().from("whatsapp_broadcast_schedules").update({
    last_broadcast_id: broadcast.id,
    total_runs: (schedule.total_runs || 0) + 1,
    last_error: null,
    updated_at: new Date().toISOString()
  }).eq("id", schedule.id);
  return { broadcastId: broadcast.id, queued: picked.contacts.length, tier1: picked.tier1, tier2: picked.tier2 };
}

// Cron: roda as rotinas que venceram AGORA. Cada rotina só executa uma vez por dia (troca atômica de last_run_date).
export async function runDueBroadcastSchedules(now = new Date()) {
  const { dateKey, weekday, minutes } = brtNowParts(now);
  const { data: schedules, error } = await db().from("whatsapp_broadcast_schedules").select("*").eq("enabled", true);
  if (error) throw error;

  const results = [];
  for (const schedule of schedules || []) {
    if (!isScheduleDueNow({ runTime: schedule.run_time, daysOfWeek: schedule.days_of_week, lastRunDate: schedule.last_run_date, dateKey, weekday, minutes })) continue;
    // Reserva o dia: se outro processo já pegou, não faz nada.
    const { data: claimed } = await db().from("whatsapp_broadcast_schedules")
      .update({ last_run_date: dateKey, last_run_at: new Date().toISOString() })
      .eq("id", schedule.id)
      .or(`last_run_date.is.null,last_run_date.lt.${dateKey}`)
      .select("*")
      .maybeSingle();
    if (!claimed) continue;
    try {
      results.push({ scheduleId: schedule.id, ...(await runSchedule(claimed, { dateKey })) });
    } catch (runError) {
      console.error("Falha ao executar a rotina de disparo:", schedule.id, runError);
      await db().from("whatsapp_broadcast_schedules").update({ last_error: String(runError?.message || runError).slice(0, 500) }).eq("id", schedule.id);
      results.push({ scheduleId: schedule.id, error: true });
    }
  }
  return { schedules: results };
}
