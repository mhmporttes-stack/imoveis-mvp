// Agregação pura do estoque por corretor: linhas (corretor, status cru, total)
// -> { byBroker: { [id]: { [status normalizado]: total } } }. O status
// desconhecido/nulo vira o padrão da tela (normalizeStatus), como em
// aggregateStatusCounts. Clientes sem responsável ficam fora (sem id).
export function aggregateBrokerStatus(rows, normalizeStatus) {
  const byBroker = {};
  for (const row of rows || []) {
    const id = row.responsible_user_id;
    if (!id) continue;
    const status = normalizeStatus(row.status);
    byBroker[id] = byBroker[id] || {};
    byBroker[id][status] = (byBroker[id][status] || 0) + (Number(row.total) || 0);
  }
  return { byBroker };
}

export function sumStatuses(byStatus, statuses) {
  return (statuses || []).reduce((sum, status) => sum + ((byStatus && byStatus[status]) || 0), 0);
}
