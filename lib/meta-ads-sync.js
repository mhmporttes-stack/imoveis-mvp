import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import {
  META_ADS_ATTRIBUTION_WINDOW,
  getMetaAdsAccessToken,
  getMetaAdsAccountPath,
  getMetaAdsAdAccountId,
  getMetaAdsBackfillStartDate,
  getMetaAdsConfigStatus,
  getMetaAdsGraphBaseUrl,
  getMetaAdsSyncWindowDays,
  hasMetaAdsReadConfig
} from "./meta-ads-config";

// Sincronização de LEITURA (Fase 1) com a Meta Marketing API — fetch direto
// (mesmo padrão de lib/meta-conversions-api.js e lib/document-analysis.js,
// sem SDK novo). Nenhuma função aqui cria, edita, ativa ou pausa nada na
// Meta — só GET.
//
// Nomes de action_type abaixo (LEAD_ACTION_TYPES/LANDING_PAGE_VIEW_ACTION_TYPES)
// são os nomes historicamente estáveis da Marketing API para o evento "Lead"
// de formulário/site e para "landing_page_view" — mas action_type pode variar
// por tipo de anúncio/objetivo (lead ads nativo vs. site). Ao ligar uma conta
// real, confira contra os "actions" retornados de fato (ficam preservados
// em actions_raw) e ajuste esta lista se algum action_type novo aparecer sem
// ser capturado — por design isso gera um aviso (ver extractActionValue),
// nunca falha silenciosamente.
const LEAD_ACTION_TYPES = ["lead", "onsite_conversion.lead_grouped", "leadgen_grouped"];
const LANDING_PAGE_VIEW_ACTION_TYPES = ["landing_page_view"];

const MAX_PAGES_PER_CALL = 50; // trava de segurance contra loop de paginação sem fim
const MAX_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Nunca loga token nem URL completa com token — só o path, pra diagnosticar
// sem expor segredo em log algum (requisito de segurança da Fase 1).
function redactedPath(path) {
  return String(path || "").split("?")[0];
}

function isRetryableStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

