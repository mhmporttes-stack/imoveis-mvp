import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assertGeneralAdmin, assertGeneralAdminOrManager } from "./admin-access";
import { isGeneralAdminAuth, listVisibleTeamProfiles } from "./admin-profiles";
import { resolvePresenceProfileId } from "./admin-presence-core.mjs";
import { ipMatchesNetworks, networkKey, officeStatus } from "./office-presence-core.mjs";

// ROL-2f (dono, 2026-10-13): só fica na roleta quem veio à imobiliária.
// - Detecção: heartbeat do CRM chegando pelo IP da rede do escritório
//   (cadastrada pelo dono/gestora em Supervisão › Online).
// - "Liberar hoje": dono ou gestora (só a própria equipe) para quem está em
//   trabalho externo.
// - A decisão de quem recebe lead é do BANCO (office_presence_ok dentro de
//   pick_round_robin_broker/assign_round_robin_lead) — aqui só registramos a
//   chegada e mostramos a situação. Configuração: crm_settings id 'office_presence'
//   { enabled, networks: [{ ip, key, label, addedBy, addedAt }] }.

const SETTINGS_ID = "office_presence";
const SETTINGS_CACHE_MS = 60 * 1000;
let settingsCache = { at: 0, value: null };
const checkedInToday = new Map(); // userId -> data (SP) já registrada nesta instância

function db() {
  if (!hasSupabaseAdminConfig) throw new Error("Supabase administrativo não configurado.");
  return getSupabaseAdminClient();
}

function todaySaoPaulo() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export async function getOfficePresenceSettings({ fresh = false } = {}) {
  if (!fresh && settingsCache.value && Date.now() - settingsCache.at < SETTINGS_CACHE_MS) return settingsCache.value;
  const { data, error } = await db().from("crm_settings").select("setting_value").eq("id", SETTINGS_ID).maybeSingle();
  if (error) throw error;
  const raw = data?.setting_value || {};
  const value = { enabled: raw.enabled === true, networks: Array.isArray(raw.networks) ? raw.networks : [] };
  settingsCache = { at: Date.now(), value };
  return value;
}

