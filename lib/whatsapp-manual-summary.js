import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { getOwnerTeamDailyOverview } from "./daily-goal";
import { getPerformanceOverview } from "./performance-overview";
import { listAdminProfiles } from "./admin-profiles";

// Alternativa ao envio automático (que depende de modelo aprovado pela
// Meta): aqui só se monta o TEXTO — quem manda de verdade é o dono/gestor,
// abrindo o próprio WhatsApp num link wa.me com a mensagem já preenchida.
// Não passa pela API da Meta, então não tem restrição de modelo nenhuma:
// o texto é livre e configurável (ver MANUAL_SUMMARY_VARIABLES abaixo).
//
// Dados 100% reaproveitados, nada calculado de novo:
// - ranking/pontos/prospecções/novos clientes/atendimentos/simulações/
//   documentações/aprovações/vendas/atividades: getPerformanceOverview
//   (lib/performance-overview.js) — MESMA fonte da tela Desempenho/Ranking.
//   Posição no ranking = índice em overview.ranking (já ordenado por
//   pontos), igual ao "index+1" usado em PerformanceOverviewDashboard.jsx.
// - meta diária (%/realizado/total): getOwnerTeamDailyOverview
//   (lib/daily-goal.js) — MESMA fonte da tela Meta Diária, já testada para
//   hoje/últimos 7/últimos 30 dias nesta sessão.
export const MANUAL_SUMMARY_PERIODS = [
  { value: "today", label: "Resumo diário" },
  { value: "last7", label: "Resumo semanal" },
  { value: "last30", label: "Resumo mensal" }
];
const PERIOD_VALUES = MANUAL_SUMMARY_PERIODS.map((option) => option.value);

export const MANUAL_SUMMARY_VARIABLES = [
  { key: "corretor", label: "Nome do corretor" },
  { key: "periodo", label: "Período (ex.: Hoje, Últimos 7 dias)" },
  { key: "posicao_ranking", label: "Posição no ranking (ex.: 2º)" },
  { key: "pontos", label: "Pontos no período" },
  { key: "meta_percentual", label: "% da meta concluída" },
  { key: "meta_realizada", label: "Quantidade realizada da meta" },
  { key: "meta_total", label: "Quantidade total da meta" },
  { key: "prospeccoes", label: "Prospecções realizadas" },
  { key: "novos_clientes", label: "Novos clientes" },
  { key: "atendimentos", label: "Atendimentos" },
  { key: "simulacoes", label: "Simulações" },
  { key: "documentacoes", label: "Documentações recebidas" },
  { key: "aprovacoes", label: "Aprovações" },
  { key: "vendas", label: "Vendas" },
  { key: "atividades_realizadas", label: "Atividades concluídas" },
  { key: "atividades_pendentes", label: "Atividades pendentes" }
];
const VALID_VARIABLE_KEYS = new Set(MANUAL_SUMMARY_VARIABLES.map((variable) => variable.key));

const TEMPLATES_SETTING_ID = "whatsapp_manual_templates";
const DEFAULT_TEMPLATES = {
  today: "{corretor}, fechamos o dia com {meta_percentual} da sua meta concluída. Foram {prospeccoes} prospecções, {novos_clientes} novos clientes, {atendimentos} atendimentos e {simulacoes} simulações. Você está em {posicao_ranking} lugar no ranking com {pontos} pontos. 🚀",
  last7: "{corretor}, no resumo desta semana você concluiu {meta_percentual} da meta. Foram {prospeccoes} prospecções, {novos_clientes} novos clientes, {atendimentos} atendimentos, {simulacoes} simulações, {documentacoes} documentações e {aprovacoes} aprovações. Posição no ranking: {posicao_ranking} lugar, com {pontos} pontos. 💪",
  last30: "{corretor}, fechando {periodo}: {meta_percentual} da meta concluída, {vendas} vendas realizadas, {atendimentos} atendimentos e {simulacoes} simulações. Você terminou em {posicao_ranking} lugar no ranking do período, com {pontos} pontos. Vamos fechar ainda mais forte! 🏆"
};

function normalizePeriod(period) {
  return PERIOD_VALUES.includes(period) ? period : "today";
}

export async function getManualSummaryTemplates() {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.from("crm_settings").select("setting_value").eq("id", TEMPLATES_SETTING_ID).maybeSingle();
  if (error) throw error;
  return { ...DEFAULT_TEMPLATES, ...(data?.setting_value || {}) };
}

// Nunca aceita salvar um modelo com variável desconhecida (ex.: erro de
// digitação em {meta_percentua}) — evita o modelo "quebrado" citado como
// requisito: melhor recusar o salvamento do que gerar {token_invalido}
// literal na mensagem depois.
export function validateManualTemplate(template) {
  const text = String(template || "");
  const tokens = [...text.matchAll(/\{([a-z_]+)\}/g)].map((match) => match[1]);
  const invalidTokens = [...new Set(tokens.filter((token) => !VALID_VARIABLE_KEYS.has(token)))];
  return { valid: invalidTokens.length === 0 && text.trim().length > 0, invalidTokens };
}

