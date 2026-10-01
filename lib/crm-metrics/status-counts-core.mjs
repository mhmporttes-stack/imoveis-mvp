// Agregação pura da contagem por status (testável): recebe as linhas do
// banco (status cru + total), a função que normaliza o status e os grupos da
// tela Clientes. Mesma regra de getSimulationClientCounters: status
// desconhecido/nulo vira o padrão; o grupo é a soma dos status dele.
export function aggregateStatusCounts(rows, normalizeStatus, groups) {
  const byStatus = {};
  let total = 0;
  for (const row of rows || []) {
    const count = Number(row.total) || 0;
    const status = normalizeStatus(row.status);
    byStatus[status] = (byStatus[status] || 0) + count;
    total += count;
  }
  const byGroup = {};
  for (const group of groups || []) {
    byGroup[group.key] = group.key === "all" ? total : group.statuses.reduce((sum, status) => sum + (byStatus[status] || 0), 0);
  }
  return { total, byStatus, byGroup };
}

// Idade do dado em minutos e se ainda está dentro da janela de validade.
export function cacheFreshness(computedAtIso, validMinutes, now = Date.now()) {
  const computed = new Date(computedAtIso || "").getTime();
  if (!Number.isFinite(computed)) return { fresh: false, ageMinutes: null };
  const ageMinutes = Math.max(0, Math.round((now - computed) / 60000));
  return { fresh: ageMinutes <= validMinutes, ageMinutes };
}
