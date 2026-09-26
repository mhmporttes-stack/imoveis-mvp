import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertGeneralAdmin, assertGeneralAdminOrManager } from "./admin-access";

// Gastos e desempenho do Disparo. O que a Meta cobra vem do próprio webhook (mensagem cobrada
// e categoria, gravadas em whatsapp_broadcast_messages); o VALOR por mensagem é uma tabela editável
// (crm_settings 'whatsapp_pricing') — a Meta não informa o valor em reais por evento.
// Custo = mensagens ENTREGUES e cobradas × preço da categoria. Estimativa: confira com a fatura da Meta.

const PRICING_SETTING_ID = "whatsapp_pricing";
const DEFAULT_RATES = { marketing: 0.35, utility: 0.05, authentication: 0.17, service: 0 };
const CATEGORY_KEYS = Object.keys(DEFAULT_RATES);
const CATEGORY_LABELS = { marketing: "Marketing", utility: "Utilidade", authentication: "Autenticação", service: "Atendimento" };

function db() {
  return getSupabaseAdminClient();
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function round4(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function cleanRate(value, fallback) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) && number >= 0 && number <= 100 ? round4(number) : fallback;
}

export async function getWhatsappPricing() {
  const { data } = await db().from("crm_settings").select("setting_value, updated_at").eq("id", PRICING_SETTING_ID).maybeSingle();
  const stored = data?.setting_value?.rates || {};
  const rates = {};
  for (const key of CATEGORY_KEYS) rates[key] = cleanRate(stored[key], DEFAULT_RATES[key]);
  return { currency: "BRL", estimated: data?.setting_value?.estimated !== false, rates, updatedAt: data?.updated_at || null };
}

export async function saveWhatsappPricing(input, auth) {
  assertGeneralAdmin(auth);
  const current = await getWhatsappPricing();
  const rates = {};
  for (const key of CATEGORY_KEYS) rates[key] = cleanRate(input?.[key], current.rates[key]);
  const { error } = await db().from("crm_settings").upsert({
    id: PRICING_SETTING_ID,
    setting_value: { currency: "BRL", estimated: false, rates },
    updated_by: auth?.profile?.id || null,
    updated_at: new Date().toISOString()
  }, { onConflict: "id" });
  if (error) throw error;
  return getWhatsappPricing();
}

function categoryOf(value) {
  const key = String(value || "").toLowerCase();
  return CATEGORY_KEYS.includes(key) ? key : "marketing";
}

function ratio(part, total) {
  return total > 0 ? round4(part / total) : 0;
}

function buildItem(broadcast, report, rates) {
  const billable = {
    marketing: report?.billable_marketing || 0,
    utility: report?.billable_utility || 0,
    authentication: report?.billable_authentication || 0,
    service: report?.billable_service || 0
  };
  const billableTotal = CATEGORY_KEYS.reduce((sum, key) => sum + billable[key], 0);
  const totalCost = round2(CATEGORY_KEYS.reduce((sum, key) => sum + billable[key] * rates[key], 0));
  const category = categoryOf(broadcast.template_category);
  const sent = broadcast.total_sent || 0;
  const delivered = broadcast.total_delivered || 0;
  const read = broadcast.total_read || 0;
  const replied = report?.replied || 0;
  const registrations = report?.registrations || 0;

  return {
    id: broadcast.id,
    campaignName: broadcast.campaign_name,
    templateName: broadcast.template_name,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    isMarketing: category === "marketing",
    status: broadcast.status,
    createdAt: broadcast.created_at,
    startedAt: broadcast.started_at,
    selected: broadcast.total_selected || 0,
    sent,
    delivered,
    read,
    failed: broadcast.total_failed || 0,
    billable: billableTotal,
    unitRate: rates[category],
    totalCost,
    costPerSent: sent > 0 ? round4(totalCost / sent) : 0,
    replied,
    linkViews: report?.link_views || 0,
    registrations,
    deliveredRate: ratio(delivered, sent),
    readRate: ratio(read, delivered),
    replyRate: ratio(replied, sent),
    costPerReply: replied > 0 ? round2(totalCost / replied) : null,
    costPerRegistration: registrations > 0 ? round2(totalCost / registrations) : null
  };
}

function sumItems(items, templateName = null) {
  const total = {
    campaigns: items.length, sent: 0, delivered: 0, read: 0, failed: 0, billable: 0, totalCost: 0, replied: 0, linkViews: 0, registrations: 0
  };
  for (const item of items) {
    total.sent += item.sent;
    total.delivered += item.delivered;
    total.read += item.read;
    total.failed += item.failed;
    total.billable += item.billable;
    total.totalCost += item.totalCost;
    total.replied += item.replied;
    total.linkViews += item.linkViews;
    total.registrations += item.registrations;
  }
  total.totalCost = round2(total.totalCost);
  return {
    ...total,
    templateName,
    costPerSent: total.sent > 0 ? round4(total.totalCost / total.sent) : 0,
    deliveredRate: ratio(total.delivered, total.sent),
    readRate: ratio(total.read, total.delivered),
    replyRate: ratio(total.replied, total.sent),
    costPerReply: total.replied > 0 ? round2(total.totalCost / total.replied) : null,
    costPerRegistration: total.registrations > 0 ? round2(total.totalCost / total.registrations) : null
  };
}

// days: 7 | 30 | 90 | 0 (tudo)
export async function getBroadcastFinanceReport({ days = 0 } = {}, auth) {
  assertGeneralAdminOrManager(auth);
  const since = Number(days) > 0 ? new Date(Date.now() - Number(days) * 86400000).toISOString() : "";

  let query = db().from("whatsapp_broadcasts").select("*").neq("status", "draft").order("created_at", { ascending: false }).limit(300);
  if (since) query = query.gte("created_at", since);
  const { data: broadcasts, error } = await query;
  if (error) throw error;

  const ids = (broadcasts || []).map((row) => row.id);
  const [pricing, reportResult] = await Promise.all([
    getWhatsappPricing(),
    ids.length ? db().rpc("whatsapp_broadcast_report", { p_ids: ids }) : Promise.resolve({ data: [], error: null })
  ]);
  if (reportResult.error) throw reportResult.error;
  const reportById = new Map((reportResult.data || []).map((row) => [row.broadcast_id, row]));

  const items = (broadcasts || []).map((row) => buildItem(row, reportById.get(row.id), pricing.rates));

  // "Desempenho de cada mensagem" = agregado por modelo (template) usado nos disparos.
  const byTemplate = new Map();
  for (const item of items) {
    if (!byTemplate.has(item.templateName)) byTemplate.set(item.templateName, []);
    byTemplate.get(item.templateName).push(item);
  }
  const templates = [...byTemplate.entries()]
    .map(([name, list]) => ({ ...sumItems(list, name), category: list[0].category, categoryLabel: list[0].categoryLabel, isMarketing: list[0].isMarketing }))
    .sort((a, b) => b.sent - a.sent);

  return { pricing, summary: sumItems(items), items, templates };
}
