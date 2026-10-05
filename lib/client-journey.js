import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { getSiteBaseUrl, normalizeAdminEmail } from "./admin-profiles";
import { getSimulationRegistration } from "./simulation-registrations";
import { assertGeneralAdminOrManager } from "./admin-access";
import { personalizeJourney, publicJourneyDTO } from "./journey-presentation";
import { toBrazilianE164 } from "./phone-utils";

const db = () => getSupabaseAdminClient();
function checked(result) { if (result.error) throw result.error; return result.data; }

const ACTOR_ROLE_LABEL = { admin: "Administrador", manager: "Gestor", broker: "Corretor", associate: "Associado" };

// Snapshot de QUEM executou uma ação, no formato usado por logClientJourneyEvent
// — nunca resolvido "ao vivo" depois (se o cargo da pessoa mudar no futuro, o
// evento antigo continua mostrando o cargo que ela tinha NA HORA, coerente com
// a regra de histórico imutável). `auth=null` (automação/cron, sem usuário
// logado) sempre vira "Sistema"/"automacao".
export function resolveActorSnapshot(auth) {
  if (!auth?.ok || !auth.profile) return { email: "sistema", name: "Sistema", role: "automacao" };
  const email = auth.realUser?.email && auth.realUser.email !== auth.user?.email
    ? `${auth.realUser.email} como ${auth.profile?.name || auth.user?.email}`
    : auth.user?.email || auth.profile?.name || "sistema";
  // role guarda a chave BRUTA (admin/manager/broker/associate) — o rótulo em
  // português (ACTOR_ROLE_LABEL) é aplicado sempre na leitura, nunca gravado
  // já traduzido, pra ter um único lugar de tradução (evita duas fontes de
  // verdade divergindo se o rótulo mudar no futuro).
  return { email, name: auth.profile?.name || auth.user?.email || "Usuário", role: auth.profile?.role || "automacao" };
}

// Ponto ÚNICO de escrita na linha do tempo — toda ação nova do CRM que deve
// aparecer no histórico do cliente passa por aqui (nunca um INSERT direto
// espalhado pelo código). event_type novo, específico da ação (ex.:
// "responsible_transferred", "tag_added", "activity_completed") — os quatro
// tipos herdados do trigger de banco (created/status/notify/regenerate)
// continuam sendo gravados por ele, sem conflito. Best-effort: uma falha aqui
// nunca pode impedir a ação real (transferir, editar, concluir atividade
// etc.) de acontecer — só registra o rastro dela.
export async function logClientJourneyEvent({ clientId, eventType, actor, details = {} }) {
  if (!clientId || !eventType) return;
  try {
    const { error } = await db().from("client_journey_events").insert({
      client_id: clientId,
      event_type: eventType,
      actor: actor?.email || "sistema",
      actor_name: actor?.name || "Sistema",
      actor_role: actor?.role || "automacao",
      details
    });
    if (error) throw error;
  } catch (error) {
    console.warn(`Falha ao registrar evento "${eventType}" na linha do tempo do cliente:`, error?.message || error);
  }
}

// Variante em lote de logClientJourneyEvent — mesmo contrato best-effort
// (uma falha nunca derruba a ação real), mas um único INSERT para vários
// eventos de uma vez, em vez de um round-trip por evento (ex.: várias tags
// alteradas no mesmo save do cliente).
export async function logClientJourneyEvents(events) {
  const rows = (events || [])
    .filter((event) => event?.clientId && event?.eventType)
    .map((event) => ({
      client_id: event.clientId,
      event_type: event.eventType,
      actor: event.actor?.email || "sistema",
      actor_name: event.actor?.name || "Sistema",
      actor_role: event.actor?.role || "automacao",
      details: event.details || {}
    }));
  if (!rows.length) return;
  try {
    const { error } = await db().from("client_journey_events").insert(rows);
    if (error) throw error;
  } catch (error) {
    console.warn(`Falha ao registrar ${rows.length} evento(s) na linha do tempo do cliente:`, error?.message || error);
  }
}