// GET de baixo nível com retry/backoff — erros transitórios e rate limit
// (HTTP 429/5xx, ou o código de rate limit que a própria Graph API embute
// no corpo do erro) tentam de novo; erro definitivo (token inválido,
// permissão faltando) propaga imediatamente, sem retry inútil.
async function graphGet(path, params = {}) {
  const token = getMetaAdsAccessToken();
  const url = new URL(`${getMetaAdsGraphBaseUrl()}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }
  url.searchParams.set("access_token", token);

  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let response;
    try {
      response = await fetch(url.toString());
    } catch (networkError) {
      lastError = new Error(`Falha de rede ao chamar ${redactedPath(path)}: ${networkError?.message || networkError}`);
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      continue;
    }

    if (response.ok) return response.json();

    const body = await response.json().catch(() => ({}));
    const errorCode = body?.error?.code;
    const errorSubcode = body?.error?.error_subcode;
    const isRateLimit = errorCode === 4 || errorCode === 17 || errorCode === 32 || errorCode === 613;
    const message = body?.error?.message || `HTTP ${response.status}`;

    if ((isRetryableStatus(response.status) || isRateLimit) && attempt < MAX_RETRIES) {
      lastError = new Error(`${redactedPath(path)}: ${message} (code=${errorCode}, subcode=${errorSubcode})`);
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      continue;
    }

    throw new Error(`Erro na Graph API em ${redactedPath(path)}: ${message} (status=${response.status}, code=${errorCode})`);
  }
  throw lastError || new Error(`Falha desconhecida ao chamar ${redactedPath(path)}`);
}

// Segue "paging.next" (a própria Meta já embute o access_token na URL
// seguinte — nunca reconstruímos essa URL manualmente, só seguimos e
// redigimos ao logar). Trava em MAX_PAGES_PER_CALL para nunca rodar
// indefinidamente por engano.
async function graphGetAllPages(path, params) {
  const results = [];
  let page = await graphGet(path, params);
  results.push(...(page?.data || []));
  let pages = 1;

  while (page?.paging?.next && pages < MAX_PAGES_PER_CALL) {
    let response;
    try {
      response = await fetch(page.paging.next);
    } catch (networkError) {
      console.warn(`Falha ao paginar ${redactedPath(path)}:`, networkError?.message || networkError);
      break;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      console.warn(`Falha ao paginar ${redactedPath(path)}:`, body?.error?.message || response.status);
      break;
    }
    page = await response.json();
    results.push(...(page?.data || []));
    pages += 1;
  }

  if (pages >= MAX_PAGES_PER_CALL) {
    console.warn(`Paginação de ${redactedPath(path)} atingiu o limite de ${MAX_PAGES_PER_CALL} páginas — resultado pode estar incompleto.`);
  }

  return results;
}

// Soma o valor de "actions" cujo action_type bate com qualquer um dos
// candidatos — nunca assume que a métrica vem como campo escalar simples.
// Retorna null (não 0) quando a lista de actions nem existe, para distinguir
// "não houve nenhuma ação" de "não conseguimos nem checar".
function extractActionValue(actions, actionTypeCandidates) {
  if (!Array.isArray(actions)) return null;
  const matched = actions.filter((action) => actionTypeCandidates.includes(action?.action_type));
  if (!matched.length) return 0;
  return matched.reduce((sum, action) => sum + (Number(action?.value) || 0), 0);
}

function extractCostPerAction(costPerActionType, actionTypeCandidates) {
  if (!Array.isArray(costPerActionType)) return null;
  const matched = costPerActionType.find((item) => actionTypeCandidates.includes(item?.action_type));
  return matched ? Number(matched.value) || null : null;
}

function getClient() {
  if (!hasSupabaseAdminConfig) throw new Error("Supabase administrativo não configurado.");
  return getSupabaseAdminClient();
}

function todayIso(timeZone) {
  return new Date().toLocaleDateString("en-CA", { timeZone: timeZone || "UTC" }); // YYYY-MM-DD
}

function addDaysIso(dateIso, days) {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// --- Metadados da conta -----------------------------------------------

export async function syncMetaAdAccount() {
  const adAccountId = getMetaAdsAdAccountId();
  const data = await graphGet(`/${getMetaAdsAccountPath()}`, { fields: "name,currency,timezone_name" });

  const supabase = getClient();
  const { error } = await supabase.from("meta_ad_accounts").upsert(
    {
      ad_account_id: adAccountId,
      name: data.name || "",
      currency: data.currency || "",
      timezone_name: data.timezone_name || "UTC",
      raw: data,
      last_synced_at: new Date().toISOString()
    },
    { onConflict: "ad_account_id" }
  );
  if (error) throw error;

  const { error: stateError } = await supabase
    .from("meta_ad_sync_state")
    .upsert({ ad_account_id: adAccountId }, { onConflict: "ad_account_id", ignoreDuplicates: true });
  if (stateError) throw stateError;

  return { adAccountId, name: data.name || "", currency: data.currency || "", timezoneName: data.timezone_name || "UTC" };
}

async function getAccountTimezone(adAccountId) {
  const supabase = getClient();
  const { data } = await supabase.from("meta_ad_accounts").select("timezone_name").eq("ad_account_id", adAccountId).maybeSingle();
  return data?.timezone_name || "UTC";
}

// --- Entidades (campanha/conjunto/anúncio) ------------------------------

const EFFECTIVE_STATUS_FILTER = [
  "ACTIVE",
  "PAUSED",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "ARCHIVED",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
  "IN_PROCESS",
  "WITH_ISSUES"
];

const ENTITY_EDGES = {
  campaign: { edge: "campaigns", fields: "id,name,status,objective,effective_status" },
  adset: { edge: "adsets", fields: "id,name,status,effective_status,campaign_id,targeting" },
  ad: { edge: "ads", fields: "id,name,status,effective_status,adset_id" }
};

function parentIdFor(entityType, row) {
  if (entityType === "adset") return row.campaign_id || null;
  if (entityType === "ad") return row.adset_id || null;
  return null;
}

export async function syncMetaAdEntities() {
  const adAccountId = getMetaAdsAdAccountId();
  const supabase = getClient();
  const counts = {};

  for (const entityType of ["campaign", "adset", "ad"]) {
    const { edge, fields } = ENTITY_EDGES[entityType];
    // effective_status inclui pausadas/arquivadas — a auditoria de
    // localização (Marília/SP) precisa ver campanhas mesmo pausadas, não só
    // as ativas. NUNCA inclua "DELETED" aqui — a Graph API rejeita esse
    // filtro neste endpoint com "Não é possível fazer uma solicitação para
    // objetos excluídos" (code 100, subcode 1815001), erro real encontrado
    // em produção ao validar a Fase 1. CAMPAIGN_PAUSED/ADSET_PAUSED são
    // obrigatórios: sem eles, conjuntos e anúncios dentro de uma campanha
    // pausada simplesmente não aparecem na listagem (também encontrado na
    // validação real).
    const rows = await graphGetAllPages(`/${getMetaAdsAccountPath()}/${edge}`, {
      fields,
      limit: 200,
      effective_status: JSON.stringify(EFFECTIVE_STATUS_FILTER)
    });

    const records = rows.map((row) => ({
      ad_account_id: adAccountId,
      entity_type: entityType,
      entity_id: String(row.id),
      parent_id: parentIdFor(entityType, row) ? String(parentIdFor(entityType, row)) : null,
      name: row.name || "",
      status: row.effective_status || row.status || "UNKNOWN",
      objective: entityType === "campaign" ? row.objective || null : null,
      targeting: entityType === "adset" ? row.targeting || null : null,
      raw: row,
      last_synced_at: new Date().toISOString()
    }));

    if (records.length) {
      const { error } = await supabase
        .from("meta_ad_entities")
        .upsert(records, { onConflict: "ad_account_id,entity_type,entity_id" });
      if (error) throw error;
    }
    counts[entityType] = records.length;
  }

  return counts;
}

// --- Insights (métricas) -------------------------------------------------

const INSIGHTS_FIELDS = [
  "date_start",
  "date_stop",
  "campaign_id",
  "adset_id",
  "ad_id",
  "spend",
  "impressions",
  "clicks",
  "reach",
  "frequency",
  "cpm",
  "cpc",
  "ctr",
  "actions",
  "cost_per_action_type"
].join(",");

// Uma linha por (entidade, dia) — SEMPRE consultada diretamente naquele
// nível (level=campaign|adset|ad). Nunca inferimos reach/frequency/cpm/
// ctr/cpc de um nível somando o nível abaixo, porque essas métricas não são
// aditivas (ex.: reach de campanha não é soma do reach dos anúncios —
// o mesmo usuário pode ter sido alcançado por mais de um anúncio).
export async function syncMetaAdInsights({ level, since, until }) {
  const adAccountId = getMetaAdsAdAccountId();
  const rows = await graphGetAllPages(`/${getMetaAdsAccountPath()}/insights`, {
    level,
    fields: INSIGHTS_FIELDS,
    time_increment: 1,
    time_range: JSON.stringify({ since, until }),
    limit: 500
  });

  const idField = `${level}_id`;
  const supabase = getClient();
  const nowIso = new Date().toISOString();

  const records = rows
    .filter((row) => row[idField])
    .map((row) => {
      const leads = extractActionValue(row.actions, LEAD_ACTION_TYPES);
      const landingPageViews = extractActionValue(row.actions, LANDING_PAGE_VIEW_ACTION_TYPES);
      const cplFromApi = extractCostPerAction(row.cost_per_action_type, LEAD_ACTION_TYPES);
      const spend = Number(row.spend) || 0;
      const cpl = cplFromApi !== null ? cplFromApi : leads > 0 ? spend / leads : null;

      if (leads === null) {
        console.warn(
          `syncMetaAdInsights: nenhum action_type de lead reconhecido para ${level} ${row[idField]} em ${row.date_start} — confira LEAD_ACTION_TYPES contra actions_raw.`
        );
      }

      return {
        ad_account_id: adAccountId,
        entity_type: level,
        entity_id: String(row[idField]),
        date: row.date_start,
        date_start: row.date_start,
        date_stop: row.date_stop,
        attribution_window: META_ADS_ATTRIBUTION_WINDOW,
        spend,
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        landing_page_views: landingPageViews || 0,
        leads: leads || 0,
        reach: row.reach !== undefined ? Number(row.reach) : null,
        frequency: row.frequency !== undefined ? Number(row.frequency) : null,
        cpm: row.cpm !== undefined ? Number(row.cpm) : null,
        ctr: row.ctr !== undefined ? Number(row.ctr) : null,
        cpc: row.cpc !== undefined ? Number(row.cpc) : null,
        cpl,
        actions_raw: row.actions || [],
        raw: row,
        synced_at: nowIso
      };
    });

  if (records.length) {
    const { error } = await supabase
      .from("meta_ad_insights")
      .upsert(records, { onConflict: "ad_account_id,entity_type,entity_id,date" });
    if (error) throw error;
  }

  return records.length;
}

// --- Orquestração --------------------------------------------------------

function missingConfigResult(missing) {
  return { status: "failed", reason: "missing_config", missing, steps: [], entitiesSynced: 0, insightsSynced: 0, errors: [] };
}

async function runSteps(steps) {
  const result = { steps: [], errors: [], entitiesSynced: 0, insightsSynced: 0 };
  for (const step of steps) {
    try {
      const value = await step.run();
      result.steps.push({ name: step.name, ok: true });
      if (step.name === "entities") result.entitiesSynced = Object.values(value || {}).reduce((sum, count) => sum + count, 0);
      if (step.name.startsWith("insights:")) result.insightsSynced += value || 0;
    } catch (error) {
      console.error(`meta-ads-sync: etapa "${step.name}" falhou:`, error?.message || error);
      result.steps.push({ name: step.name, ok: false, error: error?.message || String(error) });
      result.errors.push({ step: step.name, message: error?.message || String(error) });
    }
  }
  const essentialFailed = result.steps.every((step) => !step.ok);
  result.status = essentialFailed ? "failed" : result.errors.length ? "partial" : "success";
  return result;
}

// Só o dia corrente, nível "ad" (o mais granular — cobre os outros níveis
// por drill-down na tela) para reduzir volume de chamadas no ciclo mais
// frequente. Campanha/conjunto ficam para a consolidação diária.
export async function runIntradaySync() {
  const { configured, missing } = getMetaAdsConfigStatus();
  if (!configured) return missingConfigResult(missing);

  const adAccountId = getMetaAdsAdAccountId();
  const timezone = (await getAccountTimezone(adAccountId).catch(() => "UTC")) || "UTC";
  const today = todayIso(timezone);

  const result = await runSteps([
    { name: "account", run: syncMetaAdAccount },
    { name: "insights:ad", run: () => syncMetaAdInsights({ level: "ad", since: today, until: today }) }
  ]);

  await getClient()
    .from("meta_ad_sync_state")
    .upsert(
      { ad_account_id: adAccountId, last_intraday_sync_at: new Date().toISOString(), last_intraday_status: result.status, updated_at: new Date().toISOString() },
      { onConflict: "ad_account_id" }
    );

  return { ...result, adAccountId, date: today };
}

// Reconsulta a JANELA MÓVEL (META_ADS_SYNC_WINDOW_DAYS) dos três níveis —
// é aqui que ajustes retroativos de atribuição da Meta são incorporados.
export async function runDailyConsolidation() {
  const { configured, missing } = getMetaAdsConfigStatus();
  if (!configured) return missingConfigResult(missing);

  const adAccountId = getMetaAdsAdAccountId();
  const timezone = (await getAccountTimezone(adAccountId).catch(() => "UTC")) || "UTC";
  const today = todayIso(timezone);
  const windowDays = getMetaAdsSyncWindowDays();
  const since = addDaysIso(today, -windowDays);

  const result = await runSteps([
    { name: "account", run: syncMetaAdAccount },
    { name: "entities", run: syncMetaAdEntities },
    { name: "insights:campaign", run: () => syncMetaAdInsights({ level: "campaign", since, until: today }) },
    { name: "insights:adset", run: () => syncMetaAdInsights({ level: "adset", since, until: today }) },
    { name: "insights:ad", run: () => syncMetaAdInsights({ level: "ad", since, until: today }) }
  ]);

  await getClient()
    .from("meta_ad_sync_state")
    .upsert(
      { ad_account_id: adAccountId, last_daily_consolidation_at: new Date().toISOString(), last_daily_status: result.status, updated_at: new Date().toISOString() },
      { onConflict: "ad_account_id" }
    );

  return { ...result, adAccountId, since, until: today, windowDays };
}

// Retomável: avança em blocos mensais a partir de backfill_completed_through
// (ou de META_ADS_BACKFILL_START_DATE na primeira vez). Nunca duplica —
// UPSERT garante idempotência mesmo se um bloco for reprocessado depois de
// uma interrupção. Não é chamado pelo cron — é disparado sob demanda
// (script em scratch/, mesma convenção do projeto para scripts descartáveis).
export async function runBackfill({ startDate } = {}) {
  const { configured, missing } = getMetaAdsConfigStatus();
  if (!configured) return missingConfigResult(missing);

  const adAccountId = getMetaAdsAdAccountId();
  const configuredStart = startDate || getMetaAdsBackfillStartDate();
  if (!configuredStart) {
    return { status: "failed", reason: "missing_start_date", missing: ["META_ADS_BACKFILL_START_DATE"], steps: [], entitiesSynced: 0, insightsSynced: 0, errors: [] };
  }

  await syncMetaAdAccount();
  const timezone = (await getAccountTimezone(adAccountId).catch(() => "UTC")) || "UTC";
  const today = todayIso(timezone);
  const yesterday = addDaysIso(today, -1); // hoje é coberto pelo intraday/daily, não pelo backfill

  const supabase = getClient();
  const { data: state } = await supabase
    .from("meta_ad_sync_state")
    .select("backfill_completed_through")
    .eq("ad_account_id", adAccountId)
    .maybeSingle();

  let cursor = state?.backfill_completed_through ? addDaysIso(state.backfill_completed_through, 1) : configuredStart;
  if (cursor < configuredStart) cursor = configuredStart;

  await supabase
    .from("meta_ad_sync_state")
    .upsert({ ad_account_id: adAccountId, backfill_started_at: new Date().toISOString(), backfill_status: "in_progress" }, { onConflict: "ad_account_id" });

  const chunks = [];
  let insightsSynced = 0;
  const errors = [];

  while (cursor <= yesterday) {
    const chunkEnd = addDaysIso(cursor, 30) > yesterday ? yesterday : addDaysIso(cursor, 30);
    try {
      for (const level of ["campaign", "adset", "ad"]) {
        insightsSynced += await syncMetaAdInsights({ level, since: cursor, until: chunkEnd });
      }
      await supabase
        .from("meta_ad_sync_state")
        .upsert({ ad_account_id: adAccountId, backfill_completed_through: chunkEnd, updated_at: new Date().toISOString() }, { onConflict: "ad_account_id" });
      chunks.push({ since: cursor, until: chunkEnd, ok: true });
    } catch (error) {
      console.error(`runBackfill: bloco ${cursor}..${chunkEnd} falhou:`, error?.message || error);
      chunks.push({ since: cursor, until: chunkEnd, ok: false, error: error?.message || String(error) });
      errors.push({ step: `backfill:${cursor}..${chunkEnd}`, message: error?.message || String(error) });
      break; // não avança o cursor além de um bloco que falhou — retomável exatamente daqui
    }
    cursor = addDaysIso(chunkEnd, 1);
  }

  const finalStatus = errors.length ? (chunks.some((c) => c.ok) ? "partial" : "failed") : "success";
  await supabase
    .from("meta_ad_sync_state")
    .upsert({ ad_account_id: adAccountId, backfill_status: cursor > yesterday ? "completed" : finalStatus === "failed" ? "failed" : "in_progress", updated_at: new Date().toISOString() }, { onConflict: "ad_account_id" });

  return { status: finalStatus, adAccountId, startDate: configuredStart, coveredThrough: chunks.filter((c) => c.ok).at(-1)?.until || null, chunks, insightsSynced, entitiesSynced: 0, errors };
}
