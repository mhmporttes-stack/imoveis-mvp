import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { AdminPermissionError, isManagerProfile, isOwnerAdminEmail, listAdminProfiles } from "./admin-profiles";
import { filterProfilesForScope, resolveTeamMetaScope } from "./team-meta-scope-core.mjs";
import { HEALTH_DAYS, buildSessionHealthRows } from "./whatsapp-session-health-core.mjs";

// Painel de saúde por número do WhatsApp individual (REGRA OFICIAL — dono, 2026-10-10, WA-21). SOMENTE LEITURA:
// whatsapp_individual_sessions, whatsapp_session_telemetry (eventos 'disconnected' dos últimos 7 dias) e
// daily_goal_auto_queue (só a contagem de pendentes — nunca altera a fila). Escopo igual ao da T-35, decidido AQUI no
// backend: administrador principal = todos; gestora = SÓ a equipe dela (sem ela mesma); qualquer outro = 403.
// Tolerante a migration pendente: sem a coluna de número (slot/session_slot) cai na consulta antiga (tudo é Número 1);
// sem a tabela de telemetria/fila o campo vem vazio/nulo, nunca derruba o painel.
const PAGE = 1000;

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) return { rows, error };
    rows.push(...(data || []));
    if (!data || data.length < PAGE || rows.length >= 20000) return { rows, error: null };
  }
}

export async function getWhatsappSessionHealth(auth, now = Date.now()) {
  const scope = resolveTeamMetaScope({
    isManager: isManagerProfile(auth?.profile),
    isOwner: isOwnerAdminEmail(auth?.user?.email),
    profileId: auth?.profile?.id,
    managedUserIds: auth?.profile?.managedUserIds
  });
  if (scope.mode === "denied") throw new AdminPermissionError("Apenas o administrador principal ou a gestora da equipe pode acessar esta área.");

  const db = getSupabaseAdminClient();
  if (!db) throw new Error("Supabase não configurado.");
  const profiles = filterProfilesForScope(await listAdminProfiles(), scope).filter((profile) => profile.status !== "inactive" && !isOwnerAdminEmail(profile.email));
  const ids = profiles.map((profile) => profile.id);
  if (!ids.length) return { rows: [], days: HEALTH_DAYS, generatedAt: new Date(now).toISOString(), queueAvailable: true };

  const sinceIso = new Date(now - HEALTH_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const withSlot = "user_id, slot, status, last_error, last_disconnect_code, last_disconnect_at, last_connected_at";
  const withoutSlot = "user_id, status, last_error, last_disconnect_code, last_disconnect_at, last_connected_at";

  const [sessionsResult, telemetryResult, queueResult] = await Promise.all([
    (async () => {
      const first = await db.from("whatsapp_individual_sessions").select(withSlot).in("user_id", ids);
      if (!first.error) return first;
      return db.from("whatsapp_individual_sessions").select(withoutSlot).in("user_id", ids);
    })(),
    (async () => {
      const first = await fetchAll(() => db.from("whatsapp_session_telemetry").select("user_id, session_slot, status_code, reason, kind, occurred_at")
        .eq("event_type", "disconnected").in("user_id", ids).gte("occurred_at", sinceIso).order("occurred_at", { ascending: false }));
      if (!first.error) return first;
      return fetchAll(() => db.from("whatsapp_session_telemetry").select("user_id, status_code, reason, kind, occurred_at")
        .eq("event_type", "disconnected").in("user_id", ids).gte("occurred_at", sinceIso).order("occurred_at", { ascending: false }));
    })(),
    fetchAll(() => db.from("daily_goal_auto_queue").select("broker_id").eq("status", "pending").in("broker_id", ids))
  ]);
  if (sessionsResult.error) throw sessionsResult.error;
  if (telemetryResult.error) console.warn("Saúde do WhatsApp: telemetria indisponível:", telemetryResult.error.message);

  const queueByBroker = {};
  if (!queueResult.error) {
    for (const row of queueResult.rows) queueByBroker[row.broker_id] = (queueByBroker[row.broker_id] || 0) + 1;
    for (const id of ids) queueByBroker[id] ||= 0;
  }

  return {
    rows: buildSessionHealthRows({ sessions: sessionsResult.data || [], telemetry: telemetryResult.rows, queueByBroker, users: profiles, now }),
    days: HEALTH_DAYS,
    generatedAt: new Date(now).toISOString(),
    queueAvailable: !queueResult.error,
    telemetryAvailable: !telemetryResult.error
  };
}
