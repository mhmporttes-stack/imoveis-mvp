import "server-only";
import { getSupabaseAdminClient } from "./supabase";

export async function listLeadDistributionDashboard() {
  const supabase = getSupabaseAdminClient();
  const [{ data: users, error: usersError }, { data: registrations, error: registrationsError }, { data: state, error: stateError }] = await Promise.all([
    supabase.from("admin_users").select("id, name, email, role, status, lead_distribution_enabled, lead_distribution_position").in("role", ["admin", "broker"]),
    supabase.from("simulation_registrations").select("responsible_user_id").not("responsible_user_id", "is", null),
    supabase.from("lead_distribution_state").select("last_broker_id, updated_at").eq("id", "default").maybeSingle()
  ]);
  if (usersError) throw usersError;
  if (registrationsError) throw registrationsError;
  if (stateError) throw stateError;

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

  return { brokers, lastBrokerId: state?.last_broker_id || "", lastAssignedAt: state?.updated_at || "" };
}

export async function reorderLeadDistribution(order = []) {
  const ids = [...new Set(order.filter((id) => typeof id === "string" && id))];
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.from("admin_users").select("id").in("id", ids).in("role", ["admin", "broker"]);
  if (error) throw error;
  if ((data || []).length !== ids.length) throw new Error("A fila contém um corretor inválido.");
  const updates = await Promise.all(ids.map((id, index) => supabase.from("admin_users").update({ lead_distribution_position: index + 1 }).eq("id", id)));
  const updateError = updates.find((result) => result.error)?.error;
  if (updateError) throw updateError;
  return ids;
}
