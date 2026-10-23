import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { isOwnerAdminEmail } from "./admin-auth";
import { resolvePresenceProfileId } from "./admin-presence-core.mjs";
import { triggerAlexaRoutine } from "./alexa-voice";
import {
  generateWifiToken,
  hashWifiToken,
  isWifiPresenceEligible,
  normalizeTriggerDevice,
  wifiPresenceState,
  wifiTokenMatches
} from "./presence-wifi-core.mjs";

// PRES-WIFI (dono, 2026-10-23): "Chegada pelo Wi-Fi". O Atalho do iPhone avisa chegada/saída
// (app/api/presence/wifi). "arrive" registra a chegada na imobiliária pelo MESMO mecanismo da ROL-2f
// (register_office_checkin, origem 'wifi') e dispara o gatilho "ligar" do Voice Monkey; "leave" tira o
// "na imobiliária agora" (last_wifi_seen_at) e dispara o gatilho "desligar". A validade da chegada para a roleta
// (até 9h do dia seguinte, ROL-2f) NÃO muda com a saída. O on-line da roleta (admin_presence) não é tocado aqui
// — ver docs/BUSINESS_RULES.md PRES-WIFI (decisão pendente do dono).

const TOKENS = "presence_wifi_tokens";
const EVENTS = "presence_wifi_events";
const MIGRATION_MISSING = "A Chegada pelo Wi-Fi ainda não está ativa no banco (migration 20261023120000 pendente).";
// Marca no campo ip da chegada: veio do Atalho do iPhone (nunca é um IP de verdade).
export const WIFI_SHORTCUT_MARKER = "atalho:wifi";

function db() {
  if (!hasSupabaseAdminConfig) throw new Error("Supabase administrativo não configurado.");
  return getSupabaseAdminClient();
}

function isMissingTable(error) {
  return ["42P01", "PGRST205"].includes(error?.code) || /presence_wifi_/.test(String(error?.message || ""));
}

function fail(error) {
  if (isMissingTable(error)) throw new Error(MIGRATION_MISSING);
  throw error;
}

// A chave é sempre do usuário REAL (em "Alterar conta" continua sendo de quem está no aparelho).
async function requireEligibleProfile(auth) {
  const userId = resolvePresenceProfileId(auth);
  const profile = auth?.accountSwitchMode ? auth.realProfile : auth?.profile;
  const email = (auth?.accountSwitchMode ? auth.realUser?.email : auth?.user?.email) || profile?.email || "";
  if (!userId || !isWifiPresenceEligible({ status: profile?.status || "active", email }, { isOwnerEmail: isOwnerAdminEmail })) {
    throw Object.assign(new Error("A Chegada pelo Wi-Fi está disponível só para o dono por enquanto."), { status: 403 });
  }
  return userId;
}

export async function getWifiPresenceStatus(auth) {
  const userId = await requireEligibleProfile(auth);
  const [{ data: row, error }, { data: events, error: eventsError }] = await Promise.all([
    db().from(TOKENS).select("token_created_at, token_hash, plug_on_device, plug_off_device, last_event, last_event_at").eq("user_id", userId).maybeSingle(),
    db().from(EVENTS).select("event, received_at, office_status, plug_status").eq("user_id", userId).order("received_at", { ascending: false }).limit(10)
  ]);
  if (error || eventsError) {
    if (isMissingTable(error || eventsError)) return { ready: false, error: MIGRATION_MISSING };
    throw error || eventsError;
  }
  return {
    ready: true,
    tokenConfigured: Boolean(row?.token_hash),
    tokenCreatedAt: row?.token_created_at || null,
    plugOnDevice: row?.plug_on_device || "",
    plugOffDevice: row?.plug_off_device || "",
    lastEvent: row?.last_event || null,
    lastEventAt: row?.last_event_at || null,
    presence: wifiPresenceState({ lastEvent: row?.last_event, lastEventAt: row?.last_event_at }),
    events: (events || []).map((item) => ({ event: item.event, receivedAt: item.received_at, officeStatus: item.office_status || "", plugStatus: item.plug_status || "" }))
  };
}

