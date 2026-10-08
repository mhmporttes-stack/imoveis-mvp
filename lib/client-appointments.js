import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { toWhatsAppDigits } from "./phone-utils";
import { isOwnerAdminEmail } from "./admin-profiles";
import { logClientJourneyEvent } from "./client-journey";
import { sendPushToUser } from "./push-subscriptions";
import { NOTIFICATION_KIND } from "./notification-policy-core.mjs";
import { isPresentationToken } from "./simulation-presentation-core.mjs";
import { RECEIVE_CONTACT_STATE, resolveReceiveSimulationContact } from "./receive-simulation-contact.mjs";
import { buildBrokerWhatsappUrl, forecastWindow, isForecastBlocked } from "./documents-forecast-core.mjs";
import {
  APPOINTMENT_ACTIVITY_TITLE,
  APPOINTMENT_JOURNEY_EVENT,
  APPOINTMENT_REQUEST_JOURNEY_EVENT,
  agendaSeed,
  appointmentJourneyText,
  appointmentRequestJourneyText,
  buildAppointmentActivity,
  buildAppointmentIcs,
  buildAppointmentMessage,
  buildAppointmentRequestMessage,
  buildClientAgenda,
  buildGoogleCalendarUrl,
  describeDay,
  isMeetLink,
  publicAppointment,
  resolveAgendaOwnerId,
  slotEndsAt,
  slotStartsAt,
  slotState
} from "./client-appointments-core.mjs";

// "Agendar atendimento" da apresentação (/s/<token>) — ligação ao banco. Regras puras e testes em
// lib/client-appointments-core.mjs (PRES-22). Só é chamado pelas rotas públicas /api/s/<token>/agendamento/**, que já
// validaram o formato do token e o corpo. Tabela client_appointments (migration 20261008120000).

const TABLE = "client_appointments";
// Semente do sorteio de escassez: constante do servidor (pode ser trocada por env sem mudar código). O id da gestora
// nunca vai ao navegador, então o cliente não consegue reproduzir o sorteio.
const SCARCITY_SECRET = process.env.APPOINTMENT_SCARCITY_SECRET || "mm-agenda-escassez-v1";

function db() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo não configurado.");
  return supabase;
}

function isMissingSchema(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || "").toLowerCase();
  return ["42P01", "42703", "PGRST205", "PGRST204"].includes(code) || (message.includes(TABLE) && (message.includes("does not exist") || message.includes("schema cache")));
}

let schemaReady = false;
/** A tabela já existe em produção? (o botão só aparece depois da migration; resposta positiva fica em memória). */
export async function isClientAppointmentsReady() {
  if (schemaReady) return true;
  try {
    const { error } = await db().from(TABLE).select("id", { head: true, count: "exact" }).limit(1);
    if (error) {
      if (!isMissingSchema(error)) console.error("[agendamento] falha ao verificar a tabela:", error.message || error);
      return false;
    }
    schemaReady = true;
    return true;
  } catch (error) {
    console.error("[agendamento] falha ao verificar a tabela:", error?.message || error);
    return false;
  }
}

async function readMeetLink(userId) {
  if (!userId) return "";
  const { data, error } = await db().from("admin_users").select("meet_link").eq("id", userId).maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return "";
    throw error;
  }
  return isMeetLink(data?.meet_link) ? String(data.meet_link).trim() : "";
}

/**
 * Contexto de um token: apresentação ativa → cliente → responsável (ativo e com WhatsApp) → gestora (dona da agenda).
 * Resultados: { kind: "not_found" | "blocked" | "unavailable" } | { kind: "ok", ... }.
 */
async function loadContext(token) {
  if (!isPresentationToken(token)) return { kind: "not_found" };
  const { data: presentation, error } = await db()
    .from("simulation_presentations")
    .select("id, simulation_id, registration_id, status")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  if (!presentation || presentation.status !== "active") return { kind: "not_found" };

  let registrationId = presentation.registration_id || "";
  if (!registrationId) {
    const { data: simulation, error: simulationError } = await db().from("simulations").select("registration_id").eq("id", presentation.simulation_id).maybeSingle();
    if (simulationError) throw simulationError;
    registrationId = simulation?.registration_id || "";
  }
  if (!registrationId) return { kind: "unavailable" };
  const { data: client, error: clientError } = await db()
    .from("simulation_registrations")
    .select("id, full_name, status, responsible_user_id")
    .eq("id", registrationId)
    .maybeSingle();
  if (clientError) throw clientError;
  if (!client) return { kind: "not_found" };
  if (isForecastBlocked(client.status)) return { kind: "blocked" };
  if (!client.responsible_user_id) return { kind: "unavailable" };

  const { data: users, error: usersError } = await db().from("admin_users").select("id, name, role, status, manager_id, linked_broker_id, email, phone");
  if (usersError) throw usersError;
  const broker = (users || []).find((user) => user.id === client.responsible_user_id) || null;
  const contact = resolveReceiveSimulationContact({
    responsibleUserId: client.responsible_user_id,
    broker: broker ? { status: broker.status, whatsappDigits: toWhatsAppDigits(broker.phone) } : null
  });
  if (contact.state !== RECEIVE_CONTACT_STATE.READY) return { kind: "unavailable" };

  const managerId = resolveAgendaOwnerId({ responsibleUserId: client.responsible_user_id, users: users || [], isOwnerEmail: isOwnerAdminEmail });
  if (!managerId) return { kind: "unavailable" };
  const manager = (users || []).find((user) => user.id === managerId) || null;
  return { kind: "ok", presentation, client, broker, brokerPhone: contact.phone, managerId, managerName: manager?.name || "" };
}

