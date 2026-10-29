import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabase";
import { createAlertDeliveries } from "@/lib/crm-alerts";
import { assertGeneralAdmin } from "@/lib/admin-access";
import { CACHE_TAGS, serverCache } from "@/lib/server-cache-core.mjs";
import {
  BANK_RATES_CODE,
  ECON_INDICATORS,
  HISTORY_START,
  MCMV_SETTINGS_ID,
  RADAR_BANK_MODALITY_PATTERN,
  accumulatedStats,
  bankComparison,
  buildEconomicAlert,
  buildWhatChanged,
  computeCorrection,
  detectNewReference,
  freshness,
  indicatorByCode,
  normalizeMcmvSettings,
  parseOlindaRates,
  parseSgs,
  parseSidra,
  pickLaborCode,
  radarBankTile,
  radarItem,
  radarMcmvTile,
  radarTile,
  recipientsForIndicator,
  referenceLabel,
  toValueRows
} from "@/lib/economic-indicators-core.mjs";

// Indicadores Econômicos (dono, 2026-10-29 — ECON-1). Coleta das fontes oficiais (cron diário), leitura para a tela e o
// Radar, calculadora de correção e alertas pela Central de Alertas EXISTENTE (Informativo, sem push). Regras puras em
// lib/economic-indicators-core.mjs. A tela só lê o banco; a rede só é usada pelo cron.

const TIMEOUT_MS = 12000;
const ATTEMPTS = 3;
const PAGE = 1000;
export const ECON_SCHEMA_MESSAGE = "As tabelas dos Indicadores Econômicos ainda não foram criadas no banco (migration 20261029120000_economic_indicators.sql).";

function db() {
  if (!hasSupabaseAdminConfig) throw new Error("Supabase não configurado.");
  return getSupabaseAdminClient();
}

export function isMissingEconSchema(error) {
  return error?.code === "42P01" || error?.code === "PGRST205" || /econ_[a-z_]+/.test(String(error?.message || "")) && /does not exist|schema cache/i.test(String(error?.message || ""));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// GET com tempo-limite, 3 tentativas e espera crescente (1 s, 3 s). Erro final sobe com a URL sem segredo (fontes públicas).
async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error("resposta não é JSON");
      }
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) await sleep(attempt === 1 ? 1000 : 3000);
    }
  }
  throw new Error(`${lastError?.message || lastError} (${url.split("?")[0]})`);
}

const brDate = (iso) => iso.split("-").reverse().join("/");

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function minusDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function fetchIndicatorRows(indicator, latestReference) {
  if (indicator.source === "bcb_sgs") {
    // 1ª coleta: histórico desde HISTORY_START. Depois: janela curta para pegar período novo e revisões.
    const start = latestReference ? minusDays(latestReference, indicator.frequency === "daily" ? 20 : 120) : HISTORY_START;
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${indicator.sourceRef}/dados?formato=json&dataInicial=${brDate(start)}&dataFinal=${brDate(todayIso())}`;
    return parseSgs(await fetchJson(url));
  }
  if (indicator.source === "ibge_sidra") {
    const count = latestReference ? 6 : indicator.frequency === "quarterly" ? 32 : 96;
    const classification = indicator.sidraClassification ? `/${indicator.sidraClassification}` : "";
    const url = `https://apisidra.ibge.gov.br/values/${indicator.sourceRef}/p/last%20${count}${classification}`;
    return parseSidra(await fetchJson(url), indicator.frequency);
  }
  throw new Error(`Fonte desconhecida: ${indicator.source}`);
}

async function loadStatusMap() {
  const { data, error } = await db().from("econ_indicator_status").select("*");
  if (error) throw error;
  return new Map((data || []).map((row) => [row.indicator_code, row]));
}

async function saveStatus(code, patch, previous) {
  const now = new Date().toISOString();
  const row = { indicator_code: code, last_checked_at: now, updated_at: now, ...patch };
  if (patch.last_error) row.consecutive_failures = (previous?.consecutive_failures || 0) + 1;
  else row.consecutive_failures = 0;
  const { error } = await db().from("econ_indicator_status").upsert(row, { onConflict: "indicator_code" });
  if (error) throw error;
}

async function upsertChunks(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db().from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw error;
  }
}