// Resolve nome/cargo de um lote de e-mails (client_journey_events antigos,
// sem actor_name/actor_role ainda — gravados antes desta migration) e de um
// lote de ids (prospecting_history/lead_distribution_history, que só guardam
// user_id) numa única consulta cada, para nunca virar N+1 ao montar a timeline.
async function resolveActorLookups(emails, userIds) {
  const cleanEmails = [...new Set(emails.filter(Boolean).map((email) => normalizeAdminEmail(email)))];
  const cleanIds = [...new Set(userIds.filter(Boolean))];
  const [byEmailRows, byIdRows] = await Promise.all([
    cleanEmails.length ? db().from("admin_users").select("email,name,role").in("email", cleanEmails) : Promise.resolve({ data: [] }),
    cleanIds.length ? db().from("admin_users").select("id,name,role").in("id", cleanIds) : Promise.resolve({ data: [] })
  ]);
  const byEmail = new Map((byEmailRows.data || []).map((row) => [normalizeAdminEmail(row.email), row]));
  const byId = new Map((byIdRows.data || []).map((row) => [row.id, row]));
  return { byEmail, byId };
}

function actorFromEmail(byEmail, email) {
  if (!email) return { name: "Sistema", role: "automacao" };
  if (String(email).toLowerCase() === "sistema") return { name: "Sistema", role: "automacao" };
  const profile = byEmail.get(normalizeAdminEmail(String(email).split(" como ")[0]));
  return profile ? { name: profile.name, role: ACTOR_ROLE_LABEL[profile.role] || profile.role } : { name: email, role: "" };
}

function actorFromId(byId, userId) {
  const profile = userId ? byId.get(userId) : null;
  return profile ? { name: profile.name, role: ACTOR_ROLE_LABEL[profile.role] || profile.role } : { name: "Sistema", role: "automacao" };
}

// closing_quote/closing_author: encerramento genérico e global da página
// pública (mesmo texto para qualquer status), editável em Gestão > Minha
// Jornada. Os defaults abaixo cobrem o caso de a migration ainda não ter
// rodado em algum ambiente; o valor salvo no banco sempre prevalece.
const JOURNEY_COPY_DEFAULTS = { closing_quote: "Tudo é possível ao que crê.", closing_author: "Marcos 9:23" };

export async function getJourneySettings() {
  const rows = checked(await db().from("crm_settings").select("id,setting_value").in("id", ["client_journey_statuses", "client_journey_copy"]));
  return {
    statuses: rows.find(r => r.id === "client_journey_statuses")?.setting_value || {},
    copy: { ...JOURNEY_COPY_DEFAULTS, ...(rows.find(r => r.id === "client_journey_copy")?.setting_value || {}) }
  };
}

export async function saveJourneySettings(input, auth) {
  assertGeneralAdminOrManager(auth);
  const current = await getJourneySettings();
  const statuses = {};
  const clean = (value, limit) => {
    if (typeof value !== "string" || value.length > limit || /[<>]/.test(value)) throw new Error("Use apenas texto, dentro do tamanho permitido.");
    return value.trim();
  };
  for (const status of Object.keys(current.statuses)) {
    const item = input.statuses?.[status];
    if (!item || (item.progress !== null && (!Number.isInteger(item.progress) || item.progress < 0 || item.progress > 100))) throw new Error("Percentual inválido.");
    statuses[status] = { progress: item.progress, cta: item.cta === "none" ? "none" : "whatsapp" };
    for (const key of ["public_name", "title", "subtitle", "body", "cta_label", "notification"]) statuses[status][key] = clean(item[key], key === "body" || key === "notification" ? 4000 : 250);
    if (!statuses[status].title || !statuses[status].body) throw new Error("Preencha o título e a mensagem de todos os status.");
  }
  const copy = Object.fromEntries(Object.keys(current.copy).map(key => [key, clean(input.copy?.[key], 1000)]));
  checked(await db().from("crm_settings").upsert([
    { id: "client_journey_statuses", setting_value: statuses, updated_by: auth.profile.id, updated_at: new Date().toISOString() },
    { id: "client_journey_copy", setting_value: copy, updated_by: auth.profile.id, updated_at: new Date().toISOString() }
  ]));
  return { statuses, copy };
}

