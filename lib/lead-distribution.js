import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { deriveStatus } from "./admin-presence";

export async function listLeadDistributionDashboard() {
  const supabase = getSupabaseAdminClient();
  const [{ data: users, error: usersError }, { data: registrations, error: registrationsError }, { data: state, error: stateError }, { data: history, error: historyError }, { data: presenceRows }] = await Promise.all([
    supabase.from("admin_users").select("id, name, email, role, status, lead_distribution_enabled, lead_distribution_position").in("role", ["admin", "manager", "broker", "associate"]),
    supabase.from("simulation_registrations").select("responsible_user_id").not("responsible_user_id", "is", null),
    supabase.from("lead_distribution_state").select("last_broker_id, updated_at").eq("id", "default").maybeSingle(),
    supabase.from("lead_distribution_history").select("id, registration_id, client_name, event_type, created_at, details, from_user:admin_users!from_user_id(name), to_user:admin_users!to_user_id(name)").order("created_at", { ascending: false }).limit(100),
    supabase.from("admin_presence").select("user_id, last_activity_at")
  ]);
  const nowMs = Date.now();
  const presenceByUser = new Map((presenceRows || []).map((row) => [row.user_id, deriveStatus(row.last_activity_at, nowMs)]));
  if (usersError) throw usersError;
  if (registrationsError) throw registrationsError;
  if (stateError) throw stateError;
  if (historyError) throw historyError;

  const registrationIds = [...new Set((history || []).map(item => item.registration_id).filter(Boolean))];
  const originResult = registrationIds.length ? await supabase.from("client_origins").select("client_id,source_label").in("client_id", registrationIds) : { data: [], error: null };
  if (originResult.error) throw originResult.error;
  const originByClient = new Map((originResult.data || []).map(item => [item.client_id, item.source_label]));

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
    clientCount: counts[user.id] || 0,
    presence: presenceByUser.get(user.id) || "offline"
  })).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "pt-BR"));

  return {
    brokers,
    history: (history || []).map((item) => ({
      id: item.id,
      registrationId: item.registration_id,
      clientName: item.client_name,
      sourceLabel: originByClient.get(item.registration_id) || "Origem não identificada",
      eventType: item.event_type,
      createdAt: item.created_at,
      presenceTier: item.details?.presenceTier || "",
      skipped: Array.isArray(item.details?.skipped) ? item.details.skipped : [],
      fromUserName: item.from_user?.name || "",
      toUserName: item.to_user?.name || "Sem responsável"
    })),
    lastBrokerId: state?.last_broker_id || "",
    lastAssignedAt: state?.updated_at || ""
  };
}

// Escolhe o próximo corretor da roleta levando a PRESENÇA em conta (online
// primeiro, quem está offline é pulado sem perder o lugar) — regra em
// supabase/migrations/20260924100000_round_robin_presence_aware.sql. Devolve
// também a camada usada e quem foi pulado (nomes) para o histórico da roleta.
// Se a regra por presença falhar (ex.: migration ainda não aplicada), cai na
// função antiga (sem presença) em vez de derrubar o cadastro do lead.
export async function assignRoundRobinLead({ excludedBrokerId = null } = {}) {
  const supabase = getSupabaseAdminClient();
  const args = excludedBrokerId ? { excluded_broker_id: excludedBrokerId } : {};

  const { data, error } = await supabase.rpc("pick_round_robin_broker", args);
  if (error) {
    // Qualquer falha da regra por presença cai na função antiga (sem presença):
    // captar o lead nunca pode depender desta lógica nova.
    console.warn("Roleta por presença indisponível, usando a fila simples:", error.message || error);
    const legacy = await supabase.rpc("assign_round_robin_lead", args);
    if (legacy.error) throw legacy.error;
    return { brokerId: legacy.data || null, tier: "", skippedNames: [] };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const skippedIds = row?.skipped_ids || [];
  let skippedNames = [];
  if (skippedIds.length) {
    const { data: users } = await supabase.from("admin_users").select("id, name").in("id", skippedIds);
    const nameById = new Map((users || []).map((user) => [user.id, user.name]));
    skippedNames = skippedIds.map((id) => nameById.get(id)).filter(Boolean);
  }
  return { brokerId: row?.picked_broker_id || null, tier: row?.picked_tier || "", skippedNames };
}

export async function recordLeadDistributionHistory({ registration, eventType, fromUserId = null, toUserId = null, details = {} }) {
  const { error } = await getSupabaseAdminClient().from("lead_distribution_history").insert({
    registration_id: registration.id,
    client_name: registration.fullName || registration.full_name || "Cliente",
    event_type: eventType,
    from_user_id: fromUserId,
    to_user_id: toUserId,
    details
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
