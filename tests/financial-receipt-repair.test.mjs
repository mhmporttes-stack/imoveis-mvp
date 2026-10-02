import test from "node:test";
import assert from "node:assert/strict";
import { computeReceiptRepair } from "../lib/financial-receipt-repair-core.mjs";

const received = (amount, installmentNumber = 1) => ({ status: "received", amount, installmentNumber });

test("venda recebida sem nenhum pagamento: repara a comissão inteira (caso Isabella)", () => {
  const result = computeReceiptRepair({ financialStatus: "received", grossCommission: 9000, payments: [] });
  assert.deepEqual(result, { needsRepair: true, amount: 9000, nextInstallmentNumber: 1 });
});

test("preserva pagamento parcial legítimo: lança só a diferença", () => {
  const result = computeReceiptRepair({ financialStatus: "received", grossCommission: 9000, payments: [received(3000)] });
  assert.equal(result.needsRepair, true);
  assert.equal(result.amount, 6000);
  assert.equal(result.nextInstallmentNumber, 2);
});

test("idempotente: depois do reparo, rodar de novo não lança nada", () => {
  const first = computeReceiptRepair({ financialStatus: "received", grossCommission: 9000, payments: [] });
  const after = [received(first.amount)];
  const second = computeReceiptRepair({ financialStatus: "received", grossCommission: 9000, payments: after });
  assert.equal(second.needsRepair, false);
  assert.equal(second.amount, 0);
});

test("nunca ultrapassa o total: soma já cobre ou excede a comissão", () => {
  assert.equal(computeReceiptRepair({ financialStatus: "received", grossCommission: 9000, payments: [received(9000)] }).needsRepair, false);
  assert.equal(computeReceiptRepair({ financialStatus: "received", grossCommission: 9000, payments: [received(9500)] }).needsRepair, false);
});

test("pagamentos previstos/cancelados/atrasados não contam como recebidos", () => {
  const payments = [
    { status: "expected", amount: 4000, installmentNumber: 1 },
    { status: "cancelled", amount: 2000, installmentNumber: 2 },
    { status: "overdue", amount: 1000, installmentNumber: 3 },
    received(1000, 4)
  ];
  const result = computeReceiptRepair({ financialStatus: "received", grossCommission: 9000, payments });
  assert.equal(result.amount, 8000);
  assert.equal(result.nextInstallmentNumber, 5);
});

test("não mexe em venda sem inconsistência: pendente, parcial, cancelada ou sem comissão", () => {
  for (const financialStatus of ["pending", "partial", "cancelled"]) {
    assert.equal(computeReceiptRepair({ financialStatus, grossCommission: 9000, payments: [] }).needsRepair, false);
  }
  assert.equal(computeReceiptRepair({ financialStatus: "received", grossCommission: 0, payments: [] }).needsRepair, false);
  assert.equal(computeReceiptRepair({}).needsRepair, false);
});

test("centavos: sem erro de ponto flutuante", () => {
  const result = computeReceiptRepair({ financialStatus: "received", grossCommission: 31527.1, payments: [received(0.1 + 0.2)] });
  assert.equal(result.amount, 31526.8);
});