// Gera (ou troca) a chave pessoal. Só o hash é guardado; a chave volta UMA vez. A anterior deixa de valer.
export async function generateWifiPresenceToken(auth) {
  const userId = await requireEligibleProfile(auth);
  const token = generateWifiToken();
  const now = new Date().toISOString();
  const { error } = await db().from(TOKENS).upsert({ user_id: userId, token_hash: hashWifiToken(token), token_created_at: now, updated_at: now }, { onConflict: "user_id" });
  if (error) fail(error);
  return token;
}

export async function revokeWifiPresenceToken(auth) {
  const userId = await requireEligibleProfile(auth);
  const { error } = await db().from(TOKENS).update({ token_hash: null, token_created_at: null, updated_at: new Date().toISOString() }).eq("user_id", userId);
  if (error) fail(error);
}

export async function saveWifiPresenceTriggers(auth, { plugOnDevice, plugOffDevice }) {
  const userId = await requireEligibleProfile(auth);
  const row = { user_id: userId, plug_on_device: normalizeTriggerDevice(plugOnDevice) || null, plug_off_device: normalizeTriggerDevice(plugOffDevice) || null, updated_at: new Date().toISOString() };
  const { error } = await db().from(TOKENS).upsert(row, { onConflict: "user_id" });
  if (error) fail(error);
}

// Rota pública: acha o dono da chave. Busca pelo hash (único) e confere em tempo constante.
export async function findWifiTokenOwner(token) {
  const hash = hashWifiToken(token);
  const { data: record, error } = await db().from(TOKENS).select("user_id, token_hash, plug_on_device, plug_off_device").eq("token_hash", hash).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  if (!record || !wifiTokenMatches(record.token_hash, token)) return null;
  const { data: profile, error: profileError } = await db().from("admin_users").select("id, email, role, status").eq("id", record.user_id).maybeSingle();
  if (profileError) throw profileError;
  return profile ? { profile, record } : null;
}

async function registerOfficeArrival(userId) {
  const { error } = await db().rpc("register_office_checkin", { p_user_id: userId, p_source: "wifi", p_ip: WIFI_SHORTCUT_MARKER });
  return error ? "erro" : "chegada_registrada";
}

async function clearOfficeHereNow(userId) {
  const { error } = await db()
    .from("office_presence_checkins")
    .update({ last_wifi_seen_at: null })
    .eq("user_id", userId)
    .gt("valid_until", new Date().toISOString())
    .not("last_wifi_seen_at", "is", null);
  return error ? "erro" : "saida_registrada";
}

// Aplica "arrive"/"leave": presença na imobiliária + tomada (em paralelo) e registra o evento. Falha de um lado
// não impede o outro; o resultado de cada um fica no histórico (sem token, sem device).
export async function applyWifiPresenceEvent({ profile, record, event }) {
  const arrive = event === "arrive";
  const [officeStatus, plug] = await Promise.all([
    (arrive ? registerOfficeArrival(profile.id) : clearOfficeHereNow(profile.id)).catch(() => "erro"),
    triggerAlexaRoutine(arrive ? record.plug_on_device : record.plug_off_device)
  ]);
  const now = new Date().toISOString();
  const [{ error: stateError }, { error: logError }] = await Promise.all([
    db().from(TOKENS).update({ last_event: event, last_event_at: now, updated_at: now }).eq("user_id", profile.id),
    db().from(EVENTS).insert({ user_id: profile.id, event, received_at: now, office_status: officeStatus, plug_status: plug.status })
  ]);
  if (stateError || logError) console.warn(`[presence-wifi] falha ao registrar o evento: ${(stateError || logError)?.code || "erro"}.`);
  if (officeStatus === "erro") console.warn("[presence-wifi] falha ao atualizar a presença na imobiliária.");
  return { officeStatus, plugStatus: plug.status };
}