export async function getPublicJourney(token) {
  if (!/^[a-f0-9]{64}$/.test(token || "")) return null;
  const state = checked(await db().from("client_journeys").select("client_id,progress,previous_progress,current_status,changed_at").eq("token", token).maybeSingle());
  if (!state) return null;
  const client = checked(await db().from("simulation_registrations").select("full_name,client_code,responsible_user_id").eq("id", state.client_id).maybeSingle());
  if (!client) return null;
  const settings = await getJourneySettings();
  const config = settings.statuses[state.current_status] || settings.statuses.awaiting_return;
  const broker = client.responsible_user_id ? checked(await db().from("admin_users").select("phone").eq("id", client.responsible_user_id).maybeSingle()) : null;
  return publicJourneyDTO(client, state, config, broker?.phone, settings.copy);
}

// Teto por fonte ao montar a timeline — generoso o bastante pra nunca
// truncar um cliente real (dezenas/centenas de eventos), mas limitado pra
// nunca virar uma consulta sem fim num caso patológico. "Carregar mais"
// (params.limit/offset) pagina a lista já mesclada — ver item 26 da tarefa.
const SOURCE_FETCH_CAP = 400;

// Linha do tempo de auditoria completa do cliente — mescla, numa única lista
// ordenada, TUDO que já existe espalhado pelo CRM em vez de duplicar a
// escrita de cada evento: client_journey_events (criação/status/notificação/
// eventos novos gravados por logClientJourneyEvent), client_status_history
// (fallback de clientes anteriores à migration da jornada), prospecting_history
// (tentativas de contato/prospecção) e lead_distribution_history (atribuição
// inicial pela roleta + transferências automáticas por SLA). Cada fonte já é
// a fonte de verdade do próprio domínio — aqui só se costura tudo pra leitura.
export async function getPrivateJourney(id, auth, { limit = 20, offset = 0, sort = "desc" } = {}) {
  const registration = await getSimulationRegistration(id, auth);
  if (!registration) throw new Error("Cliente não encontrado.");

  const [state, origin, journeyEventsRaw, statusHistoryRaw, prospectingRaw, distributionRaw] = await Promise.all([
    db().from("client_journeys").select("*").eq("client_id", id).single().then(checked),
    db().from("client_origins").select("source_label,created_by,initial_destination,initial_responsible_name,created_at").eq("client_id", id).maybeSingle().then(checked),
    db().from("client_journey_events").select("id,event_type,previous_status,new_status,previous_progress,progress,actor,actor_name,actor_role,details,occurred_at").eq("client_id", id).order("occurred_at", { ascending: false }).limit(SOURCE_FETCH_CAP).then(checked),
    db().from("client_status_history").select("id,previous_status,new_status,changed_at,changed_by").eq("client_id", id).order("changed_at", { ascending: false }).limit(SOURCE_FETCH_CAP).then(checked),
    db().from("prospecting_history").select("id,event_type,user_id,details,created_at").eq("registration_id", id).order("created_at", { ascending: false }).limit(SOURCE_FETCH_CAP).then(checked),
    db().from("lead_distribution_history").select("id,event_type,from_user_id,to_user_id,details,created_at").eq("registration_id", id).order("created_at", { ascending: false }).limit(SOURCE_FETCH_CAP).then(checked)
  ]);

  // client_status_history só entra como fallback para o trecho ANTERIOR ao
  // evento mais antigo já coberto por client_journey_events (clientes
  // criados antes de 2026-09-13) — nunca duplica uma mudança de status que
  // já apareceria via client_journey_events.
  const oldestJourneyEvent = journeyEventsRaw.at(-1)?.occurred_at;
  const legacyStatusHistory = oldestJourneyEvent
    ? statusHistoryRaw.filter((row) => new Date(row.changed_at) < new Date(oldestJourneyEvent))
    : statusHistoryRaw;

  const emailsToResolve = [
    ...journeyEventsRaw.filter((row) => !row.actor_name).map((row) => row.actor),
    ...legacyStatusHistory.map((row) => row.changed_by)
  ];
  const idsToResolve = [
    ...prospectingRaw.map((row) => row.user_id),
    ...distributionRaw.flatMap((row) => [row.from_user_id, row.to_user_id])
  ];
  const { byEmail, byId } = await resolveActorLookups(emailsToResolve, idsToResolve);

  const normalized = [
    ...journeyEventsRaw.map((row) => ({
      id: row.id,
      type: row.event_type,
      occurredAt: row.occurred_at,
      previousStatus: row.previous_status,
      newStatus: row.new_status,
      previousProgress: row.previous_progress,
      progress: row.progress,
      details: row.details || {},
      actor: row.actor_name ? { name: row.actor_name, role: ACTOR_ROLE_LABEL[row.actor_role] || row.actor_role } : actorFromEmail(byEmail, row.actor)
    })),
    ...legacyStatusHistory.map((row) => ({
      id: row.id,
      type: "legacy_status",
      occurredAt: row.changed_at,
      previousStatus: row.previous_status,
      newStatus: row.new_status,
      details: {},
      actor: actorFromEmail(byEmail, row.changed_by)
    })),
    ...prospectingRaw.map((row) => ({
      id: row.id,
      type: `prospecting:${row.event_type}`,
      occurredAt: row.created_at,
      details: row.details || {},
      actor: actorFromId(byId, row.user_id)
    })),
    ...distributionRaw.map((row) => ({
      id: row.id,
      type: `distribution:${row.event_type}`,
      occurredAt: row.created_at,
      details: { ...(row.details || {}), fromName: row.from_user_id ? actorFromId(byId, row.from_user_id).name : "", toName: row.to_user_id ? actorFromId(byId, row.to_user_id).name : "" },
      actor: { name: "Sistema", role: "automacao" }
    }))
  ].sort((a, b) => sort === "asc" ? new Date(a.occurredAt) - new Date(b.occurredAt) : new Date(b.occurredAt) - new Date(a.occurredAt));

  const url = `${getSiteBaseUrl()}/minha-jornada/${state.token}`;
  const { token, client_id, ...safeState } = state;
  return {
    registration,
    state: safeState,
    origin,
    events: normalized.slice(offset, offset + limit),
    totalEvents: normalized.length,
    hasMore: offset + limit < normalized.length,
    url
  };
}

