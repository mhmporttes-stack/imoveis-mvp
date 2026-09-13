import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { getSiteBaseUrl } from "./admin-profiles";
import { getSimulationRegistration } from "./simulation-registrations";
import { assertGeneralAdminOrManager } from "./admin-access";
import { personalizeJourney, publicJourneyDTO } from "./journey-presentation";
import { toBrazilianE164 } from "./phone-utils";

const db = () => getSupabaseAdminClient();
function checked(result) { if (result.error) throw result.error; return result.data; }

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

export async function getPrivateJourney(id, auth) {
  const registration = await getSimulationRegistration(id, auth);
  if (!registration) throw new Error("Cliente não encontrado.");
  const state = checked(await db().from("client_journeys").select("*").eq("client_id", id).single());
  const origin = checked(await db().from("client_origins").select("source_label,created_by,initial_destination,initial_responsible_name,created_at").eq("client_id", id).maybeSingle());
  const events = checked(await db().from("client_journey_events").select("id,event_type,previous_status,new_status,previous_progress,progress,actor,occurred_at").eq("client_id", id).order("occurred_at", { ascending: false }).limit(100));
  const oldestJourneyEvent = events.at(-1)?.occurred_at;
  let historyQuery = db().from("client_status_history").select("id,previous_status,new_status,changed_at,changed_by").eq("client_id", id).order("changed_at", { ascending: false }).limit(100);
  if (oldestJourneyEvent) historyQuery = historyQuery.lt("changed_at", oldestJourneyEvent);
  const previousHistory = checked(await historyQuery).map(event => ({ ...event, event_type: "legacy_status", actor: event.changed_by, occurred_at: event.changed_at }));
  const url = `${getSiteBaseUrl()}/minha-jornada/${state.token}`;
  const { token, client_id, ...safeState } = state;
  return { registration, state: safeState, origin, events: [...events, ...previousHistory].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)), url };
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