export async function saveManualSummaryTemplate(periodKey, template) {
  if (!PERIOD_VALUES.includes(periodKey)) throw new Error("Período inválido.");
  const { valid, invalidTokens } = validateManualTemplate(template);
  if (!valid) {
    throw new Error(
      invalidTokens.length
        ? `Variável desconhecida no modelo: ${invalidTokens.map((token) => `{${token}}`).join(", ")}`
        : "A mensagem não pode ficar vazia."
    );
  }

  const current = await getManualSummaryTemplates();
  const next = { ...current, [periodKey]: template };
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("crm_settings").upsert({
    id: TEMPLATES_SETTING_ID,
    setting_value: next,
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
  return next;
}

export function renderManualTemplate(template, variables) {
  return String(template || "").replace(/\{([a-z_]+)\}/g, (match, key) => (key in variables ? variables[key] : match));
}

// Uma única chamada a getPerformanceOverview + getOwnerTeamDailyOverview já
// traz TODA a equipe de uma vez — "gerar para todos" não custa mais caro
// que gerar para 1 corretor, só usa a mesma resposta pra montar N mensagens.
async function computeManualSummaryTeamData(period) {
  const periodKey = normalizePeriod(period);
  const ownerAuth = { ok: true, user: { email: "mhmporttes@gmail.com" }, profile: { id: "", role: "admin" } };

  const [overview, dailyOverview, profiles] = await Promise.all([
    getPerformanceOverview({ period: periodKey }, ownerAuth),
    getOwnerTeamDailyOverview({ period: periodKey }, ownerAuth),
    listAdminProfiles()
  ]);

  const metaByBroker = new Map(dailyOverview.brokers.map((broker) => [broker.brokerId, broker.meta]));
  const phoneById = new Map(profiles.map((profile) => [profile.id, profile.phone || ""]));

  const rows = overview.ranking.map((row, index) => {
    const brokerId = row.profile.id;
    const meta = metaByBroker.get(brokerId) || { done: 0, total: 0, percent: 0 };
    const hasMeta = meta.total > 0;

    const variables = {
      corretor: row.profile.name || "Corretor",
      periodo: overview.range.label,
      posicao_ranking: `${index + 1}º`,
      pontos: String(row.points || 0),
      meta_percentual: hasMeta ? `${meta.percent}%` : "meta não configurada",
      meta_realizada: hasMeta ? String(meta.done) : "—",
      meta_total: hasMeta ? String(meta.total) : "—",
      prospeccoes: String(row.prospecting || 0),
      novos_clientes: String(row.newClients || 0),
      atendimentos: String(row.service || 0),
      simulacoes: String(row.simulation || 0),
      documentacoes: String(row.documentation || 0),
      aprovacoes: String(row.approval || 0),
      vendas: String(row.sale || 0),
      atividades_realizadas: String(row.completedActivities || 0),
      atividades_pendentes: String(row.awaitingAction || 0)
    };

    return { brokerId, name: row.profile.name || "Corretor", phone: phoneById.get(brokerId) || "", variables };
  });

  return { periodLabel: overview.range.label, rows };
}

export async function buildManualWhatsappSummary({ brokerId, period }) {
  const periodKey = normalizePeriod(period);
  const [{ periodLabel, rows }, templates] = await Promise.all([
    computeManualSummaryTeamData(periodKey),
    getManualSummaryTemplates()
  ]);
  const row = rows.find((item) => item.brokerId === brokerId);
  if (!row) throw new Error("Corretor não encontrado.");

  return {
    message: renderManualTemplate(templates[periodKey], row.variables),
    brokerName: row.name,
    phone: row.phone,
    periodLabel
  };
}

export async function buildManualWhatsappSummaryForAll({ period }) {
  const periodKey = normalizePeriod(period);
  const [{ periodLabel, rows }, templates] = await Promise.all([
    computeManualSummaryTeamData(periodKey),
    getManualSummaryTemplates()
  ]);

  return {
    periodLabel,
    items: rows.map((row) => ({
      brokerId: row.brokerId,
      brokerName: row.name,
      phone: row.phone,
      message: renderManualTemplate(templates[periodKey], row.variables)
    }))
  };
}

// Histórico: só registra "aberto" (o clique real em Abrir WhatsApp) e,
// separadamente, "marcado como enviado" (ação manual explícita depois) —
// nunca "enviado" de verdade, já que o CRM não tem como saber se a
// mensagem foi de fato enviada dentro do WhatsApp de terceiros.
export async function logManualWhatsappAction({ brokerId, performedBy, summaryType, action }) {
  if (!["opened", "marked_sent"].includes(action)) throw new Error("Ação de histórico inválida.");
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("whatsapp_manual_log").insert({
    broker_id: brokerId,
    performed_by: performedBy || null,
    summary_type: normalizePeriod(summaryType),
    action
  });
  if (error) throw error;
}

export async function listManualWhatsappLog({ limit = 20 } = {}) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("whatsapp_manual_log")
    .select("id, broker_id, performed_by, summary_type, action, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 20, 1), 100));
  if (error) throw error;

  const profiles = (data || []).length ? await listAdminProfiles() : [];
  const nameById = new Map(profiles.map((profile) => [profile.id, profile.name]));

  return (data || []).map((row) => ({
    id: row.id,
    brokerName: nameById.get(row.broker_id) || "Corretor",
    performedByName: nameById.get(row.performed_by) || "",
    summaryType: row.summary_type,
    action: row.action,
    createdAt: row.created_at
  }));
}
