import { MEDIDAS, brokerPosition, findBrokerMeta, findBrokerRow, measureValue, rankByMeasure } from "../medidas.mjs";
import { percentText, plural } from "../text.mjs";

// Núcleo PURO do provedor "corretor": recebe o que já está em cache
// (Desempenho do período, Meta Diária) e devolve os dados que as frases do
// catálogo usam. Nenhuma regra de negócio aqui — só escolhe campos.
//   src = { overview, goal, meetings, compromissos, agendaItems, online, semProspeccao }

const SHORT = {
  prospeccoes: (n) => plural(n, "prospecção", "prospecções"),
  atendimentos: (n) => plural(n, "atendimento", "atendimentos"),
  simulacoes: (n) => plural(n, "simulação", "simulações"),
  documentacao: (n) => plural(n, "documentação", "documentações"),
  aprovacao: (n) => `${n} para aprovação`,
  aprovados: (n) => plural(n, "aprovado", "aprovados"),
  reunioes: (n) => plural(n, "reunião", "reuniões"),
  vendas: (n) => plural(n, "venda", "vendas"),
  clientes_novos: (n) => plural(n, "cliente novo", "clientes novos")
};

const withGoal = (periodId) => periodId === "hoje" || periodId === "ontem";

function identity(overview, broker) {
  const row = findBrokerRow(overview, broker);
  return { row, name: row?.name || broker?.name || "", gender: row?.gender || broker?.gender || "" };
}

// Texto curto de um corretor para a comparação ("34 prospecções", "82 por cento da meta").
function compareText(metric, q, src, broker) {
  const { row, name } = identity(src.overview, broker);
  if (metric.startsWith("med_")) {
    const key = metric.slice(4);
    const value = measureValue(src.overview, key, broker);
    return value == null ? null : SHORT[key](value);
  }
  if (metric === "pontos") return row ? plural(row.points, "ponto", "pontos") : null;
  if (metric === "posicao_ranking") {
    const position = brokerPosition(src.overview, broker);
    return position ? `${position.position}º lugar, ${plural(position.points, "ponto", "pontos")}` : null;
  }
  if (metric === "meta_corretor" || metric === "prospeccao_faltam") {
    const meta = withGoal(q.periodo) ? findBrokerMeta(src.goal, broker) : null;
    if (!meta?.hasGoal) return null;
    if (metric === "prospeccao_faltam") return `${meta.prospectingDone} de ${meta.prospectingTarget} prospecções`;
    return `${percentText(meta.percent)} da meta`;
  }
  // resumo objetivo: meta, prospecções e vendas
  const parts = [];
  const meta = withGoal(q.periodo) ? findBrokerMeta(src.goal, broker) : null;
  if (meta?.hasGoal) parts.push(`${percentText(meta.percent)} da meta`);
  if (row) {
    parts.push(SHORT.prospeccoes(row.prospecting));
    parts.push(SHORT.vendas(row.sale));
  }
  return name && parts.length ? parts.join(", ") : null;
}

export function deriveCorretor(q, src) {
  const overview = src.overview;
  const broker = q.corretor || null;
  const { row, name, gender } = identity(overview, broker);
  const topic = q.topic;

  if (topic === "corretor_resumo") {
    if (!row) return null;
    return {
      name,
      gender,
      row,
      meta: withGoal(q.periodo) ? findBrokerMeta(src.goal, broker) : null,
      position: brokerPosition(overview, broker),
      meetings: src.meetings ?? null
    };
  }

  if (topic.startsWith("med_")) {
    const key = topic.slice(4);
    if (!MEDIDAS[key]) return null;
    if (q.kind === "list" && !broker) return { items: rankByMeasure(overview, key) };
    if (broker && !row) return null;
    const value = measureValue(overview, key, broker ? broker : null);
    return value == null ? { unavailable: "equipe" } : { value, name, gender };
  }

  if (topic === "meta_corretor" || topic === "meta_bateu" || topic === "prospeccao_faltam") {
    if (!broker) return null;
    const meta = findBrokerMeta(src.goal, broker);
    return meta ? { name, gender, meta } : null;
  }

  if (topic === "posicao_ranking") {
    if (!broker) return null;
    return { name, gender, position: brokerPosition(overview, broker) };
  }

  if (topic === "atividades_atrasadas" || topic === "acao_pendente") {
    const field = topic === "atividades_atrasadas" ? "overdueActivities" : "awaitingAction";
    if (q.kind === "list" && !broker) {
      const items = (overview.team || [])
        .filter((item) => item.role !== "manager" && item.role !== "admin")
        .map((item) => ({ name: item.name, count: Number(item[field]) || 0 }))
        .filter((item) => item.count > 0)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR"));
      return { items };
    }
    if (broker) return row ? { value: Number(row[field]) || 0, name, gender } : null;
    return { value: Number(overview.attention?.[field === "overdueActivities" ? "overdueActivities" : "awaitingAction"]) || 0 };
  }

  if (topic === "compromissos") return { value: src.compromissos ?? 0, name, gender };

  if (topic === "quem_reuniao") {
    const counts = new Map();
    for (const item of src.agendaItems || []) {
      if (!item.broker) continue;
      counts.set(item.broker, (counts.get(item.broker) || 0) + 1);
    }
    const items = [...counts.entries()].map(([brokerName, count]) => ({ name: brokerName, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR"));
    return { value: items.length, items };
  }

  if (topic === "equipe_resumo") {
    const goal = src.goal;
    const brokers = goal?.brokers || [];
    return {
      metaPercent: goal?.summary?.metaPercent ?? null,
      hit: goal ? brokers.filter((b) => b.total > 0 && b.percent >= 100).length : null,
      prospeccoes: overview?.metrics?.prospecting ?? 0,
      simulacoes: overview?.metrics?.simulation ?? 0,
      vendas: overview?.metrics?.sale ?? 0,
      online: src.online ?? null,
      semProspeccao: goal ? brokers.filter((b) => b.prospectingDone === 0).length : 0
    };
  }

  if (topic === "comparar") {
    const entries = [];
    for (const item of [q.corretor, q.corretor2]) {
      if (!item) continue;
      const identityRow = identity(overview, item);
      const text = compareText(q.metric || "corretor_resumo", q, src, item);
      if (text) entries.push({ name: identityRow.name || item.name, text });
    }
    return entries.length ? { entries } : null;
  }

  return null;
}
