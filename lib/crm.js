import { getSupabaseAdminClient } from "./supabase";
import { isGeneralAdminAuth } from "./admin-profiles";
import { CLIENT_STATUS, normalizeClientStatus } from "./client-status";

const ACTIVE_CLIENT_STATUSES = new Set([
  CLIENT_STATUS.PENDING,
  CLIENT_STATUS.COMPLETED,
  CLIENT_STATUS.SIMULATION_SENT,
  CLIENT_STATUS.IN_SERVICE,
  CLIENT_STATUS.AWAITING_RETURN,
  CLIENT_STATUS.DOCUMENTATION,
  CLIENT_STATUS.DOCUMENTS_PENDING,
  CLIENT_STATUS.APPROVAL_PENDING,
  CLIENT_STATUS.SHIELDING,
  CLIENT_STATUS.APPROVED
]);

export async function listCrmNotifications(auth, { limit = 50 } = {}) {
  const supabase = getSupabaseAdminClient();
  let query = supabase
    .from("crm_notifications")
    .select("*, recipient:admin_users(name), client:simulation_registrations(full_name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!isGeneralAdminAuth(auth)) {
    query = query.eq("recipient_user_id", auth?.profile?.id || emptyUuid());
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(rowToNotification);
}

export async function countUnreadCrmNotifications(auth) {
  const supabase = getSupabaseAdminClient();
  let query = supabase
    .from("crm_notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  if (!isGeneralAdminAuth(auth)) {
    query = query.eq("recipient_user_id", auth?.profile?.id || emptyUuid());
  }

  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

export async function markCrmNotificationRead(id, auth) {
  const supabase = getSupabaseAdminClient();
  let query = supabase
    .from("crm_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);

  if (!isGeneralAdminAuth(auth)) {
    query = query.eq("recipient_user_id", auth?.profile?.id || emptyUuid());
  }

  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Notificação não encontrada ou sem permissão.");
  return rowToNotification(data);
}

export async function getWhatsappMasterSettings() {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("crm_settings")
    .select("setting_value, updated_at")
    .eq("id", "whatsapp_master")
    .maybeSingle();

  if (error) throw error;
  return normalizeWhatsappMasterSettings(data?.setting_value, data?.updated_at);
}

export async function updateWhatsappMasterSettings(payload, auth) {
  const supabase = getSupabaseAdminClient();
  const settings = normalizeWhatsappMasterSettings(payload);
  const { data, error } = await supabase
    .from("crm_settings")
    .upsert({
      id: "whatsapp_master",
      setting_value: {
        phone: settings.phone,
        connectionStatus: settings.connectionStatus,
        connectionId: settings.connectionId,
        lastConnectedAt: settings.lastConnectedAt || null,
        active: settings.active
      },
      updated_by: auth?.profile?.id || null,
      updated_at: new Date().toISOString()
    })
    .select("setting_value, updated_at")
    .single();

  if (error) throw error;
  return normalizeWhatsappMasterSettings(data.setting_value, data.updated_at);
}

export async function listCrmAutomationRules() {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("crm_automation_rules")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export function calculateCrmMetrics(registrations = []) {
  const now = new Date();
  const today = saoPauloDateKey(now);
  const summary = {
    clientsToday: 0,
    awaitingAction: 0,
    activitiesToday: 0,
    overdueActivities: 0,
    completedActivities: 0
  };

  for (const registration of registrations) {
    if (saoPauloDateKey(registration.createdAt) === today) summary.clientsToday += 1;

    const scheduledAt = validDate(registration.scheduledActivityAt);
    const completed = Boolean(registration.scheduledActivityCompletedAt);
    const hasFutureActivity = scheduledAt && !completed && scheduledAt >= now;
    const active = ACTIVE_CLIENT_STATUSES.has(normalizeClientStatus(registration.status));

    if (active && !hasFutureActivity) summary.awaitingAction += 1;
    if (scheduledAt && !completed && saoPauloDateKey(scheduledAt) === today) summary.activitiesToday += 1;
    if (scheduledAt && !completed && scheduledAt < now) summary.overdueActivities += 1;
    if (completed) summary.completedActivities += 1;
  }

  return summary;
}

function rowToNotification(row = {}) {
  return {
    id: row.id,
    recipientUserId: row.recipient_user_id,
    recipientName: row.recipient?.name || "Usuário",
    clientId: row.client_id || "",
    clientName: row.client?.full_name || "",
    title: row.title || "Notificação",
    description: row.description || "",
    type: row.notification_type || "general",
    scheduledAt: row.scheduled_at || row.created_at,
    readAt: row.read_at || "",
    createdAt: row.created_at || ""
  };
}

function normalizeWhatsappMasterSettings(value = {}, updatedAt = "") {
  return {
    phone: String(value?.phone || ""),
    connectionStatus: ["disconnected", "connecting", "connected"].includes(value?.connectionStatus)
      ? value.connectionStatus
      : "disconnected",
    connectionId: String(value?.connectionId || ""),
    lastConnectedAt: value?.lastConnectedAt || "",
    active: value?.active === true,
    updatedAt: updatedAt || ""
  };
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value || "");
  return Number.isFinite(date.getTime()) ? date : null;
}

function saoPauloDateKey(value) {
  const date = validDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function emptyUuid() {
  return "00000000-0000-0000-0000-000000000000";
}
