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

// Todas as atividades (pendentes e concluídas recentes) de UM cliente —
// usado no card do cliente no CRM, onde vários corretores/gestores/admin
// podem precisar ver/gerenciar as atividades de um mesmo cliente.
export async function listCalendarActivitiesForClient(clientId, auth) {
  if (!clientId) return [];
  await assertClientAccess(clientId, auth);
  const { data, error } = await getSupabaseAdminClient()
    .from("calendar_activities")
    .select("*")
    .eq("client_id", clientId)
    .neq("status", "rescheduled")
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToActivity);
}

// Versão em lote (evita N+1 ao carregar a lista de clientes do CRM): retorna
// um Map<clientId, atividades[]> já filtrado pelo escopo do usuário logado.
// Busca em lotes de 150 ids — uma lista de clientes grande num único .in()
// estoura o limite de tamanho de URL/headers do PostgREST.
export async function listCalendarActivitiesForClients(clientIds, auth) {
  const ids = Array.from(new Set((clientIds || []).filter(Boolean)));
  if (!ids.length) return new Map();

  const batches = chunkArray(ids, 150);
  const rows = [];
  for (const group of chunkArray(batches, 5)) {
    const groupResults = await Promise.all(group.map(async (batch) => {
      let query = getSupabaseAdminClient()
        .from("calendar_activities")
        .select("*")
        .in("client_id", batch)
        .neq("status", "rescheduled")
        .order("scheduled_at", { ascending: true });
      query = applyResponsibleUserScope(query, auth, "responsible_user_id");
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }));
    rows.push(...groupResults.flat());
  }

  const byClient = new Map();
  for (const row of rows) {
    const activity = rowToActivity(row);
    if (!activity.clientId) continue;
    if (!byClient.has(activity.clientId)) byClient.set(activity.clientId, []);
    byClient.get(activity.clientId).push(activity);
  }
  return byClient;
}

function chunkArray(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
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

  const clientId = payload.clientId || null;
  if (clientId) await assertClientAccess(clientId, auth);

  // Por padrão a atividade pertence a quem está criando (agenda pessoal, como
  // sempre foi). O card do cliente pode pedir explicitamente que ela pertença
  // ao corretor responsável pelo cliente, para aparecer na agenda dele.
  let responsibleUserId = requireCurrentProfileId(auth);
  if (payload.responsibleUserId) {
    assertCanAccessResponsibleUser(auth, payload.responsibleUserId);
    responsibleUserId = payload.responsibleUserId;
  }

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

// Cancela (exclui) uma atividade pontual — afeta somente ela, as demais
// atividades do mesmo cliente permanecem intactas.
export async function deleteCalendarActivity(id, auth) {
  await getActivity(id, auth);
  const { error } = await getSupabaseAdminClient().from("calendar_activities").delete().eq("id", id);
  if (error) throw error;
  return { deleted: true };
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
  assertCanAccessResponsibleUser(auth, activity.responsibleUserId);
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

// Lembretes: cada atividade (nova, criada via calendar_activities) tem seu
// próprio controle de notificação — independente do mecanismo legado em
// simulation_registrations (scheduled_activity_notified_at), que continua
// funcionando à parte para clientes ainda não migrados para o novo modelo.
export async function listDueCalendarActivityNotifications({ limit = 50 } = {}) {
  const nowIso = new Date().toISOString();
  const { data, error } = await getSupabaseAdminClient()
    .from("calendar_activities")
    .select("*, client:simulation_registrations(full_name, phone, phone_normalized, status, last_admin_email)")
    .eq("status", "pending")
    .is("notified_at", null)
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(rowToDueNotification);
}

export async function markCalendarActivityNotified(id) {
  const { error } = await getSupabaseAdminClient()
    .from("calendar_activities")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

function rowToDueNotification(row) {
  const client = row.client || {};
  return {
    id: row.client_id || row.id,
    activityId: row.id,
    fullName: client.full_name || "Cliente",
    phone: client.phone || "",
    phoneNormalized: client.phone_normalized || "",
    status: client.status || "",
    responsibleUserId: row.responsible_user_id || "",
    lastAdminEmail: client.last_admin_email || "",
    scheduledActivityAt: row.scheduled_at,
    scheduledActivityNote: row.note || row.title || ""
  };
}

async function getActivity(id, auth) {
  const { data, error } = await getSupabaseAdminClient().from("calendar_activities").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Atividade não encontrada.");
  assertCanAccessResponsibleUser(auth, data.responsible_user_id || "");
  return rowToActivity(data);
}

async function assertClientAccess(id, auth) {
  const { data, error } = await getSupabaseAdminClient().from("simulation_registrations").select("responsible_user_id").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Cliente não encontrado.");
  assertCanAccessResponsibleUser(auth, data.responsible_user_id);
  return data.responsible_user_id || "";
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
