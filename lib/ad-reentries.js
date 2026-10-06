import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { getAdminProfileById } from "./admin-profiles";

// Relatório "Reentradas por anúncio": clientes que JÁ existiam no CRM e voltaram
// a preencher o formulário por um anúncio (campanha ativa). Os eventos
// "ad_reentry" (side = "original") ficam na linha do tempo do cadastro antigo e
// guardam o corretor que o atendia na época — base para o gestor medir quem está
// deixando cliente esfriar. Só leitura.
export async function getAdReentryReport({ days = 30 } = {}, auth = null) {
  assertGeneralAdminOrManager(auth);
  const periodDays = Math.min(Math.max(Number(days) || 30, 1), 365);
  const since = new Date(Date.now() - periodDays * 86400000).toISOString();
  const db = getSupabaseAdminClient();

  const { data, error } = await db
    .from("client_journey_events")
    .select("client_id, details, occurred_at")
    .eq("event_type", "ad_reentry")
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(1000);
  if (error) throw error;

  const events = (data || []).filter((row) => row.details?.side === "original");
  const clientIds = [...new Set(events.map((row) => row.client_id))];
  const brokerIds = [...new Set(events.map((row) => row.details?.previousResponsibleUserId).filter(Boolean))];

  const clientsById = new Map();
  if (clientIds.length) {
    const { data: clients, error: clientsError } = await db.from("simulation_registrations").select("id, full_name").in("id", clientIds);
    if (clientsError) throw clientsError;
    for (const client of clients || []) clientsById.set(client.id, client.full_name || "Cliente");
  }

  const brokerNames = new Map();
  await Promise.all(brokerIds.map(async (id) => {
    try {
      const profile = await getAdminProfileById(id);
      brokerNames.set(id, profile?.name || "Corretor removido");
    } catch {
      brokerNames.set(id, "Corretor");
    }
  }));

  const groups = new Map();
  for (const row of events) {
    const brokerId = row.details?.previousResponsibleUserId || "";
    const key = brokerId || "sem-responsavel";
    if (!groups.has(key)) groups.set(key, { brokerId, brokerName: brokerId ? brokerNames.get(brokerId) || "Corretor" : "Sem corretor na época", total: 0, clients: [] });
    const group = groups.get(key);
    group.total += 1;
    group.clients.push({
      clientId: row.client_id,
      clientName: clientsById.get(row.client_id) || "Cliente",
      campaignName: row.details?.campaignName || "",
      at: row.occurred_at
    });
  }

  return {
    periodDays,
    total: events.length,
    brokers: [...groups.values()].sort((a, b) => b.total - a.total)
  };
}