async function loadSeries(code, { from = null, to = null, withFetchedAt = false } = {}) {
  const all = [];
  for (let page = 0; page < 20; page += 1) {
    let query = db().from("econ_indicator_values").select(withFetchedAt ? "reference_date, value, reference_label, fetched_at" : "reference_date, value, reference_label").eq("indicator_code", code).order("reference_date", { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (from) query = query.gte("reference_date", from);
    if (to) query = query.lte("reference_date", to);
    const { data, error } = await query;
    if (error) throw error;
    all.push(...(data || []).map((row) => ({ ...row, value: Number(row.value) })));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

// ---------- Coleta (cron) ----------

async function collectIndicator(indicator, previous) {
  try {
    const rows = await fetchIndicatorRows(indicator, previous?.latest_reference || null);
    if (!rows.length) throw new Error("a fonte não devolveu nenhum valor");
    await upsertChunks("econ_indicator_values", toValueRows(indicator.code, rows), "indicator_code,reference_date");
    const latest = rows[rows.length - 1].reference_date;
    const newest = previous?.latest_reference && previous.latest_reference > latest ? previous.latest_reference : latest;
    await saveStatus(indicator.code, { latest_reference: newest, last_success_at: new Date().toISOString(), last_error: null }, previous);
    return { code: indicator.code, ok: true, rows: rows.length, newReference: detectNewReference(previous?.latest_reference || null, rows) };
  } catch (error) {
    // Último valor válido fica intacto no banco; só o estado registra a falha (a tela mostra "falha na atualização").
    console.error(`Indicadores Econômicos: falha ao coletar ${indicator.code}:`, error?.message || error);
    await saveStatus(indicator.code, { last_error: String(error?.message || error).slice(0, 500), last_error_at: new Date().toISOString() }, previous).catch(() => {});
    return { code: indicator.code, ok: false, error: String(error?.message || error) };
  }
}

async function collectBankRates(previous) {
  try {
    const since = previous?.latest_reference ? previous.latest_reference.slice(0, 7) : HISTORY_START.slice(0, 7);
    const url = `https://olinda.bcb.gov.br/olinda/servico/taxaJuros/versao/v2/odata/TaxasJurosMensalPorMes?$format=json&$top=10000&$filter=${encodeURIComponent(`anoMes ge '${since}'`)}`;
    const rows = parseOlindaRates(await fetchJson(url));
    if (!rows.length) throw new Error("a fonte não devolveu nenhuma taxa");
    await upsertChunks("econ_bank_rates", rows, "reference_month,modality,cnpj8");
    const latest = rows.map((row) => row.reference_month).sort().at(-1);
    await saveStatus(BANK_RATES_CODE, { latest_reference: latest, last_success_at: new Date().toISOString(), last_error: null }, previous);
    return { code: BANK_RATES_CODE, ok: true, rows: rows.length };
  } catch (error) {
    console.error("Indicadores Econômicos: falha ao coletar taxas por banco:", error?.message || error);
    await saveStatus(BANK_RATES_CODE, { last_error: String(error?.message || error).slice(0, 500), last_error_at: new Date().toISOString() }, previous).catch(() => {});
    return { code: BANK_RATES_CODE, ok: false, error: String(error?.message || error) };
  }
}

export async function runEconomicIndicatorsCollection() {
  const statuses = await loadStatusMap();
  // Até 3 consultas ao mesmo tempo: no teste de 2026-10-29 o SGS devolveu, de forma intermitente, a página "Requisição inválida" (as tentativas com espera cobrem).
  const tasks = [...ECON_INDICATORS.map((indicator) => () => collectIndicator(indicator, statuses.get(indicator.code))), () => collectBankRates(statuses.get(BANK_RATES_CODE))];
  const results = [];
  for (let i = 0; i < tasks.length; i += 3) results.push(...(await Promise.all(tasks.slice(i, i + 3).map((task) => task()))));
  serverCache.invalidate(CACHE_TAGS.ECON_RADAR);
  const alerts = await sendEconomicAlerts(results.filter((r) => r.ok && r.newReference)).catch((error) => {
    console.error("Indicadores Econômicos: falha ao gerar alertas:", error?.message || error);
    return { error: String(error?.message || error) };
  });
  return { results: results.map(({ code, ok, rows, newReference, error }) => ({ code, ok, rows, newReference, error })), alerts };
}

async function sendEconomicAlerts(fresh) {
  if (!fresh.length) return { created: 0 };
  const [{ data: users, error: usersError }, { data: prefs, error: prefsError }] = await Promise.all([
    db().from("admin_users").select("id, role, status"),
    db().from("econ_alert_preferences").select("user_id, indicator_code, enabled")
  ]);
  if (usersError) throw usersError;
  if (prefsError) throw prefsError;
  const deliveries = [];
  for (const item of fresh) {
    const indicator = indicatorByCode(item.code);
    const rows = await loadSeries(item.code, { from: minusDays(item.newReference, 400) });
    const alert = buildEconomicAlert(indicator, rows, item.newReference);
    if (!alert) continue;
    for (const recipientId of recipientsForIndicator(users, prefs, item.code)) {
      deliveries.push({ definition_id: null, recipient_id: recipientId, kind: "informative", title: alert.title, body: alert.body, dedupe_key: alert.dedupe_key, context: { source: "economic_indicators", indicator: item.code, reference: item.newReference, link: "/admin/indicadores-economicos" } });
    }
  }
  const created = await createAlertDeliveries(deliveries);
  return { created: created.length };
}

// ---------- Leitura (tela, Radar) ----------

export async function getEconomicOverview() {
  const since = minusDays(todayIso(), 800);
  const [statuses, ...series] = await Promise.all([loadStatusMap(), ...ECON_INDICATORS.map((indicator) => loadSeries(indicator.code, { from: since }))]);
  const byCode = Object.fromEntries(ECON_INDICATORS.map((indicator, i) => [indicator.code, series[i]]));
  const now = new Date();
  const indicators = ECON_INDICATORS.map((indicator) => {
    const rows = byCode[indicator.code];
    const status = statuses.get(indicator.code) || {};
    const stats = indicator.kind === "monthly_rate" ? accumulatedStats(rows) : { latest: rows.at(-1) || null, previous: rows.at(-2) || null, ytd: null, twelveMonths: null };
    return {
      code: indicator.code,
      latest: stats.latest ? { ...stats.latest, label: referenceLabel(indicator, stats.latest.reference_date, stats.latest.reference_label) } : null,
      previous: stats.previous ? { ...stats.previous, label: referenceLabel(indicator, stats.previous.reference_date, stats.previous.reference_label) } : null,
      ytd: stats.ytd,
      twelveMonths: stats.twelveMonths,
      lastSuccessAt: status.last_success_at || null,
      lastCheckedAt: status.last_checked_at || null,
      lastError: status.last_error || null,
      freshness: freshness(indicator, { latestReference: rows.at(-1)?.reference_date || null, lastSuccessAt: status.last_success_at, lastErrorAt: status.last_error_at, now })
    };
  });
  const bank = await loadBankRates();
  const bankStatus = statuses.get(BANK_RATES_CODE) || {};
  return {
    indicators,
    whatChanged: buildWhatChanged(byCode),
    bankRates: { ...bank, lastSuccessAt: bankStatus.last_success_at || null, lastError: bankStatus.last_error || null }
  };
}

async function loadBankRates() {
  const { data: latestRow, error: latestError } = await db().from("econ_bank_rates").select("reference_month").order("reference_month", { ascending: false }).limit(1).maybeSingle();
  if (latestError) throw latestError;
  if (!latestRow) return { month: null, modalities: [] };
  const { data, error } = await db().from("econ_bank_rates").select("reference_month, modality, institution, cnpj8, position, rate_month, rate_year").eq("reference_month", latestRow.reference_month);
  if (error) throw error;
  const modalities = [...new Set((data || []).map((row) => row.modality))].sort();
  return { month: latestRow.reference_month, modalities: modalities.map((modality) => ({ modality, ...bankComparison(data, modality) })) };
}

export async function getEconomicSeries(code, { from = null, to = null } = {}) {
  const indicator = indicatorByCode(code);
  if (!indicator) return null;
  return loadSeries(code, { from, to });
}

// Radar Econômico (card do cabeçalho, todas as telas do painel). Tira ECON-2 (dono, 2026-10-29): Selic, Caixa + média
// dos bancos, TR, INCC-DI, IPCA, renda OU desemprego e MCMV (cadastro manual) com séries de 12 meses. Uma leitura por
// instância a cada 30 s (cache em memória, lib/server-cache-core.mjs), invalidada pela coleta e pelo cadastro do MCMV.
// `items` (IPCA e INCC-DI) continua no formato antigo.
const RADAR_SERIES_CODES = ["selic", "tr", "incc", "ipca", "renda", "desemprego"];
const RADAR_STATUS_CODES = [...RADAR_SERIES_CODES, BANK_RATES_CODE];

export async function getEconomicRadar() {
  return serverCache.memo(CACHE_TAGS.ECON_RADAR, "radar", 30_000, loadEconomicRadar);
}

async function loadEconomicRadar() {
  const today = todayIso();
  const since = minusDays(today, 430);
  const [statuses, bankRows, mcmv, ...series] = await Promise.all([
    loadStatusMap(),
    loadRadarBankRows(minusDays(today, 430)),
    readMcmvSettings(),
    ...RADAR_SERIES_CODES.map((code) => loadSeries(code, { from: since, withFetchedAt: true }))
  ]);
  const byCode = Object.fromEntries(RADAR_SERIES_CODES.map((code, i) => [code, series[i]]));
  const tile = (code) => radarTile(indicatorByCode(code), byCode[code], { today });
  const labor = pickLaborCode(byCode.renda, byCode.desemprego);
  const tiles = [tile("selic"), radarBankTile(bankRows, { today }), tile("tr"), tile("incc"), tile("ipca"), labor ? tile(labor) : null, radarMcmvTile(mcmv)].filter(Boolean);
  const items = ["ipca", "incc"].map((code) => radarItem(indicatorByCode(code), byCode[code]));
  const updated = RADAR_STATUS_CODES.map((code) => statuses.get(code)?.last_success_at).filter(Boolean).sort().at(-1) || null;
  const failing = RADAR_STATUS_CODES.some((code) => {
    const s = statuses.get(code);
    return s?.last_error_at && (!s.last_success_at || s.last_error_at > s.last_success_at);
  });
  return { items, tiles, updatedAt: updated, failing, today };
}

// Uma consulta: a modalidade padrão do comparativo (taxas de mercado, prefixado) de ~13 meses, todas as instituições. Do mais
// recente para o mais antigo: se passar do teto de 1000 linhas do PostgREST, corta o mês mais antigo, nunca o atual.
async function loadRadarBankRows(since) {
  const { data, error } = await db().from("econ_bank_rates").select("reference_month, modality, cnpj8, institution, rate_year, fetched_at").ilike("modality", "%mercado - Prefixado").gte("reference_month", since).order("reference_month", { ascending: false }).limit(1000);
  if (error) throw error;
  return (data || []).filter((row) => RADAR_BANK_MODALITY_PATTERN.test(row.modality));
}

// ---------- MCMV no Radar (cadastro manual do admin geral, crm_settings) ----------

async function readMcmvSettings() {
  const { data, error } = await db().from("crm_settings").select("setting_value, updated_at").eq("id", MCMV_SETTINGS_ID).maybeSingle();
  if (error) throw error;
  const parsed = normalizeMcmvSettings(data?.setting_value || {});
  return parsed.ok && parsed.value ? { ...parsed.value, updatedAt: data?.updated_at || null } : null;
}

export async function getMcmvSettings() {
  return readMcmvSettings();
}

export async function saveMcmvSettings(payload, auth) {
  assertGeneralAdmin(auth);
  const parsed = normalizeMcmvSettings(payload);
  if (!parsed.ok) return parsed;
  const { error } = await db().from("crm_settings").upsert({ id: MCMV_SETTINGS_ID, setting_value: parsed.value || {}, updated_by: auth?.profile?.id || null, updated_at: new Date().toISOString() });
  serverCache.invalidate(CACHE_TAGS.ECON_RADAR);
  if (error) throw error;
  return { ok: true, value: await readMcmvSettings() };
}

export async function calculateCorrection({ amount, indicator, startMonth, endMonth }) {
  const rows = await loadSeries(indicator, { from: `${startMonth}-01` });
  // Primeiro mês disponível no banco (para a mensagem "o CRM tem este índice a partir de…").
  const { data: firstRow, error } = await db().from("econ_indicator_values").select("reference_date, value, reference_label").eq("indicator_code", indicator).order("reference_date", { ascending: true }).limit(1).maybeSingle();
  if (error) throw error;
  return computeCorrection({ amount, indicator, startMonth, endMonth, rows: firstRow ? [{ ...firstRow, value: Number(firstRow.value) }, ...rows] : rows });
}

// ---------- Preferências de alerta (sempre do próprio usuário) ----------

export async function getMyAlertPreferences(userId) {
  const { data, error } = await db().from("econ_alert_preferences").select("indicator_code, enabled").eq("user_id", userId);
  if (error) throw error;
  const saved = new Map((data || []).map((row) => [row.indicator_code, row.enabled]));
  return ECON_INDICATORS.filter((indicator) => indicator.alert).map((indicator) => ({ code: indicator.code, name: indicator.name, enabled: saved.has(indicator.code) ? saved.get(indicator.code) : true }));
}

export async function setMyAlertPreference(userId, code, enabled) {
  const { error } = await db().from("econ_alert_preferences").upsert({ user_id: userId, indicator_code: code, enabled, updated_at: new Date().toISOString() }, { onConflict: "user_id,indicator_code" });
  if (error) throw error;
  return getMyAlertPreferences(userId);
}
