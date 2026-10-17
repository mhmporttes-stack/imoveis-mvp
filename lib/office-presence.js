import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assertGeneralAdmin, assertGeneralAdminOrManager } from "./admin-access";
import { isGeneralAdminAuth, listVisibleTeamProfiles } from "./admin-profiles";
import { resolvePresenceProfileId } from "./admin-presence-core.mjs";
import { getTodayInSaoPaulo } from "./daily-report";
import { absenceUntilIso, currentAbsence, ipMatchesNetworks, networkKey, officeStatus } from "./office-presence-core.mjs";

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
// userId -> último registro no Wi-Fi feito por esta instância (ms). A 1ª chegada do dia grava a chegada; as seguintes
// só renovam last_wifi_seen_at ("na imobiliária agora", 2026-10-15), no máximo a cada WIFI_SEEN_THROTTLE_MS.
const lastWifiWrite = new Map();
const WIFI_SEEN_THROTTLE_MS = 2 * 60 * 1000;

function db() {
  if (!hasSupabaseAdminConfig) throw new Error("Supabase administrativo não configurado.");
  return getSupabaseAdminClient();
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
    const now = Date.now();
    if (now - (lastWifiWrite.get(userId) || 0) < WIFI_SEEN_THROTTLE_MS) return;
    const settings = await getOfficePresenceSettings();
    if (!settings.networks.length || !ipMatchesNetworks(ip, settings.networks)) return;
    const { error } = await db().rpc("register_office_checkin", { p_user_id: userId, p_source: "wifi", p_ip: ip.slice(0, 64) });
    if (error) throw error;
    lastWifiWrite.set(userId, now);
  } catch (error) {
    console.warn("Presença na imobiliária: falha ao registrar chegada:", error?.message || error);
  }
}

// Map userId -> { validUntil, source, firstSeenAt, lastWifiSeenAt } da chegada que ainda vale (ou a mais recente).
export async function loadOfficeCheckins(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const result = new Map();
  if (!ids.length) return result;
  const since = new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await db()
    .from("office_presence_checkins")
    .select("user_id, valid_until, source, first_seen_at, ip, last_wifi_seen_at")
    .in("user_id", ids)
    .gte("valid_until", since)
    .order("valid_until", { ascending: false });
  if (error) throw error;
  for (const row of data || []) {
    if (!result.has(row.user_id)) result.set(row.user_id, { validUntil: row.valid_until, source: row.source === "manual" && row.ip === OFFICE_ARRIVED_MARKER ? "arrived" : row.source, firstSeenAt: row.first_seen_at, lastWifiSeenAt: row.last_wifi_seen_at || null });
  }
  return result;
}

// Situação do próprio usuário para o aviso "você está fora da roleta".
export async function getMyOfficeStatus(auth) {
  const userId = resolvePresenceProfileId(auth);
  const settings = await getOfficePresenceSettings();
  if (!userId || !settings.enabled) return { ruleEnabled: settings.enabled, eligible: true, active: false, validUntil: null, inRoulette: false };
  const [{ data: profile }, checkins, absences] = await Promise.all([
    db().from("admin_users").select("lead_distribution_enabled, status").eq("id", userId).maybeSingle(),
    loadOfficeCheckins([userId]),
    loadOfficeAbsences([userId])
  ]);
  const checkin = checkins.get(userId);
  const status = officeStatus({ ruleEnabled: true, validUntil: checkin?.validUntil || null, firstSeenAt: checkin?.firstSeenAt || null, absences: absences.get(userId) || [] });
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
  // Liberar por cima de "Ausente" não teria efeito (a chegada seria ignorada): pede o Desfazer antes.
  if (currentAbsence((await loadOfficeAbsences([userId])).get(userId) || [])) throw new Error("Esta pessoa está marcada como ausente. Toque em Desfazer antes de liberar.");
  const releasedBy = auth.realProfile?.id || auth.profile?.id || null;
  const { data, error } = await db().rpc("register_office_checkin", { p_user_id: userId, p_source: "manual", p_ip: reason === "arrived" ? OFFICE_ARRIVED_MARKER : null, p_released_by: releasedBy });
  if (error) throw error;
  return { validUntil: data || null };
}