async function realBusyStarts(managerId, now) {
  const days = forecastWindow(now);
  const from = new Date(`${days[0]}T00:00:00-03:00`).toISOString();
  const to = new Date(`${days[days.length - 1]}T23:59:59-03:00`).toISOString();
  const { data, error } = await db()
    .from(TABLE)
    .select("starts_at")
    .eq("manager_user_id", managerId)
    .eq("status", "scheduled")
    .gte("starts_at", from)
    .lte("starts_at", to);
  if (error) throw error;
  return new Set((data || []).map((row) => new Date(row.starts_at).toISOString()));
}

async function findUpcoming(clientId, now) {
  const { data, error } = await db()
    .from(TABLE)
    .select("id, kind, starts_at, ends_at, created_at")
    .eq("client_id", clientId)
    .eq("status", "scheduled")
    .gte("starts_at", now.toISOString())
    .order("starts_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

function calendarLinks(token, row, ctx, meetLink) {
  const input = { startsAt: new Date(row.starts_at).toISOString(), endsAt: new Date(row.ends_at).toISOString(), kind: row.kind, meetLink, brokerName: ctx.broker?.name || "", brokerPhone: ctx.brokerPhone };
  return { ics: `/api/s/${token}/agendamento/${row.id}/ics`, google: buildGoogleCalendarUrl(input) };
}

/** GET público: agenda dos 10 dias (livre/indisponível), se há link do Meet e o agendamento futuro do cliente (se houver). */
export async function getAppointmentAgendaByToken(token, now = new Date()) {
  const ctx = await loadContext(token);
  if (ctx.kind !== "ok") return ctx;
  const [busyStarts, meetLink, upcoming] = await Promise.all([realBusyStarts(ctx.managerId, now), readMeetLink(ctx.managerId), findUpcoming(ctx.client.id, now)]);
  return {
    kind: "ok",
    dias: buildClientAgenda({ now, seed: agendaSeed(SCARCITY_SECRET, ctx.managerId), busyStarts }),
    meet: Boolean(meetLink),
    agendado: upcoming ? { ...publicAppointment(upcoming), ...calendarLinks(token, upcoming, ctx, meetLink) } : null
  };
}

async function notifyTeam({ ctx, title, description }) {
  const recipients = [...new Set([ctx.client.responsible_user_id, ctx.managerId].filter(Boolean))];
  const now = new Date().toISOString();
  try {
    // Tipo "scheduled_activity": é atividade agendada (política de notificações de 2026-10-06 só deixa passar esse tipo).
    const { error } = await db().from("crm_notifications").insert(recipients.map((recipientId) => ({
      recipient_user_id: recipientId,
      client_id: ctx.client.id,
      title,
      description,
      notification_type: NOTIFICATION_KIND.SCHEDULED_ACTIVITY,
      scheduled_at: now
    })));
    if (error) throw error;
  } catch (error) {
    console.error("[agendamento] falha ao gravar a notificação:", error?.message || error);
  }
  const url = `/admin/simulacoes${ctx.client.full_name ? `?query=${encodeURIComponent(ctx.client.full_name)}` : ""}`;
  await Promise.all(recipients.map((recipientId) => sendPushToUser(recipientId, { kind: NOTIFICATION_KIND.SCHEDULED_ACTIVITY, title, body: description, url })
    .catch((error) => console.error("[agendamento] falha no push:", error?.message || error))));
}

/**
 * POST público: reserva um horário. `input` já validado por parseAppointmentBody.
 * Resultados: not_found | blocked | unavailable | already (já tem atendimento futuro) | taken (horário indisponível) | ok.
 */
export async function bookAppointmentByToken(token, input, now = new Date()) {
  const ctx = await loadContext(token);
  if (ctx.kind !== "ok") return ctx;
  const upcoming = await findUpcoming(ctx.client.id, now);
  if (upcoming) return { kind: "already", agendado: publicAppointment(upcoming) };

  const busyStarts = await realBusyStarts(ctx.managerId, now);
  const state = slotState({ date: input.data, time: input.hora, now, seed: agendaSeed(SCARCITY_SECRET, ctx.managerId), busyStarts });
  if (state !== "available") return { kind: "taken" };

  const startsAt = slotStartsAt(input.data, input.hora);
  const { data: row, error } = await db()
    .from(TABLE)
    .insert({
      client_id: ctx.client.id,
      presentation_id: ctx.presentation.id,
      broker_user_id: ctx.client.responsible_user_id,
      manager_user_id: ctx.managerId,
      kind: input.tipo,
      starts_at: startsAt,
      ends_at: slotEndsAt(startsAt),
      status: "scheduled"
    })
    .select("id, kind, starts_at, ends_at, created_at")
    .single();
  if (error) {
    if (String(error.code) === "23505") return { kind: "taken" }; // outro cliente da equipe reservou no mesmo instante
    if (isMissingSchema(error)) return { kind: "unavailable" };
    throw error;
  }

  const meetLink = await readMeetLink(ctx.managerId).catch((failure) => {
    console.error("[agendamento] falha ao ler o link do Meet (segue sem link):", failure?.message || failure);
    return "";
  });
  const activity = buildAppointmentActivity({ clientId: ctx.client.id, responsibleUserId: ctx.client.responsible_user_id, kind: input.tipo, startsAt, managerName: ctx.managerName, meetLink });
  const { data: savedActivity, error: activityError } = await db().from("calendar_activities").insert(activity).select("id").single();
  if (activityError) console.error("[agendamento] falha ao criar a atividade no card:", activityError.message || activityError);
  else {
    const { error: linkError } = await db().from(TABLE).update({ calendar_activity_id: savedActivity.id }).eq("id", row.id);
    if (linkError) console.error("[agendamento] falha ao ligar a atividade ao agendamento:", linkError.message || linkError);
  }

  const text = appointmentJourneyText({ kind: input.tipo, date: input.data, time: input.hora });
  await logClientJourneyEvent({ clientId: ctx.client.id, eventType: APPOINTMENT_JOURNEY_EVENT, actor: null, details: { text, kind: input.tipo, startsAt, appointmentId: row.id } });
  await notifyTeam({ ctx, title: APPOINTMENT_ACTIVITY_TITLE[input.tipo], description: `${ctx.client.full_name || "Cliente"}: ${describeDay(input.data)}, às ${input.hora}.` });

  const message = buildAppointmentMessage({ fullName: ctx.client.full_name, kind: input.tipo, date: input.data, time: input.hora, meetLink });
  return {
    kind: "ok",
    url: buildBrokerWhatsappUrl(ctx.brokerPhone, message),
    agendado: { ...publicAppointment(row), ...calendarLinks(token, row, ctx, meetLink) }
  };
}

/** POST público "Combinar outro horário": registra o pedido (não reserva nada) e devolve o WhatsApp do corretor. */
export async function requestAppointmentByToken(token, input) {
  const ctx = await loadContext(token);
  if (ctx.kind !== "ok") return ctx;
  const { error } = await db().from(TABLE).insert({
    client_id: ctx.client.id,
    presentation_id: ctx.presentation.id,
    broker_user_id: ctx.client.responsible_user_id,
    manager_user_id: ctx.managerId,
    kind: input.tipo,
    status: "special_request",
    requested_date: input.data,
    requested_text: input.texto
  });
  if (error) {
    if (isMissingSchema(error)) return { kind: "unavailable" };
    throw error;
  }
  const text = appointmentRequestJourneyText({ kind: input.tipo, date: input.data, text: input.texto });
  await logClientJourneyEvent({ clientId: ctx.client.id, eventType: APPOINTMENT_REQUEST_JOURNEY_EVENT, actor: null, details: { text, kind: input.tipo, date: input.data, requested: input.texto } });
  await notifyTeam({ ctx, title: "Cliente pediu outro horário de atendimento", description: `${ctx.client.full_name || "Cliente"}: ${describeDay(input.data)}, ${input.texto}. Combine pelo WhatsApp.` });
  const message = buildAppointmentRequestMessage({ fullName: ctx.client.full_name, kind: input.tipo, date: input.data, text: input.texto });
  return { kind: "ok", url: buildBrokerWhatsappUrl(ctx.brokerPhone, message) };
}

/** GET público do .ics: só agendamento 'scheduled' do MESMO cliente do token. */
export async function getAppointmentIcsByToken(token, appointmentId) {
  const ctx = await loadContext(token);
  if (ctx.kind !== "ok") return ctx;
  const { data: row, error } = await db()
    .from(TABLE)
    .select("id, client_id, kind, status, starts_at, ends_at, created_at")
    .eq("id", appointmentId)
    .maybeSingle();
  if (error) throw error;
  if (!row || row.client_id !== ctx.client.id || row.status !== "scheduled") return { kind: "not_found" };
  const meetLink = await readMeetLink(ctx.managerId);
  return {
    kind: "ok",
    ics: buildAppointmentIcs({ id: row.id, startsAt: row.starts_at, endsAt: row.ends_at, createdAt: row.created_at, kind: row.kind, meetLink, brokerName: ctx.broker?.name || "", brokerPhone: ctx.brokerPhone })
  };
}
