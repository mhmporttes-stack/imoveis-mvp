import "server-only";
import { getSupabaseAdminClient } from "./supabase";

export async function listLeadDistributionDashboard() {
  const supabase = getSupabaseAdminClient();
  const [{ data: users, error: usersError }, { data: registrations, error: registrationsError }, { data: state, error: stateError }, { data: history, error: historyError }] = await Promise.all([
    supabase.from("admin_users").select("id, name, email, role, status, lead_distribution_enabled, lead_distribution_position").in("role", ["admin", "manager", "broker", "associate"]),
    supabase.from("simulation_registrations").select("responsible_user_id").not("responsible_user_id", "is", null),
    supabase.from("lead_distribution_state").select("last_broker_id, updated_at").eq("id", "default").maybeSingle(),
    supabase.from("lead_distribution_history").select("id, registration_id, client_name, event_type, created_at, from_user:admin_users!from_user_id(name), to_user:admin_users!to_user_id(name)").order("created_at", { ascending: false }).limit(100)
  ]);
  if (usersError) throw usersError;
  if (registrationsError) throw registrationsError;
  if (stateError) throw stateError;
  if (historyError) throw historyError;

  const counts = (registrations || []).reduce((result, item) => {
    result[item.responsible_user_id] = (result[item.responsible_user_id] || 0) + 1;
    return result;
  }, {});
  const brokers = (users || []).map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    enabled: user.lead_distribution_enabled === true,
    position: Number(user.lead_distribution_position) || 999999,
    clientCount: counts[user.id] || 0
  })).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "pt-BR"));

  return {
    brokers,
    history: (history || []).map((item) => ({
      id: item.id,
      registrationId: item.registration_id,
      clientName: item.client_name,
      eventType: item.event_type,
      createdAt: item.created_at,
      fromUserName: item.from_user?.name || "",
      toUserName: item.to_user?.name || "Sem responsável"
    })),
    lastBrokerId: state?.last_broker_id || "",
    lastAssignedAt: state?.updated_at || ""
  };
}

export async function recordLeadDistributionHistory({ registration, eventType, fromUserId = null, toUserId = null }) {
  const { error } = await getSupabaseAdminClient().from("lead_distribution_history").insert({
    registration_id: registration.id,
    client_name: registration.fullName || registration.full_name || "Cliente",
    event_type: eventType,
    from_user_id: fromUserId,
    to_user_id: toUserId
  });
  if (error) throw error;
}

export async function reorderLeadDistribution(order = []) {
  const ids = [...new Set(order.filter((id) => typeof id === "string" && id))];
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.from("admin_users").select("id").in("id", ids).in("role", ["admin", "manager", "broker", "associate"]);
  if (error) throw error;
  if ((data || []).length !== ids.length) throw new Error("A fila contém um corretor inválido.");
  const updates = await Promise.all(ids.map((id, index) => supabase.from("admin_users").update({ lead_distribution_position: index + 1 }).eq("id", id)));
  const updateError = updates.find((result) => result.error)?.error;
  if (updateError) throw updateError;
  const { error: stateError } = await supabase.from("lead_distribution_state").upsert({ id: "default", last_broker_id: ids.at(-1) || null, updated_at: new Date().toISOString() });
  if (stateError) throw stateError;
  return ids;
}