// ── "Marcar ausente" (regra do dono, 2026-10-17) ──────────────────────────────
// Inverso do "Liberar hoje": dono (todos) ou gestora (só quem ela enxerga na equipe) marca a pessoa como AUSENTE até o
// fim de um dia. Enquanto vale, ela não conta como presente mesmo com o Wi-Fi detectando (aparelho usado por outra
// pessoa) e a chegada daquele período deixa de valer. A decisão da roleta continua no BANCO (office_presence_ok,
// migration 20261017120000); aqui só gravamos/lemos. Check-in nunca é apagado; "Desfazer" grava cleared_at.
const ABSENCES_TABLE = "office_presence_absences";
const MAX_ABSENCE_DAYS = 60;

function isMissingAbsencesTable(error) {
  return ["42P01", "PGRST205"].includes(error?.code) || String(error?.message || "").includes(ABSENCES_TABLE);
}

const ABSENCES_MIGRATION_MISSING = "A opção Ausente ainda não está ativa no banco (migration 20261017120000 pendente).";

// Map userId -> [{ id, markedAt, absentUntil, markedById, markedByName }] das ausências NÃO desfeitas que ainda podem
// anular alguma chegada (prazo nos últimos 4 dias ou futuro). Sem a tabela (migration não aplicada): Map vazio.
export async function loadOfficeAbsences(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const result = new Map();
  if (!ids.length) return result;
  const since = new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await db()
    .from(ABSENCES_TABLE)
    .select("id, user_id, marked_at, absent_until, marked_by")
    .in("user_id", ids)
    .is("cleared_at", null)
    .gte("absent_until", since);
  if (error) {
    if (isMissingAbsencesTable(error)) return result;
    throw error;
  }
  const markerIds = [...new Set((data || []).map((row) => row.marked_by).filter(Boolean))];
  const names = new Map();
  if (markerIds.length) {
    const { data: markers, error: markersError } = await db().from("admin_users").select("id, name, email").in("id", markerIds);
    if (markersError) throw markersError;
    for (const marker of markers || []) names.set(marker.id, marker.name || marker.email || "");
  }
  for (const row of data || []) {
    const list = result.get(row.user_id) || [];
    list.push({ id: row.id, markedAt: row.marked_at, absentUntil: row.absent_until, markedById: row.marked_by || null, markedByName: names.get(row.marked_by) || "" });
    result.set(row.user_id, list);
  }
  return result;
}

async function assertCanManageOfficeUser(auth, userId) {
  assertGeneralAdminOrManager(auth);
  const visible = await listVisibleTeamProfiles(auth);
  if (!userId || !visible.some((profile) => profile.id === userId)) throw new Error("Você não pode alterar a presença deste usuário.");
}

// untilDate = último dia ausente (AAAA-MM-DD, São Paulo): de hoje até 60 dias.
export async function markOfficeAbsent(auth, userId, untilDate) {
  await assertCanManageOfficeUser(auth, userId);
  const today = getTodayInSaoPaulo();
  const absentUntil = absenceUntilIso(untilDate);
  if (!absentUntil || untilDate < today) throw new Error("Escolha uma data de hoje em diante.");
  if (Date.parse(absentUntil) - Date.now() > MAX_ABSENCE_DAYS * 24 * 3600 * 1000) throw new Error(`Escolha uma data em até ${MAX_ABSENCE_DAYS} dias.`);
  const markedBy = auth.realProfile?.id || auth.profile?.id || null;
  const { data, error } = await db()
    .from(ABSENCES_TABLE)
    .insert({ user_id: userId, absent_until: absentUntil, marked_by: markedBy })
    .select("id, marked_at, absent_until")
    .single();
  if (error) {
    if (isMissingAbsencesTable(error)) throw new Error(ABSENCES_MIGRATION_MISSING);
    throw error;
  }
  return { absence: { id: data.id, markedAt: data.marked_at, absentUntil: data.absent_until, markedById: markedBy } };
}

// Desfazer: encerra as ausências ainda valendo (a linha fica como histórico). Os check-ins voltam a valer.
export async function clearOfficeAbsence(auth, userId) {
  await assertCanManageOfficeUser(auth, userId);
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from(ABSENCES_TABLE)
    .update({ cleared_at: now, cleared_by: auth.realProfile?.id || auth.profile?.id || null })
    .eq("user_id", userId)
    .is("cleared_at", null)
    .gt("absent_until", now)
    .select("id");
  if (error) {
    if (isMissingAbsencesTable(error)) throw new Error(ABSENCES_MIGRATION_MISSING);
    throw error;
  }
  return { cleared: (data || []).length };
}
