// FIN-9 (regra do dono, 2026-10-24): gestor vê só as vendas em que é o gestor da venda, só a parte dele.
import test from "node:test";
import assert from "node:assert/strict";
import { buildManagerCommissionSales, toManagerCommissionView } from "../lib/financial-manager-view-core.mjs";

const sale = (over = {}) => ({
  id: "s1", clientName: "Cliente A", propertyName: "Residencial", brokerName: "Corretor", saleDate: "2026-10-01", saleValue: 200000,
  grossCommission: 10000, hasManagerCommission: true, managerId: "g1", managerPercentage: 10, financialStatus: "partial",
  totals: { managerCommission: 880, brokerCommission: 3960, agencyCommission: 3960, invoiceDeduction: 1200 },
  expenses: [{ category: "ITBI", amount: 500 }], payments: [{ amount: 5000, status: "received" }, { amount: 5000, status: "expected" }],
  ...over
});

test("só as vendas em que ele é o gestor, com comissão de gestor e não canceladas", () => {
  const list = buildManagerCommissionSales([
    sale(),
    sale({ id: "s2", managerId: "g2" }),
    sale({ id: "s3", hasManagerCommission: false }),
    sale({ id: "s4", financialStatus: "cancelled" })
  ], "g1");
  assert.deepEqual(list.map((s) => s.id), ["s1"]);
  assert.deepEqual(buildManagerCommissionSales([sale()], ""), []);
});

test("só a parte dele: nada de bruta, despesas, nota, recebimentos nem partes de corretor/imobiliária", () => {
  const view = toManagerCommissionView(sale());
  assert.equal(view.managerCommission, 880);
  assert.equal(view.managerReceived, 440); // metade da bruta recebida
  assert.equal(view.managerToReceive, 440);
  for (const key of ["grossCommission", "expenses", "payments", "totals", "brokerCommission", "agencyCommission", "invoiceDeduction", "clientPhone", "client"]) {
    assert.equal(key in view, false, key);
  }
});
