import "server-only";
import { CLIENT_FUNNEL_SALE_STATUS_VALUES, CLIENT_STATUS, getClientFunnelStage } from "../../client-status";
import { getSupabaseAdminClient } from "../../supabase";
import { fetchStatusCounts } from "../../crm-metrics/funnel-stock";
import { readSnapshots } from "../../crm-metrics/snapshots";
import { readBrokerStock } from "../../crm-metrics/broker-stock";
import { sumStatuses } from "../../crm-metrics/broker-stock-core.mjs";
import { zonedPlainDateToUtcIso } from "../../daily-report";
import { firstNameOf } from "../text.mjs";

// Funil e etapas: a fotografia ATUAL (clientes em cada etapa agora) vem de
// UMA contagem agrupada por status; "ontem" vem do retrato diário. Os grupos
// são os da tela Clientes (CLIENT_STATUS_FILTER_GROUPS), as etapas falam os
// status exatos de cada rótulo da tela.
const ETAPA_STATUSES = {
  simulacao: [CLIENT_STATUS.PENDING],
  documentacao: [CLIENT_STATUS.DOCUMENTATION, CLIENT_STATUS.DOCUMENTS_PENDING],
  aprovacao: [CLIENT_STATUS.APPROVAL_PENDING],
  aprovados: [CLIENT_STATUS.APPROVED],
  reuniao: [CLIENT_STATUS.MEETING_PENDING, CLIENT_STATUS.MEETING_DONE],
  atendimento: [CLIENT_STATUS.IN_SERVICE],
  venda: [...CLIENT_FUNNEL_SALE_STATUS_VALUES],
  prospeccao: [CLIENT_STATUS.AWAITING_RETURN]
};

const GROUP_LABELS = [
  ["prospecting", "prospecção"],
  ["service", "atendimento"],
  ["simulation", "simulação"],
  ["documentation", "documentação"],
  ["approval", "aprovação"],
  ["approved", "aprovados"],
  ["meeting", "reunião"],
  ["sale", "venda"]
];

const sumOf = (byStatus, statuses) => statuses.reduce((sum, status) => sum + (byStatus[status] || 0), 0);

export async function funilProvider(q) {
  let byGroup;
  if (q.periodo === "ontem") {
    const rows = await readSnapshots({ date: q.range.startDate, metric: "clientes_por_grupo", dimensionType: "stage" });
    if (!rows.length) return { unavailable: "historico" };
    byGroup = Object.fromEntries(rows.map((row) => [row.dimension_key, Number(row.value_num) || 0]));
  } else {
    byGroup = (await fetchStatusCounts()).byGroup;
  }
  return { stages: GROUP_LABELS.map(([key, label]) => ({ label, count: byGroup[key] || 0 })) };
}

export async function etapaProvider(q) {
  const statuses = ETAPA_STATUSES[q.etapa];
  if (!statuses) return null;

  // Estoque de UM corretor (clientes dele hoje em cada etapa): cache agrupado por responsável.
  if (q.corretorId) {
    if (q.periodo === "ontem") return { unavailable: "historico" };
    const stock = await readBrokerStock();
    if (!stock) return null;
    const own = sumStatuses(stock.payload.byBroker[q.corretorId], statuses);
    const base = stock.staleMinutes ? { staleMinutes: stock.staleMinutes } : {};
    if (q.kind !== "list") return { count: own, ...base };
    const client = getSupabaseAdminClient();
    const { data, error } = await client
      .from("simulation_registrations")
      .select("full_name")
      .eq("responsible_user_id", q.corretorId)
      .in("status", statuses)
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) throw error;
    return { count: own, items: (data || []).map((row) => ({ name: firstNameOf(row.full_name) })).filter((item) => item.name), ...base };
  }

  let count;
  if (q.periodo === "ontem") {
    if (q.kind === "list") return { unavailable: "historico" };
    const rows = await readSnapshots({ date: q.range.startDate, metric: "clientes_por_status", dimensionType: "status" });
    if (!rows.length) return { unavailable: "historico" };
    count = sumOf(Object.fromEntries(rows.map((row) => [row.dimension_key, Number(row.value_num) || 0])), statuses);
  } else {
    count = sumOf((await fetchStatusCounts()).byStatus, statuses);
  }
  if (q.kind !== "list") return { count };

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .select("full_name")
    .in("status", statuses)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  return { count, items: (data || []).map((row) => ({ name: firstNameOf(row.full_name) })).filter((item) => item.name) };
}

// "Quantos clientes avançaram hoje?": clientes DISTINTOS que, no dia, tiveram
// uma mudança de status para uma etapa do funil (mesma classificação
// getClientFunnelStage usada nas telas), lida de client_status_history.
export async function movimentoProvider(q) {
  const supabase = getSupabaseAdminClient();
  const startIso = zonedPlainDateToUtcIso(q.range.startDate);
  const endIso = zonedPlainDateToUtcIso(nextDay(q.range.endDate));

  if (q.topic === "clientes_novos") {
    const { count, error } = await supabase.from("simulation_registrations").select("id", { count: "exact", head: true }).gte("created_at", startIso).lt("created_at", endIso);
    if (error) throw error;
    if (q.kind !== "list") return { count: count || 0 };
    const { data, error: listError } = await supabase
      .from("simulation_registrations")
      .select("full_name")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: true })
      .limit(50);
    if (listError) throw listError;
    return { count: count || 0, items: (data || []).map((row) => ({ name: firstNameOf(row.full_name) })).filter((item) => item.name) };
  }

  const clients = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("client_status_history")
      .select("client_id, new_status")
      .gte("changed_at", startIso)
      .lt("changed_at", endIso)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    for (const row of data || []) if (getClientFunnelStage(row.new_status)) clients.add(row.client_id);
    if (!data || data.length < 1000) break;
  }
  return { count: clients.size };
}

function nextDay(plainDate) {
  const date = new Date(`${plainDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
