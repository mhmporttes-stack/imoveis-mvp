import { firstNameOf } from "../alexa-v2/text.mjs";

// Núcleo PURO (testável) dos Resultados/Ranking para a voz. A conta vem de
// getPerformanceOverview (a mesma função do Desempenho e do Ranking): aqui só
// se REDUZ o resultado e se DERIVA a resposta. Venda = os 8 status de venda
// (metrics.sale / team[].sale), exatamente como no Desempenho/Celebrações.

export function slimOverview(overview, capturedAt = new Date().toISOString()) {
  const metrics = overview?.metrics || {};
  return {
    range: { startDate: overview?.range?.startDate, endDate: overview?.range?.endDate },
    metrics: {
      newClients: Number(metrics.newClients) || 0,
      prospecting: Number(metrics.prospecting) || 0,
      service: Number(metrics.service) || 0,
      simulation: Number(metrics.simulation) || 0,
      approvalPending: Number(metrics.approvalPending) || 0,
      approval: Number(metrics.approval) || 0,
      sale: Number(metrics.sale) || 0
    },
    team: (overview?.team || []).map((row) => ({
      id: row.profile?.id || "",
      name: firstNameOf(row.profile?.name) || "Corretor",
      gender: row.profile?.gender || "",
      role: row.profile?.role || "",
      newClients: Number(row.newClients) || 0,
      prospecting: Number(row.prospecting) || 0,
      approval: Number(row.approval) || 0,
      sale: Number(row.sale) || 0,
      points: Number(row.points) || 0
    })),
    ranking: (overview?.ranking || []).map((row) => ({
      id: row.profile?.id || "",
      name: firstNameOf(row.profile?.name) || "Corretor",
      gender: row.profile?.gender || "",
      points: Number(row.points) || 0
    })),
    capturedAt
  };
}

function byCountDesc(a, b) {
  return b.count - a.count || a.name.localeCompare(b.name, "pt-BR");
}

export function deriveResultados(payload, topicId) {
  if (topicId === "vendas") {
    const items = payload.team.map((row) => ({ name: row.name, count: row.sale })).sort(byCountDesc);
    return { count: payload.metrics.sale, items };
  }
  if (topicId === "aprovacoes") {
    const items = payload.team.map((row) => ({ name: row.name, count: row.approval })).sort(byCountDesc);
    return { count: payload.metrics.approval, items };
  }
  if (topicId === "desempenho") {
    const { newClients, prospecting, approval, sale } = payload.metrics;
    return { newClients, prospecting, approval, sale };
  }
  return null;
}

// "Melhor do dia" = primeiro do ranking, só se tiver pontos (mesma regra de
// dailyRankingLeader); o ranking já exclui quem não compete (gerentes) e o dono.
export function deriveRanking(payload, topicId, broker = null) {
  if (topicId === "melhor_dia") {
    const top = payload.ranking[0];
    return top && top.points > 0 ? { name: top.name, points: top.points, gender: top.gender } : { name: "", points: 0 };
  }
  if (topicId === "ranking") return { items: payload.ranking.map((row) => ({ name: row.name, points: row.points })) };
  if (topicId === "pontos") {
    const found = payload.team.find((row) => (broker?.id && row.id === broker.id) || (broker?.name && row.name.toLowerCase() === String(broker.name).toLowerCase()));
    return found ? { name: found.name, points: found.points } : { name: broker?.name || "", points: 0 };
  }
  return null;
}

// Conversão do dia: as mesmas taxas do resumo da Meta da Equipe (funil de
// atendimento e simulação), vindas do cache da Meta.
export function deriveConversao(metaPayload) {
  return { taxaAtendimento: metaPayload?.summary?.taxaAtendimento ?? null, taxaSimulacao: metaPayload?.summary?.taxaSimulacao ?? null };
}

export const OVERVIEW_CACHE_KEYS = {
  hoje: "overview:hoje",
  ontem: "overview:ontem",
  esta_semana: "overview:esta_semana",
  semana_passada: "overview:semana_passada",
  este_mes: "overview:este_mes",
  mes_passado: "overview:mes_passado"
};

export const OVERVIEW_VALID_MINUTES = {
  hoje: 10,
  ontem: 1500,
  esta_semana: 60,
  semana_passada: 1500,
  este_mes: 60,
  mes_passado: 1500
};
