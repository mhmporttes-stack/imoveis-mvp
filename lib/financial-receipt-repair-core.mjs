// Regra pura (sem banco) do reparo de venda "Recebido" sem recebimento lançado.
// Usada por lib/financial.js (server-only) e testada em tests/financial-receipt-repair.test.mjs.
// Tudo em centavos para não acumular erro de arredondamento. A base (comissão BRUTA, recebido = pagamentos
// "received") é a única da casa: lib/financial-receipt-basis.mjs.

import { fromCents, receiptTargetCents, receivedCentsOf } from "./financial-receipt-basis.mjs";

export const RECEIPT_REPAIR_NOTE = 'Recebimento automático — cliente marcado como "Pago".';

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

  const totalCents = receiptTargetCents(grossCommission);
  if (totalCents <= 0) return { ...none, nextInstallmentNumber };

  const missingCents = totalCents - receivedCentsOf(payList);

  if (missingCents <= 0) return { ...none, nextInstallmentNumber };
  return { needsRepair: true, amount: fromCents(missingCents), nextInstallmentNumber };
}
