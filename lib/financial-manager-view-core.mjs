// Gestor vê as vendas em que tem comissão (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24, FIN-9): só leitura, só as
// vendas em que ELE é o gestor da venda (financial_sales.manager_id + comissão de gestor ligada), só a parte dele.
// Nada da Saúde, despesas, nota, recebimentos, comissão bruta, parte do corretor/imobiliária nem outras vendas.
// Projeção pura (allowlist): o que não está aqui não sai para o gestor.
import { fromCents, receiptTargetCents, receivedCentsOf, toCents } from "./financial-receipt-basis.mjs";

export function isManagerCommissionSale(sale, managerId) {
  return Boolean(managerId && sale && sale.hasManagerCommission && sale.managerId === managerId && sale.financialStatus !== "cancelled");
}

// Parte do gestor já recebida = comissão do gestor × (recebido ÷ comissão bruta), limitada a 100% — mesma base única de
// recebimento do Financeiro (lib/financial-receipt-basis.mjs: bruta × pagamentos `received`).
export function toManagerCommissionView(sale) {
  const managerCents = toCents(sale.totals?.managerCommission ?? sale.managerCommission);
  const targetCents = receiptTargetCents(sale.grossCommission);
  const ratio = targetCents > 0 ? Math.min(1, receivedCentsOf(sale.payments || []) / targetCents) : 0;
  const receivedCents = Math.round(managerCents * ratio);
  return {
    id: sale.id,
    clientName: sale.clientName || "",
    propertyName: sale.propertyName || "",
    brokerName: sale.brokerName || "",
    saleDate: sale.saleDate || "",
    saleValue: Number(sale.saleValue || 0),
    managerPercentage: Number(sale.managerPercentage || 0),
    managerCommission: fromCents(managerCents),
    managerReceived: fromCents(receivedCents),
    managerToReceive: fromCents(Math.max(0, managerCents - receivedCents)),
    financialStatus: sale.financialStatus || "pending"
  };
}

export function buildManagerCommissionSales(sales, managerId) {
  return (sales || []).filter((sale) => isManagerCommissionSale(sale, managerId)).map(toManagerCommissionView);
}
