import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { getOwnerTeamDailyOverview } from "./daily-goal";
import { getPerformanceOverview } from "./performance-overview";
import { listAdminProfiles } from "./admin-profiles";

// Alternativa ao envio automático (que depende de modelo aprovado pela
// Meta): aqui só se monta o TEXTO — quem manda de verdade é o dono/gestor,
// abrindo o próprio WhatsApp num link wa.me com a mensagem já preenchida.
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

function normalizePeriod(period) {
  return PERIOD_VALUES.includes(period) ? period : "today";
}

// Ordem fixa de exibição dos "destaques" — só entra na mensagem quem tem
// valor > 0 (regra obrigatória: indicador zerado nunca aparece, e o bloco
// inteiro some se todos estiverem zerados). Singular/plural próprio pra não
// ler "1 atendimentos".
const INDICATOR_LABELS = [
  { key: "prospeccoes", singular: "prospecção", plural: "prospecções" },
  { key: "novos_clientes", singular: "novo cliente", plural: "novos clientes" },
  { key: "atendimentos", singular: "atendimento", plural: "atendimentos" },
  { key: "simulacoes", singular: "simulação", plural: "simulações" },
  { key: "documentacoes", singular: "documentação recebida", plural: "documentações recebidas" },
  { key: "aprovacoes", singular: "aprovação", plural: "aprovações" },
  { key: "vendas", singular: "venda", plural: "vendas" },
  { key: "atividades_realizadas", singular: "atividade concluída", plural: "atividades concluídas" },
  { key: "atividades_pendentes", singular: "atividade pendente", plural: "atividades pendentes" }
];

// Tom sempre positivo — nunca frase negativa pra quem está abaixo de 100%
// (reconhecimento do esforço + incentivo), elogio pra quem bate exatamente
// 100%, elogio mais forte pra quem supera. Texto próprio por período (não é
// o mesmo texto disfarçado): diário é direto, semanal fala de evolução/
// consistência da semana, mensal fala de fechamento de ciclo.
const PERIOD_TEXT = {
  today: {
    title: "Resumo do dia",
    highlightsTitle: "Seus destaques de hoje",
    rankingVerb: "Você encerrou o dia",
    opening: {
      above: "seu desempenho de hoje merece destaque! 🔥",
      exact: "fechamos o dia com um ótimo resultado! 👏",
      below: "hoje foi mais um passo importante na construção do seu resultado. 👏"
    },
    meta: {
      above: (percent) => `Você alcançou *${percent}% da sua meta*. Excelente resultado — você foi muito além do objetivo do dia.`,
      exact: () => "Você concluiu *100% da sua meta*, mostrando consistência e foco no trabalho.",
      below: () => "Você segue avançando e seu desempenho mostra que existe potencial para ir ainda mais longe."
    },
    closing: {
      above: "Parabéns por esse resultado. Esse ritmo mostra muita dedicação e potencial para crescer ainda mais. 🚀",
      exact: "Parabéns pelo desempenho. Continue assim, porque seu trabalho mostra força e constância. 🚀",
      below: "Continue firme. A constância de hoje é o que constrói os grandes resultados de amanhã. 💪"
    }
  },
  last7: {
    title: "Resumo da semana",
    highlightsTitle: "Destaques da semana",
    rankingVerb: "Você encerrou a semana",
    opening: {
      above: "sua semana teve um resultado muito forte! 🔥",
      exact: "você fechou a semana com consistência e foco. 👏",
      below: "sua semana contribuiu para a construção de um resultado sólido. 👏"
    },
    meta: {
      above: (percent) => `Você fechou a semana com *${percent}% da meta*. Resultado de destaque — sua evolução ao longo da semana mostra muita consistência.`,
      exact: () => "Você fechou a semana com *100% da meta concluída*, um resultado que mostra constância no seu trabalho.",
      below: () => "Sua semana faz parte da construção de um resultado maior — cada dia de trabalho soma para o seu crescimento."
    },
    closing: {
      above: "Parabéns pela semana de resultados fortes — esse ritmo mostra muita dedicação. 🚀",
      exact: "Parabéns pela semana consistente. Seguir nesse ritmo constrói resultados cada vez maiores. ✅",
      below: "Continue firme. Cada semana é um novo degrau na construção do seu resultado. 💪"
    }
  },
  last30: {
    title: "Resumo do mês",
    highlightsTitle: "Destaques do mês",
    rankingVerb: "Você encerrou o mês",
    opening: {
      above: "seu mês foi de resultados extraordinários! 🔥",
      exact: "você encerrou o mês com uma entrega muito consistente. 👏",
      below: "esse mês fez parte da sua evolução constante. 👏"
    },
    meta: {
      above: (percent) => `Você fechou o mês com *${percent}% da meta*. Um resultado de destaque que mostra a força do seu trabalho ao longo do ciclo.`,
      exact: () => "Você fechou o mês com *100% da meta concluída* — um ciclo de trabalho consistente do início ao fim.",
      below: () => "Esse mês faz parte da sua construção de resultados — cada ciclo é uma nova oportunidade de evoluir."
    },
    closing: {
      above: "Parabéns por fechar o mês com esse nível de entrega — resultado de quem trabalha com consistência. 🚀",
      exact: "Parabéns por fechar o mês com essa consistência. Esse é o tipo de trabalho que constrói resultados sólidos. ✅",
      below: "Encerramos mais um ciclo. Cada mês é uma nova oportunidade de crescer ainda mais — continue confiando no processo. 💪"
    }
  }
};

