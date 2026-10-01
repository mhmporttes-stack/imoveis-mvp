// Núcleo PURO: transforma resultados já calculados pelas funções das telas
// (Desempenho e Meta da Equipe) em linhas de crm_metric_snapshots. Nenhuma
// regra é recalculada aqui. Chave única: (data, métrica, tipo, dimensão).

// Métricas de EVENTOS do dia fechado (gravadas às 00:10, depois do fechamento da Meta).
export function closeRows(date, overview, goal) {
  const rows = [];
  const m = overview?.metrics;
  if (m) {
    rows.push(
      { date, metric: "clientes_novos", dimensionType: "team", dimensionKey: "all", valueNum: m.newClients },
      { date, metric: "prospeccoes", dimensionType: "team", dimensionKey: "all", valueNum: m.prospecting },
      { date, metric: "atendimentos", dimensionType: "team", dimensionKey: "all", valueNum: m.service },
      { date, metric: "simulacoes", dimensionType: "team", dimensionKey: "all", valueNum: m.simulation },
      { date, metric: "aprovacoes", dimensionType: "team", dimensionKey: "all", valueNum: m.approval },
      { date, metric: "vendas", dimensionType: "team", dimensionKey: "all", valueNum: m.sale }
    );
    for (const row of overview.team || []) {
      if (!row.id) continue;
      const base = { date, dimensionType: "broker", dimensionKey: row.id };
      rows.push(
        { ...base, metric: "clientes_novos", valueNum: row.newClients },
        { ...base, metric: "prospeccoes", valueNum: row.prospecting },
        { ...base, metric: "aprovacoes", valueNum: row.approval },
        { ...base, metric: "vendas", valueNum: row.sale },
        { ...base, metric: "pontos", valueNum: row.points, valueJson: { name: row.name } }
      );
    }
  }
  if (goal?.summary) {
    const brokers = goal.brokers || [];
    rows.push(
      { date, metric: "meta_percentual", dimensionType: "team", dimensionKey: "all", valueNum: goal.summary.metaPercent },
      { date, metric: "meta_bateram", dimensionType: "team", dimensionKey: "all", valueNum: brokers.filter((b) => b.total > 0 && b.percent >= 100).length }
    );
    for (const broker of brokers) {
      if (!broker.id) continue;
      const base = { date, dimensionType: "broker", dimensionKey: broker.id };
      rows.push(
        { ...base, metric: "meta_percentual", valueNum: broker.percent, valueJson: { name: broker.name, done: broker.done, total: broker.total } },
        { ...base, metric: "meta_prospeccao_feita", valueNum: broker.prospectingDone }
      );
    }
  }
  return rows;
}

// Estoque de pendências (Meta Diária) no fim do dia — "quantas pendências ontem".
export function pendenciasRows(date, pendencias) {
  const brokers = pendencias?.brokers || [];
  if (!brokers.length) return [];
  return [
    { date, metric: "pendencias_total", dimensionType: "team", dimensionKey: "all", valueNum: brokers.reduce((sum, b) => sum + (Number(b.remaining) || 0), 0) },
    ...brokers
      .filter((b) => b.id)
      .map((b) => ({ date, metric: "pendencias_total", dimensionType: "broker", dimensionKey: b.id, valueNum: Number(b.remaining) || 0, valueJson: { name: b.name } }))
  ];
}

// Pendências de um dia passado, a partir das linhas lidas do snapshot.
export function pendenciasFromSnapshot(snapshotRows, topicId) {
  const team = snapshotRows.find((r) => r.dimension_type === "team");
  if (!team) return null;
  if (topicId === "pendencias") return { count: team.value_num, items: [] };
  if (topicId === "pendencias_ranking") {
    const items = snapshotRows
      .filter((r) => r.dimension_type === "broker")
      .map((r) => ({ name: r.value_json?.name || "Corretor", count: r.value_num }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR"));
    return { items };
  }
  return { unavailable: "historico" };
}
