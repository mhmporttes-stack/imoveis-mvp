import { firstNameOf } from "../alexa-v2/text.mjs";

// Núcleo PURO (testável) da Meta da Equipe para a voz. Nenhuma regra de meta é
// recalculada aqui: o resultado vem de getOwnerTeamDailyOverview (a mesma
// função da tela "Meta Diária > visão do dono"). Este módulo só REDUZ esse
// resultado ao que a voz precisa e DERIVA as respostas (quem bateu, quem
// falta, ranking de prospecção...), usando exatamente os campos dela:
//   bateu a meta = meta.percent >= 100 (com meta.total > 0)
//   prospecção feita = funnel.contatos (= realizadas da Meta Diária)

export function slimTeamGoal(overview, capturedAt = new Date().toISOString()) {
  const brokers = (overview?.brokers || []).map((broker) => ({
    id: broker.brokerId,
    name: firstNameOf(broker.name) || "Corretor",
    percent: Number(broker.meta?.percent) || 0,
    done: Number(broker.meta?.done) || 0,
    total: Number(broker.meta?.total) || 0,
    prospectingDone: Number(broker.meta?.prospecting?.done ?? broker.funnel?.contatos) || 0,
    prospectingTarget: Number(broker.meta?.prospecting?.target) || 0,
    pending: broker.meta?.pending
      ? {
          done: Number(broker.meta.pending.done) || 0,
          total: Number(broker.meta.pending.total) || 0,
          remaining: Number(broker.meta.pending.remaining ?? broker.meta.pending.total - broker.meta.pending.done) || 0
        }
      : null,
    contatos: Number(broker.funnel?.contatos) || 0,
    atendimentos: Number(broker.funnel?.atendimentos) || 0,
    simulacoes: Number(broker.funnel?.simulacoes) || 0
  }));
  const summary = overview?.summary || {};
  return {
    range: { startDate: overview?.range?.startDate, endDate: overview?.range?.endDate },
    summary: {
      metaPercent: Number(summary.metaPercent) || 0,
      atividadesDone: Number(summary.atividadesDone) || 0,
      atividadesTotal: Number(summary.atividadesTotal) || 0,
      contatos: Number(summary.contatos) || 0,
      atendimentos: Number(summary.atendimentos) || 0,
      simulacoes: Number(summary.simulacoes) || 0,
      taxaAtendimento: summary.taxaAtendimento ?? null,
      taxaSimulacao: summary.taxaSimulacao ?? null
    },
    brokers,
    capturedAt
  };
}

const hasGoal = (broker) => broker.total > 0;
const hit = (broker) => hasGoal(broker) && broker.percent >= 100;

function byPercentDesc(a, b) {
  return b.percent - a.percent || b.done - a.done || a.name.localeCompare(b.name, "pt-BR");
}

// Respostas de Meta (hoje/ontem), no formato que o catálogo da voz espera.
export function deriveMeta(payload, topicId) {
  const brokers = payload.brokers || [];
  if (topicId === "meta_equipe") return { percent: payload.summary.metaPercent };
  if (topicId === "meta_bateram") {
    const hitters = brokers.filter(hit).sort(byPercentDesc);
    return { count: hitters.length, items: hitters.map((b) => ({ name: b.name, percent: b.percent })) };
  }
  if (topicId === "meta_faltam") {
    const missing = brokers.filter((b) => hasGoal(b) && !hit(b)).sort(byPercentDesc);
    return { count: missing.length, items: missing.map((b) => ({ name: b.name, percent: b.percent })) };
  }
  if (topicId === "meta_cada") {
    const missing = brokers.filter((b) => hasGoal(b) && !hit(b)).sort(byPercentDesc);
    return { items: missing.map((b) => ({ name: b.name, remaining: Math.max(0, b.total - b.done) })) };
  }
  if (topicId === "meta_lider") {
    const leader = brokers.filter(hasGoal).sort(byPercentDesc)[0];
    return leader ? { name: leader.name, percent: leader.percent } : { name: "", percent: 0 };
  }
  return null;
}

function byCountDesc(a, b) {
  return b.count - a.count || a.name.localeCompare(b.name, "pt-BR");
}

// Respostas de Prospecção (qualquer período já calculado), mesmo formato.
export function deriveProspeccao(payload, topicId, broker = null) {
  const brokers = payload.brokers || [];
  const ranked = brokers.map((b) => ({ name: b.name, count: b.prospectingDone })).sort(byCountDesc);
  if (topicId === "prospeccao_equipe") return { count: ranked.reduce((sum, item) => sum + item.count, 0), items: ranked };
  if (topicId === "prospeccao_ranking") return { items: ranked };
  if (topicId === "prospeccao_vs_meta") {
    const done = brokers.reduce((sum, b) => sum + b.prospectingDone, 0);
    const target = brokers.reduce((sum, b) => sum + b.prospectingTarget, 0);
    return { done, target, percent: target > 0 ? Math.round((done / target) * 100) : 0 };
  }
  if (topicId === "prospeccao_corretor") {
    const found = brokers.find((b) => (broker?.id && b.id === broker.id) || (broker?.name && b.name.toLowerCase() === String(broker.name).toLowerCase()));
    return found ? { name: found.name, count: found.prospectingDone } : { name: broker?.name || "", count: 0 };
  }
  if (topicId === "sem_prospeccao") {
    const none = brokers.filter((b) => b.prospectingDone === 0).map((b) => ({ name: b.name }));
    return { count: none.length, items: none };
  }
  return null;
}

// Pendências de hoje (regra da Meta Diária). payload = { brokers:[{id,name,remaining,clients:[{name,days}],moreClients}] }
export function derivePendencias(payload, topicId, sinceDays = 7) {
  const brokers = payload.brokers || [];
  const total = brokers.reduce((sum, b) => sum + b.remaining, 0);
  if (topicId === "pendencias") {
    const clients = brokers.flatMap((b) => b.clients).sort((a, b) => b.days - a.days);
    return { count: total, items: clients.map((c) => ({ name: c.name })) };
  }
  if (topicId === "pendencias_ranking") {
    return { items: brokers.map((b) => ({ name: b.name, count: b.remaining })).sort(byCountDesc) };
  }
  if (topicId === "sem_contato") {
    const clients = brokers.flatMap((b) => b.clients).filter((c) => c.days >= sinceDays).sort((a, b) => b.days - a.days);
    return { count: clients.length, days: sinceDays, items: clients.map((c) => ({ name: c.name })) };
  }
  return null;
}

// Chave do cache por período falado.
export const TEAM_GOAL_CACHE_KEYS = {
  hoje: "meta:hoje",
  ontem: "meta:ontem",
  esta_semana: "meta:esta_semana",
  semana_passada: "meta:semana_passada",
  este_mes: "meta:este_mes",
  mes_passado: "meta:mes_passado"
};

// Validade (minutos) de cada período: o que muda a toda hora vale pouco; o
// que já fechou vale o dia todo.
export const TEAM_GOAL_VALID_MINUTES = {
  hoje: 10,
  ontem: 1500,
  esta_semana: 60,
  semana_passada: 1500,
  este_mes: 60,
  mes_passado: 1500
};