function pickMetaTier(percent) {
  if (percent > 100) return "above";
  if (percent === 100) return "exact";
  return "below";
}

// Ponto central de montagem do texto — único lugar que decide estrutura,
// tom e quais blocos aparecem. Chamado tanto pro envio de 1 corretor quanto
// pro "gerar para todos", nunca duplicado.
export function buildManualSummaryMessage(data, periodKey) {
  const period = PERIOD_TEXT[normalizePeriod(periodKey)];
  const tier = data.meta.hasMeta ? pickMetaTier(data.meta.percent) : "below";

  const blocks = [];

  blocks.push(`*${period.title}*\n\n${data.name}, ${period.opening[tier]}`);

  if (data.meta.hasMeta) {
    blocks.push(`*Meta*\n${period.meta[tier](data.meta.percent)}`);
  }

  const highlightLines = INDICATOR_LABELS
    .map(({ key, singular, plural }) => {
      const count = data.indicators[key] || 0;
      return { count, label: count === 1 ? singular : plural };
    })
    .filter((item) => item.count > 0)
    .map((item) => `• ${item.count} ${item.label}`);
  if (highlightLines.length) {
    blocks.push(`*${period.highlightsTitle}*\n${highlightLines.join("\n")}`);
  }

  const pointsLabel = data.points === 1 ? "ponto" : "pontos";
  blocks.push(`*Ranking*\n${period.rankingVerb} em *${data.rankingPosition}º lugar*, com *${data.points} ${pointsLabel}*.`);

  blocks.push(period.closing[tier]);

  return blocks.join("\n\n");
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

    return {
      brokerId,
      name: row.profile.name || "Corretor",
      phone: phoneById.get(brokerId) || "",
      rankingPosition: index + 1,
      points: row.points || 0,
      meta: { hasMeta: meta.total > 0, percent: meta.percent || 0 },
      indicators: {
        prospeccoes: row.prospecting || 0,
        novos_clientes: row.newClients || 0,
        atendimentos: row.service || 0,
        simulacoes: row.simulation || 0,
        documentacoes: row.documentation || 0,
        aprovacoes: row.approval || 0,
        vendas: row.sale || 0,
        atividades_realizadas: row.completedActivities || 0,
        atividades_pendentes: row.awaitingAction || 0
      }
    };
  });

  return { periodLabel: overview.range.label, rows };
}

export async function buildManualWhatsappSummary({ brokerId, period }) {
  const periodKey = normalizePeriod(period);
  const { periodLabel, rows } = await computeManualSummaryTeamData(periodKey);
  const row = rows.find((item) => item.brokerId === brokerId);
  if (!row) throw new Error("Corretor não encontrado.");

  return {
    message: buildManualSummaryMessage(row, periodKey),
    brokerName: row.name,
    phone: row.phone,
    periodLabel
  };
}

export async function buildManualWhatsappSummaryForAll({ period }) {
  const periodKey = normalizePeriod(period);
  const { periodLabel, rows } = await computeManualSummaryTeamData(periodKey);

  return {
    periodLabel,
    items: rows.map((row) => ({
      brokerId: row.brokerId,
      brokerName: row.name,
      phone: row.phone,
      message: buildManualSummaryMessage(row, periodKey)
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
