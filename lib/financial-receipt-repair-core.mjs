// Regra pura (sem banco) do reparo de venda "Recebido" sem recebimento lançado.
// Usada por lib/financial.js (server-only) e testada em tests/financial-receipt-repair.test.mjs.
// Tudo em centavos para não acumular erro de arredondamento.

export const RECEIPT_REPAIR_NOTE = 'Recebimento automático — cliente marcado como "Pago".';

const toCents = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
};

// Quanto falta lançar para que os recebimentos (status "received") cubram a
// comissão bruta da venda. Só há reparo quando a venda já está "received" e a
// soma recebida é MENOR que a comissão: pagamentos parciais legítimos são
// preservados (só a diferença é lançada), nunca passa do total, e rodar de novo
// depois do reparo devolve amount 0 (idempotente). Venda que não está "received"
// (pendente/parcial/cancelada) nunca é tocada.
export function computeReceiptRepair({ financialStatus, grossCommission, payments = [] } = {}) {
  const none = { needsRepair: false, amount: 0, nextInstallmentNumber: 1 };
  const payList = Array.isArray(payments) ? payments : [];
  const nextInstallmentNumber = payList.reduce((max, payment) => Math.max(max, Number(payment?.installmentNumber ?? payment?.installment_number) || 0), 0) + 1;

  if (financialStatus !== "received") return { ...none, nextInstallmentNumber };

  const totalCents = toCents(grossCommission);
  if (totalCents <= 0) return { ...none, nextInstallmentNumber };

  const receivedCents = payList
    .filter((payment) => payment?.status === "received")
    .reduce((sum, payment) => sum + toCents(payment.amount), 0);
  const missingCents = totalCents - receivedCents;

  if (missingCents <= 0) return { ...none, nextInstallmentNumber };
  return { needsRepair: true, amount: missingCents / 100, nextInstallmentNumber };
}