export async function actOnJourney(id, action, auth) {
  if (!["notify", "regenerate"].includes(action)) throw new Error("Ação inválida.");
  if (action === "regenerate") assertGeneralAdminOrManager(auth);
  const detail = await getPrivateJourney(id, auth);
  let whatsappUrl = null;
  if (action === "notify") {
    const phone = toBrazilianE164(detail.registration.phoneNormalized || detail.registration.phone)?.replace(/\D/g, "");
    if (!/^55\d{10,11}$/.test(phone || "")) throw new Error("O cliente não possui um WhatsApp válido.");
    const settings = await getJourneySettings();
    const config = settings.statuses[detail.state.current_status] || settings.statuses.awaiting_return;
    const message = personalizeJourney(config.notification, { primeiro_nome: detail.registration.fullName.split(/\s+/)[0], codigo_cliente: detail.registration.clientCode, link_minha_jornada: detail.url });
    whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  }
  const actor = auth.realUser?.email && auth.realUser.email !== auth.user?.email
    ? `${auth.realUser.email} como ${auth.profile?.name || auth.user?.email}` : auth.user?.email || auth.profile?.name;
  checked(await db().rpc("client_journey_action", { p_client: id, p_action: action, p_actor: actor, p_version: detail.state.version }));
  return { ...(await getPrivateJourney(id, auth)), whatsappUrl };
}
