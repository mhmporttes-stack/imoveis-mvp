import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { getMetaAdsAdAccountId, hasMetaAdsReadConfig } from "./meta-ads-config";
import { fetchMetaAdPeriodReach, syncMetaAdCreatives } from "./meta-ads-sync";
import { zonedPlainDateToUtcIso } from "./daily-report";
import {
  adKindFor,
  addDaysIso,
  aggregateAdInsights,
  computeBenchmarks,
  deriveMetrics,
  evaluateAd,
  periodRange,
  shortCampaignName,
  statusLabelFor
} from "./meta-ads-board-core.mjs";

// Área ANÚNCIOS (pedido do dono, 2026-10-13) — SOMENTE LEITURA.
// Junta o que a sync já grava (meta_ad_entities/meta_ad_insights) com o
// cruzamento de origem do CRM (client_origins: ad_id do anúncio de WhatsApp
// ou utm_content do site = ID do anúncio). Nada aqui altera a Meta: as
// únicas chamadas à Graph API são GET (miniatura e alcance do período).

const CREATIVE_REFRESH_MS = 20 * 60 * 60 * 1000;
const PERIOD_REACH_TIMEOUT_MS = 6000;
const PAGE_SIZE = 1000;

function db() {
  if (!hasSupabaseAdminConfig) throw new Error("Supabase administrativo não configurado.");
  return getSupabaseAdminClient();
}

