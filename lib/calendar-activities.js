import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { applyResponsibleUserScope, assertCanAccessResponsibleUser } from "./admin-access";

const PRIORITIES = new Set(["standard", "important", "priority"]);

export async function listCalendarActivities({ from, to, auth }) {
  let query = getSupabaseAdminClient().from("calendar_activities").select("*").order("scheduled_at", { ascending: true });
  query = query.eq("responsible_user_id", requireCurrentProfileId(auth));
  if (from) query = query.gte("scheduled_at", from);
  if (to) query = query.lte("scheduled_at", to);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(rowToActivity);
}

export async function listCalendarClientOptions(auth) {
  let query = getSupabaseAdminClient().from("simulation_registrations").select("id, full_name, responsible_user_id").order("full_name");
  query = applyResponsibleUserScope(query, auth);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => ({ id: row.id, name: row.full_name || "Cliente sem nome", responsibleUserId: row.responsible_user_id || "" }));
}

export async function createCalendarActivity(payload, auth) {
  const title = clean(payload.title, 160);
  const scheduledAt = validDate(payload.scheduledAt);
  if (!title) throw new Error("Informe o título da atividade.");
  if (!scheduledAt) throw new Error("Informe uma data e hora válidas.");

  const responsibleUserId = requireCurrentProfileId(auth);

  const clientId = payload.clientId || null;
  if (clientId) await assertClientAccess(clientId, auth);
  const record = {
    client_id: clientId,
    responsible_user_id: responsibleUserId,
    title,
    activity_type: clean(payload.activityType, 80) || "outro",
    scheduled_at: scheduledAt.toISOString(),
    note: clean(payload.note, 500) || null,
    priority: PRIORITIES.has(payload.priority) ? payload.priority : null,
    status: "pending",
    created_by: auth?.user?.id || null
  };
  const { data, error } = await getSupabaseAdminClient().from("calendar_activities").insert(record).select("*").single();
  if (error) throw error;
  return rowToActivity(data);
}

export async function completeCalendarActivity(id, auth) {
  const current = await getActivity(id, auth);
  if (current.status === "rescheduled") throw new Error("Uma atividade reagendada não pode ser concluída.");
  const completedAt = new Date().toISOString();
  const { data, error } = await getSupabaseAdminClient().from("calendar_activities").update({ status: "completed", completed_at: completedAt, updated_at: completedAt }).eq("id", id).select("*").single();
  if (error) throw error;
  return rowToActivity(data);
}

export async function rescheduleCalendarActivity(id, scheduledAtValue, noteValue, auth) {
  const current = await getActivity(id, auth);
  if (current.status !== "pending") throw new Error("Somente atividades pendentes podem ser reagendadas.");
  const scheduledAt = validDate(scheduledAtValue);
  if (!scheduledAt) throw new Error("Informe uma nova data e hora válidas.");
  const now = new Date().toISOString();
  const { data: nextRow, error: insertError } = await getSupabaseAdminClient().from("calendar_activities").insert({
    client_id: current.clientId || null,
    responsible_user_id: current.responsibleUserId || null,
    title: current.title,
    activity_type: current.activityType,
    scheduled_at: scheduledAt.toISOString(),
    note: noteValue === undefined ? current.note || null : clean(noteValue, 500) || null,
    priority: current.priority || null,
    status: "pending",
    rescheduled_from_id: current.id,
    created_by: auth?.user?.id || null
  }).select("*").single();
  if (insertError) throw insertError;
  const { data: previousRow, error: updateError } = await getSupabaseAdminClient().from("calendar_activities").update({ status: "rescheduled", rescheduled_to_id: nextRow.id, rescheduled_to_at: scheduledAt.toISOString(), updated_at: now }).eq("id", id).select("*").single();
  if (updateError) {
    await getSupabaseAdminClient().from("calendar_activities").delete().eq("id", nextRow.id);
    throw updateError;
  }
  return { previous: rowToActivity(previousRow), next: rowToActivity(nextRow) };
}

export async function createLegacyRescheduleHistory(activity, scheduledAtValue, auth) {
  const scheduledAt = validDate(scheduledAtValue);
  if (!scheduledAt) throw new Error("Informe uma nova data e hora válidas.");
  assertOwnActivity(activity.responsibleUserId, auth);
  const { data, error } = await getSupabaseAdminClient().from("calendar_activities").insert({
    client_id: activity.id,
    responsible_user_id: activity.responsibleUserId || null,
    title: activity.scheduledActivityNote || activity.fullName || "Atividade do cliente",
    activity_type: activity.scheduledActivityType || "follow_up",
    scheduled_at: activity.scheduledActivityAt,
    note: activity.scheduledActivityNote || null,
    priority: null,
    status: "rescheduled",
    rescheduled_to_at: scheduledAt.toISOString(),
    created_by: auth?.user?.id || null
  }).select("*").single();
  if (error) throw error;
  return rowToActivity(data);
}

async function getActivity(id, auth) {
  const { data, error } = await getSupabaseAdminClient().from("calendar_activities").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Atividade não encontrada.");
  assertOwnActivity(data.responsible_user_id, auth);
  return rowToActivity(data);
}

async function assertClientAccess(id, auth) {
  const { data, error } = await getSupabaseAdminClient().from("simulation_registrations").select("responsible_user_id").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Cliente não encontrado.");
  assertCanAccessResponsibleUser(auth, data.responsible_user_id);
}

function rowToActivity(row) {
  return {
    id: row.id,
    clientId: row.client_id || "",
    responsibleUserId: row.responsible_user_id || "",
    title: row.title,
    activityType: row.activity_type || "outro",
    scheduledActivityAt: row.scheduled_at,
    note: row.note || "",
    priority: row.priority || "",
    status: row.status || "pending",
    completedAt: row.completed_at || "",
    rescheduledFromId: row.rescheduled_from_id || "",
    rescheduledToId: row.rescheduled_to_id || "",
    rescheduledToAt: row.rescheduled_to_at || "",
    source: "calendar"
  };
}
function validDate(value) { const date = new Date(value || ""); return Number.isFinite(date.getTime()) ? date : null; }
function clean(value, max) { return String(value || "").trim().replace(/\s+/g, " ").slice(0, max); }

function requireCurrentProfileId(auth) {
  const profileId = auth?.profile?.id || "";
  if (!profileId) throw new Error("Não foi possível identificar o usuário da atividade.");
  return profileId;
}

function assertOwnActivity(responsibleUserId, auth) {
  if (!responsibleUserId || responsibleUserId !== requireCurrentProfileId(auth)) {
    throw new Error("Esta atividade pertence a outro usuário.");
  }
}
