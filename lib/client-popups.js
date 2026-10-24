import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { ARRIVAL_CANDIDATE_LIMIT, loadClientArrivals, rows } from "./client-arrival-events";
import { buildClientPopup, clientPopupReceiverIds, clientPopupWindowStart } from "./client-popup-core.mjs";

// Janelinha de cliente novo (REGRA OFICIAL — dono, 2026-10-24, CLI-16). SOMENTE LEITURA, escopo no servidor: só clientes
// cujo responsável ATUAL é quem está vendo (ou, para o associado, o corretor vinculado). Candidatos = o que as entregas
// já gravam na janela (lead_distribution_history, responsible_changed_at, created_at); a decisão é de buildClientPopup.
// Chamado pelo mesmo ciclo do som de cliente novo (/api/crm-notifications/new-client-alerts), só com a página visível.

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

export async function listClientPopups(auth, { since = "", now = Date.now() } = {}) {
  const cursor = new Date(now).toISOString();
  const receiverIds = clientPopupReceiverIds({
    profileId: auth?.profile?.id || "",
    role: auth?.profile?.role || "",
    linkedBrokerId: auth?.profile?.linkedBrokerId || "",
    accountSwitchMode: Boolean(auth?.accountSwitchMode)
  });
  if (!receiverIds.length) return { cursor, popups: [] };
  const fromIso = clientPopupWindowStart(since, now);

  const [delivered, moved, created] = await Promise.all([
    rows(db().from("lead_distribution_history").select("registration_id").in("to_user_id", receiverIds).gte("created_at", fromIso).limit(ARRIVAL_CANDIDATE_LIMIT)),
    rows(db().from("simulation_registrations").select("id").in("responsible_user_id", receiverIds).gte("responsible_changed_at", fromIso).limit(ARRIVAL_CANDIDATE_LIMIT)),
    rows(db().from("simulation_registrations").select("id").in("responsible_user_id", receiverIds).gte("created_at", fromIso).limit(ARRIVAL_CANDIDATE_LIMIT))
  ]);
  const ids = [...new Set([...delivered.map((row) => row.registration_id), ...moved.map((row) => row.id), ...created.map((row) => row.id)].filter(Boolean))];
  if (!ids.length) return { cursor, popups: [] };

  const arrivals = await loadClientArrivals(ids, { now });
  const marketplaceIds = arrivals.filter(({ registration }) => registration.acquisition_context?.kind === "facebook_marketplace").map(({ registration }) => registration.id);
  const conversations = marketplaceIds.length
    ? await rows(db().from("marketplace_conversations").select("id, client_id, assigned_at").in("client_id", marketplaceIds).order("assigned_at", { ascending: false, nullsFirst: false }))
    : [];
  const conversationByClient = new Map();
  for (const row of conversations) if (!conversationByClient.has(row.client_id)) conversationByClient.set(row.client_id, row.id);

  const viewerEmail = auth?.user?.email || "";
  const popups = arrivals
    .map(({ registration, steps, lastAttendanceAt }) => buildClientPopup({ registration, steps, lastAttendanceAt, fromIso, receiverIds, viewerEmail, conversationId: conversationByClient.get(registration.id) || "", now }))
    .filter(Boolean);

  const fromIds = [...new Set(popups.map((item) => item.fromUserId).filter(Boolean))];
  const names = fromIds.length ? new Map((await rows(db().from("admin_users").select("id, name").in("id", fromIds))).map((row) => [row.id, row.name || ""])) : new Map();
  return {
    cursor,
    popups: popups.map(({ fromUserId, ...item }) => ({ ...item, fromName: fromUserId ? names.get(fromUserId) || "" : "" }))
  };
}