async function fetchAllRows(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function todayIn(timeZone) {
  return new Date().toLocaleDateString("en-CA", { timeZone: timeZone || "America/Sao_Paulo" });
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

function formatSyncedAt(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const day = date.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const time = date.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  if (day === todayIn("America/Sao_Paulo")) return `hoje às ${time}`;
  const [, month, dayOfMonth] = day.split("-");
  return `${dayOfMonth}/${month} às ${time}`;
}

function formatShortDate(iso) {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

async function loadEntities(supabase, adAccountId) {
  const { data, error } = await supabase
    .from("meta_ad_entities")
    .select("entity_type, entity_id, parent_id, name, status, objective, thumbnail_url, image_url, destination_type, creative_synced_at")
    .eq("ad_account_id", adAccountId);
  if (error) throw error;
  return data || [];
}

function needsCreativeRefresh(entities) {
  const ads = entities.filter((entity) => entity.entity_type === "ad");
  if (!ads.length) return false;
  const now = Date.now();
  return ads.some((ad) => !ad.creative_synced_at || now - new Date(ad.creative_synced_at).getTime() > CREATIVE_REFRESH_MS);
}

// Clientes do CRM por anúncio no período (contagem de clientes distintos;
// nunca nome nem telefone). Data do cadastro em São Paulo.
async function loadCrmLeadsByAd(supabase, since, until) {
  const fromIso = zonedPlainDateToUtcIso(since);
  const toIso = zonedPlainDateToUtcIso(addDaysIso(until, 1));
  const rows = await fetchAllRows((from, to) =>
    supabase
      .from("client_origins")
      .select("client_id, ad_id:source_metadata->>ad_id, utm_content:source_metadata->>utm_content")
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .order("created_at", { ascending: true })
      .range(from, to)
  );
  const byAd = new Map();
  for (const row of rows) {
    const adId = String(row.ad_id || row.utm_content || "").trim();
    if (!/^\d{6,}$/.test(adId) || !row.client_id) continue;
    if (!byAd.has(adId)) byAd.set(adId, new Set());
    byAd.get(adId).add(row.client_id);
  }
  return new Map([...byAd].map(([adId, clients]) => [adId, clients.size]));
}

// refreshCreatives: false = leitura pura (Henry, HENRY-1 "Leitura ampla", 2026-10-26): não renova as miniaturas (que grava
// no banco); números, períodos e cálculo são os mesmos da tela. A tela continua chamando sem o parâmetro (renova).
export async function getAdsBoard({ period = "7d", refreshCreatives = true } = {}) {
  const supabase = db();
  const adAccountId = getMetaAdsAdAccountId();
  if (!adAccountId) {
    return { configured: false, ads: [], summary: null, syncedAtLabel: "" };
  }

  const [{ data: account }, { data: syncState }] = await Promise.all([
    supabase.from("meta_ad_accounts").select("timezone_name").eq("ad_account_id", adAccountId).maybeSingle(),
    supabase.from("meta_ad_sync_state").select("last_intraday_sync_at, last_daily_consolidation_at").eq("ad_account_id", adAccountId).maybeSingle()
  ]);
  const today = todayIn(account?.timezone_name || "America/Sao_Paulo");
  const range = periodRange(period, today);
  const benchRange = periodRange("30d", today);
  const insightsSince = range.since < benchRange.since ? range.since : benchRange.since;

  let entities = await loadEntities(supabase, adAccountId);
  // Miniatura da Meta é URL assinada que expira: renova no máximo 1x a cada 20 h,
  // ao abrir a tela. Falha aqui nunca derruba a tela (fica sem foto).
  if (refreshCreatives && hasMetaAdsReadConfig() && needsCreativeRefresh(entities)) {
    try {
      await withTimeout(syncMetaAdCreatives(), 15000);
      entities = await loadEntities(supabase, adAccountId);
    } catch (error) {
      console.warn("anuncios: não foi possível atualizar as miniaturas:", error?.message || error);
    }
  }

  const [insightRows, crmByAd, periodReach] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("meta_ad_insights")
        .select("entity_id, date, spend, impressions, clicks, leads, frequency, actions_raw")
        .eq("ad_account_id", adAccountId)
        .eq("entity_type", "ad")
        .gte("date", insightsSince)
        .lte("date", today)
        .order("date", { ascending: true })
        .range(from, to)
    ),
    loadCrmLeadsByAd(supabase, range.since, range.until),
    hasMetaAdsReadConfig()
      ? withTimeout(fetchMetaAdPeriodReach(range), PERIOD_REACH_TIMEOUT_MS).catch((error) => {
          console.warn("anuncios: alcance do período indisponível:", error?.message || error);
          return new Map();
        })
      : Promise.resolve(new Map())
  ]);

  const byKey = new Map(entities.map((entity) => [`${entity.entity_type}:${entity.entity_id}`, entity]));
  const ads = entities.filter((entity) => entity.entity_type === "ad");
  const kindByAd = new Map();
  for (const ad of ads) {
    const adset = byKey.get(`adset:${ad.parent_id}`);
    const campaign = adset ? byKey.get(`campaign:${adset.parent_id}`) : null;
    kindByAd.set(String(ad.entity_id), adKindFor({ objective: campaign?.objective, destinationType: adset?.destination_type }));
  }

  const benchmarks = computeBenchmarks(insightRows.filter((row) => row.date >= benchRange.since), kindByAd);
  const totals = aggregateAdInsights(insightRows, range);

  const list = [];
  for (const ad of ads) {
    const id = String(ad.entity_id);
    const total = totals.get(id);
    const isActive = String(ad.status).toUpperCase() === "ACTIVE";
    if (!isActive && !(total?.spend > 0)) continue;

    const adset = byKey.get(`adset:${ad.parent_id}`);
    const campaign = adset ? byKey.get(`campaign:${adset.parent_id}`) : null;
    const kind = kindByAd.get(id);
    const reach = periodReach.get(id);
    const metrics = deriveMetrics(kind, total, {
      crmLeads: crmByAd.get(id) || 0,
      reach: reach?.reach ?? null,
      frequency: reach?.frequency ?? null
    });
    const health = evaluateAd({ kind, metrics }, benchmarks);

    list.push({
      id,
      name: ad.name || "Anúncio sem nome",
      campaignName: campaign?.name || "",
      campaignShort: shortCampaignName(campaign?.name || ""),
      adsetName: adset?.name || "",
      status: isActive ? "active" : "paused",
      statusLabel: statusLabelFor(ad.status),
      kind,
      objective: campaign?.objective || null,
      thumbnailUrl: ad.image_url || ad.thumbnail_url || "",
      metrics,
      health: { tone: health.tone },
      recommendations: health.recommendations,
      periodLabel: range.days === 1 ? "Hoje" : `${formatShortDate(range.since)} a ${formatShortDate(range.until)}`
    });
  }

  list.sort((a, b) => (a.status === b.status ? b.metrics.spend - a.metrics.spend : a.status === "active" ? -1 : 1));

  const paid = list.filter((ad) => ad.kind !== "outro");
  const summarySpend = list.reduce((sum, ad) => sum + ad.metrics.spend, 0);
  const paidSpend = paid.reduce((sum, ad) => sum + ad.metrics.spend, 0);
  const summaryResults = paid.reduce((sum, ad) => sum + ad.metrics.results, 0);

  return {
    configured: true,
    period,
    range,
    syncedAtLabel: formatSyncedAt(syncState?.last_intraday_sync_at || syncState?.last_daily_consolidation_at),
    benchmarks,
    summary: {
      spend: Math.round(summarySpend * 100) / 100,
      results: summaryResults,
      costPerResult: summaryResults > 0 ? Math.round((paidSpend / summaryResults) * 100) / 100 : null,
      activeCount: list.filter((ad) => ad.status === "active").length
    },
    ads: list
  };
}