async function saveSettings(value) {
  const { error } = await db()
    .from("crm_settings")
    .upsert({ id: SETTINGS_ID, setting_value: value, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw error;
  settingsCache = { at: Date.now(), value };
  return value;
}

// Chamado pelo heartbeat (rota /api/admin/heartbeat). Nunca derruba o heartbeat.
// Usa o usuário REAL (em "Alterar conta" a presença é de quem está no aparelho).
export async function registerOfficeCheckinFromHeartbeat(auth, ip) {
  try {
    const userId = resolvePresenceProfileId(auth);
    if (!userId || !ip) return;
    const today = todaySaoPaulo();
    if (checkedInToday.get(userId) === today) return;
    const settings = await getOfficePresenceSettings();
    if (!settings.networks.length || !ipMatchesNetworks(ip, settings.networks)) return;
    const { error } = await db().rpc("register_office_checkin", { p_user_id: userId, p_source: "wifi", p_ip: ip.slice(0, 64) });
    if (error) throw error;
    checkedInToday.set(userId, today);
  } catch (error) {
    console.warn("Presença na imobiliária: falha ao registrar chegada:", error?.message || error);
  }
}

// Map userId -> { validUntil, source, firstSeenAt } da chegada que ainda vale (ou a mais recente).
export async function loadOfficeCheckins(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const result = new Map();
  if (!ids.length) return result;
  const since = new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await db()
    .from("office_presence_checkins")
    .select("user_id, valid_until, source, first_seen_at, ip")
    .in("user_id", ids)
    .gte("valid_until", since)
    .order("valid_until", { ascending: false });
  if (error) throw error;
  for (const row of data || []) {
    if (!result.has(row.user_id)) result.set(row.user_id, { validUntil: row.valid_until, source: row.source === "manual" && row.ip === OFFICE_ARRIVED_MARKER ? "arrived" : row.source, firstSeenAt: row.first_seen_at });
  }
  return result;
}

// Situação do próprio usuário para o aviso "você está fora da roleta".
export async function getMyOfficeStatus(auth) {
  const userId = resolvePresenceProfileId(auth);
  const settings = await getOfficePresenceSettings();
  if (!userId || !settings.enabled) return { ruleEnabled: settings.enabled, eligible: true, active: false, validUntil: null, inRoulette: false };
  const [{ data: profile }, checkins] = await Promise.all([
    db().from("admin_users").select("lead_distribution_enabled, status").eq("id", userId).maybeSingle(),
    loadOfficeCheckins([userId])
  ]);
  const status = officeStatus({ ruleEnabled: true, validUntil: checkins.get(userId)?.validUntil || null });
  return { ...status, inRoulette: profile?.status === "active" && profile?.lead_distribution_enabled === true };
}

// Tela de configuração (dono e gestora): regra, redes cadastradas e se o
// aparelho de quem pergunta está numa rede cadastrada agora.
export async function getOfficeNetworkPanel(auth, currentIp) {
  assertGeneralAdminOrManager(auth);
  const settings = await getOfficePresenceSettings({ fresh: true });
  return {
    enabled: settings.enabled,
    canToggle: isGeneralAdminAuth(auth),
    networks: settings.networks.map((network) => ({ key: network.key || networkKey(network.ip), label: network.label || "", addedAt: network.addedAt || null })),
    currentKey: networkKey(currentIp),
    currentMatches: ipMatchesNetworks(currentIp, settings.networks)
  };
}

export async function markCurrentOfficeNetwork(auth, currentIp) {
  assertGeneralAdminOrManager(auth);
  const key = networkKey(currentIp);
  if (!key) throw new Error("Não foi possível identificar a rede deste aparelho.");
  const settings = await getOfficePresenceSettings({ fresh: true });
  if (settings.networks.some((network) => (network.key || networkKey(network.ip)) === key)) return settings;
  const networks = [...settings.networks, { ip: currentIp.slice(0, 64), key, label: "Imobiliária", addedBy: auth.realProfile?.id || auth.profile?.id || null, addedAt: new Date().toISOString() }];
  return saveSettings({ ...settings, networks });
}

export async function removeOfficeNetwork(auth, key) {
  assertGeneralAdmin(auth);
  const settings = await getOfficePresenceSettings({ fresh: true });
  return saveSettings({ ...settings, networks: settings.networks.filter((network) => (network.key || networkKey(network.ip)) !== key) });
}

export async function setOfficeRuleEnabled(auth, enabled) {
  assertGeneralAdmin(auth);
  const settings = await getOfficePresenceSettings({ fresh: true });
  if (enabled && !settings.networks.length) throw new Error("Cadastre a rede da imobiliária antes de ligar a regra.");
  return saveSettings({ ...settings, enabled: Boolean(enabled) });
}

// "Liberar hoje": dono ou gestora (só quem ela enxerga na equipe).
// Motivo da liberação manual (dono, 2026-10-14): "external" = Liberar hoje (trabalho externo);
// "arrived" = Chegou e não conectou ao Wi-Fi. Sem coluna própria: o motivo vai no campo ip
// da chegada manual (OFFICE_ARRIVED_MARKER), que nunca é um IP de verdade nesse caso.
export const OFFICE_ARRIVED_MARKER = "manual:chegou-sem-wifi";

export async function releaseOfficeToday(auth, userId, reason = "external") {
  assertGeneralAdminOrManager(auth);
  const visible = await listVisibleTeamProfiles(auth);
  if (!visible.some((profile) => profile.id === userId)) throw new Error("Você não pode liberar este usuário.");
  const releasedBy = auth.realProfile?.id || auth.profile?.id || null;
  const { data, error } = await db().rpc("register_office_checkin", { p_user_id: userId, p_source: "manual", p_ip: reason === "arrived" ? OFFICE_ARRIVED_MARKER : null, p_released_by: releasedBy });
  if (error) throw error;
  return { validUntil: data || null };
}
