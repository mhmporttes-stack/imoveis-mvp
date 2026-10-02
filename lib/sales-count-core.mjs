// Contagem de VENDAS do Desempenho / Visão Geral (função pura, sem banco).
//
// [REGRA OFICIAL — dono, 2026-10-02] Uma venda conta UMA ÚNICA VEZ, na data/hora
// da PRIMEIRA entrada do cliente em qualquer status de Venda. Movimentações
// posteriores (Conformidade, Cartório, Pago...) nunca criam nova venda, nunca
// mudam a data original e nunca levam a venda para outro mês.
//
// Só a quantidade/data da métrica — Financeiro (financial_sales, recebimentos,
// previsão) é outra fonte e não passa por aqui.

function toMs(value) {
  const ms = new Date(value || "").getTime();
  return Number.isFinite(ms) ? ms : null;
}

// historyRows: linhas de client_status_history ({ client_id, new_status,
// changed_at }) em qualquer ordem. isSaleStatus(status) → boolean.
// Retorna Map(clientId → ms da primeira entrada em Venda).
export function findFirstSaleEntries(historyRows, isSaleStatus) {
  const first = new Map();
  for (const row of historyRows || []) {
    if (!row?.client_id || !isSaleStatus(row.new_status)) continue;
    const ms = toMs(row.changed_at);
    if (ms === null) continue;
    const current = first.get(row.client_id);
    if (current === undefined || ms < current) first.set(row.client_id, ms);
  }
  return first;
}

// Vendas cuja PRIMEIRA entrada cai em [range.startIso, range.endIso).
// brokerByClient: Map(clientId → responsável) para o ranking por corretor.
export function countFirstSalesInRange(firstSaleEntries, range, brokerByClient = new Map()) {
  const startMs = toMs(range.startIso);
  const endMs = toMs(range.endIso);
  const perBroker = new Map();
  const clientIds = [];

  for (const [clientId, ms] of firstSaleEntries) {
    if (ms < startMs || ms >= endMs) continue;
    clientIds.push(clientId);
    const brokerId = brokerByClient.get(clientId) || "";
    if (brokerId) perBroker.set(brokerId, (perBroker.get(brokerId) || 0) + 1);
  }

  return { total: clientIds.length, perBroker, clientIds };
}
