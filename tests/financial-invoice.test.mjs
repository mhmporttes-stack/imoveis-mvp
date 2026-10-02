import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_INVOICE_PERCENTAGE, calculateCommissionDistribution, calculateInvoiceDeduction, calculateSaleBase,
  parseInvoicePercentage, resolveInvoicePercentage
} from "../lib/financial-calculations.js";
import { computeHealth, splitSaleShares } from "../lib/financial-health-core.mjs";

const TODAY = "2026-10-15";

// Monta uma venda como o servidor (lib/financial.js) a entrega: nota → despesas → livre → distribuição.
function buildSale({ gross = 10000, saleValue = 500000, invoicePercentage = 0, expenses = [], manager = false, payments = [], status = "partial", id = "s1", broker = "Matheus", expectedReceiptDate = "" } = {}) {
  const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const base = calculateSaleBase({ grossCommission: gross, invoicePercentage, expenseTotal });
  const dist = calculateCommissionDistribution({ freeCommission: base.freeCommission, hasManagerCommission: manager, managerPercentage: 10, brokerPercentage: 50, agencyPercentage: 50 });
  return {
    id, brokerId: broker, brokerName: broker, financialStatus: status, saleValue, grossCommission: gross, invoicePercentage,
    expenses, payments, expectedReceiptDate,
    totals: { grossCommission: gross, invoiceDeduction: base.invoiceDeduction, expenseTotal, freeCommission: base.freeCommission, ...dist }
  };
}
const received = (amount, receivedDate) => ({ amount, status: "received", receivedDate, expectedDate: "" });
const expected = (amount, expectedDate) => ({ amount, status: "expected", receivedDate: "", expectedDate });

test("nota fiscal: 0%, 6%, 10%, 12%, 15% e 20% sobre a comissão (não sobre o VGV)", () => {
  const casos = { 0: 0, 6: 600, 10: 1000, 12: 1200, 15: 1500, 20: 2000 };
  for (const [pct, esperado] of Object.entries(casos)) {
    assert.equal(calculateInvoiceDeduction(10000, Number(pct)), esperado, `${pct}%`);
    const base = calculateSaleBase({ grossCommission: 10000, invoicePercentage: Number(pct), expenseTotal: 0 });
    assert.equal(base.invoiceDeduction, esperado);
    assert.equal(base.freeCommission, 10000 - esperado);
  }
  // VGV diferente não muda a nota
  assert.equal(buildSale({ saleValue: 100000, invoicePercentage: 12 }).totals.invoiceDeduction, 1200);
  assert.equal(buildSale({ saleValue: 9000000, invoicePercentage: 12 }).totals.invoiceDeduction, 1200);
});

test("exemplo do dono: base R$ 10.000 e nota 12% = despesa fiscal R$ 1.200", () => {
  assert.equal(calculateInvoiceDeduction(10000, 12), 1200);
  assert.equal(calculateSaleBase({ grossCommission: 10000, invoicePercentage: 12 }).freeCommission, 8800);
});

test("nota sai antes da divisão e uma única vez: bruta = nota + despesas + gestor + corretor + imobiliária", () => {
  for (const pct of [0, 6, 10, 12, 15, 20]) {
    const sale = buildSale({ invoicePercentage: pct, expenses: [{ category: "Cartório", amount: 300 }], manager: true });
    const t = sale.totals;
    const soma = t.invoiceDeduction + t.expenseTotal + t.managerCommission + t.brokerCommission + t.agencyCommission;
    assert.ok(Math.abs(soma - 10000) < 0.011, `${pct}%: ${soma}`);
  }
});

test("percentuais fracionados e entrada inválida", () => {
  assert.equal(calculateInvoiceDeduction(10000, 6.5), 650);
  assert.equal(parseInvoicePercentage("12,5"), 12.5);
  assert.equal(parseInvoicePercentage(""), 0);
  assert.equal(parseInvoicePercentage("12%"), 12);
  assert.throws(() => parseInvoicePercentage("101"));
  assert.throws(() => parseInvoicePercentage("-1"));
  assert.throws(() => parseInvoicePercentage("abc"));
});

test("vendas antigas preservadas: com nota = 15%, sem nota = 0%, % próprio vence; campo limpo = 0%", () => {
  assert.equal(LEGACY_INVOICE_PERCENTAGE, 15);
  assert.equal(resolveInvoicePercentage({ invoiceIssued: true }), 15);
  assert.equal(resolveInvoicePercentage({ invoiceIssued: false }), 0);
  assert.equal(resolveInvoicePercentage({ invoicePercentage: 6, invoiceIssued: true }), 6);
  assert.equal(resolveInvoicePercentage({ invoicePercentage: 0, invoiceIssued: true }), 0);
  assert.equal(resolveInvoicePercentage({ invoicePercentage: "", invoiceIssued: true }), 0);
  assert.equal(resolveInvoicePercentage({ invoicePercentage: null, invoiceIssued: true }), 15);
});

test("migração não altera valor histórico: fórmula antiga (15% fixo) == nova com % migrado", () => {
  const oldCalc = (gross, issued) => Math.round(((issued ? gross * 0.15 : 0) + Number.EPSILON) * 100) / 100;
  for (const gross of [94927.1, 10000, 1234.57, 0.01, 8333.33, 45000]) {
    for (const issued of [true, false]) {
      const migrated = issued ? 15 : 0; // o que a migration grava
      assert.equal(calculateInvoiceDeduction(gross, migrated), oldCalc(gross, issued), `${gross} ${issued}`);
    }
  }
});

test("cada venda tem o seu percentual: A=6%, B=15%, C=20% sem interferência", () => {
  const sales = ["A", "B", "C"].map((id, i) => buildSale({ id, invoicePercentage: [6, 15, 20][i], payments: [received(10000, "2026-10-03")] }));
  assert.deepEqual(sales.map((s) => s.totals.invoiceDeduction), [600, 1500, 2000]);
  const h = computeHealth({ sales, expenses: [], today: TODAY });
  assert.equal(h.summary.invoice, 4100);
  assert.equal(h.summary.revenueGross, 30000);
});

test("repasse NÃO é despesa operacional: aparece só em Repasses", () => {
  const sale = buildSale({ invoicePercentage: 0, manager: true, expenses: [{ category: "Corretor parceiro", amount: 500 }, { category: "Cartório", amount: 300 }], payments: [received(10000, "2026-10-03")] });
  const h = computeHealth({ sales: [sale], expenses: [], today: TODAY });
  const t = sale.totals;
  assert.equal(h.summary.repasses, t.brokerCommission + t.managerCommission + 500);
  assert.equal(h.summary.operatingExpenses, 0); // despesas da empresa
  assert.equal(h.summary.saleExpenses, 300); // só a despesa da venda que não é repasse
  assert.equal(h.summary.operatingTotal, 300);
  assert.equal(h.summary.invoice, 0);
});

test("nota entra uma única vez e a conta fecha: receita = repasses + nota + despesas da venda + imobiliária", () => {
  for (const pct of [0, 6, 10, 12, 15, 20]) {
    const sale = buildSale({ invoicePercentage: pct, manager: true, expenses: [{ category: "Bonificação", amount: 200 }, { category: "ITBI", amount: 100 }], payments: [received(10000, "2026-10-03")] });
    const s = computeHealth({ sales: [sale], expenses: [], today: TODAY }).summary;
    assert.equal(s.invoice, calculateInvoiceDeduction(10000, pct), `${pct}%`);
    const fecha = s.repasses + s.invoice + s.saleExpenses + s.netRevenue;
    assert.ok(Math.abs(fecha - s.revenueGross) < 0.011, `${pct}%: ${fecha}`);
    // resultado = receita − repasses − nota − despesas operacionais
    assert.ok(Math.abs(s.netResult - (s.revenueGross - s.repasses - s.invoice - s.operatingTotal)) < 0.011);
  }
});

test("mudar o percentual recalcula nota, resultado e Saúde", () => {
  const make = (pct) => buildSale({ invoicePercentage: pct, payments: [received(10000, "2026-10-03")] });
  const a = computeHealth({ sales: [make(6)], expenses: [], today: TODAY }).summary;
  const b = computeHealth({ sales: [make(12)], expenses: [], today: TODAY }).summary;
  assert.equal(a.invoice, 600);
  assert.equal(b.invoice, 1200);
  assert.equal(a.netResult, 4700); // (10000 − 600) / 2
  assert.equal(b.netResult, 4400); // (10000 − 1200) / 2
  assert.equal(a.netResult - b.netResult, 300); // metade da diferença da nota (a outra metade é do corretor)
});

test("recebimento parcial apropria nota e repasses proporcionalmente (sem dupla dedução)", () => {
  const sale = buildSale({ invoicePercentage: 10, payments: [received(4000, "2026-10-03")] });
  const s = computeHealth({ sales: [sale], expenses: [], today: TODAY }).summary;
  assert.equal(s.invoice, 400); // 10% de 4.000
  assert.equal(s.repasses, 1800); // (10.000 − 1.000)/2 × 40%
  assert.equal(s.netRevenue, 1800);
  assert.equal(s.revenueGross, 4000);
});

test("resultado líquido REALIZADO usa só despesas operacionais PAGAS", () => {
  const sale = buildSale({ invoicePercentage: 12, payments: [received(10000, "2026-10-03")] });
  const expenses = [{ id: "e1", description: "Aluguel", category: "Aluguel", expenseType: "fixed", amount: 1000, expenseDate: "2026-10-05", isRecurring: false }];
  const prevista = computeHealth({ sales: [sale], expenses, overrides: [], today: TODAY }).summary;
  const paga = computeHealth({ sales: [sale], expenses, overrides: [{ expenseId: "e1", occurrenceDate: "2026-10-05", status: "paid", paidDate: "2026-10-06", paidAmount: 1000 }], today: TODAY }).summary;
  // 10.000 − repasses 4.400 − nota 1.200 = 4.400 (parte da imobiliária)
  assert.equal(prevista.revenueGross, 10000);
  assert.equal(prevista.repasses, 4400);
  assert.equal(prevista.invoice, 1200);
  assert.equal(prevista.operatingExpenses, 0);
  assert.equal(prevista.netResult, 4400);
  assert.equal(paga.operatingExpenses, 1000);
  assert.equal(paga.netResult, 3400);
});

test("resultado PROJETADO: previsto separado do realizado (receita, repasses, nota e despesas previstas)", () => {
  const sale = buildSale({ gross: 20000, invoicePercentage: 10, payments: [received(10000, "2026-10-03"), expected(6000, "2026-10-25")] });
  const expenses = [{ id: "e1", description: "Sistema", category: "Sistemas e assinaturas", expenseType: "fixed", amount: 500, expenseDate: "2026-10-28", isRecurring: false }];
  const h = computeHealth({ sales: [sale], expenses, overrides: [], today: TODAY });
  const s = h.summary;
  // realizado: 10.000 × (nota 10% = 2.000 → livre 18.000 → corretor 9.000, imob. 9.000)
  assert.equal(s.invoice, 1000);
  assert.equal(s.repasses, 4500);
  assert.equal(s.netResult, 4500);
  // previsto (6.000 = 30% da comissão): nota 600, repasses 2.700, imobiliária 2.700 — NÃO entram no realizado
  assert.equal(s.expectedGross, 6000);
  assert.equal(s.expectedInvoice, 600);
  assert.equal(s.expectedRepasses, 2700);
  assert.equal(s.plannedOperating, 500);
  assert.equal(s.projected.invoice, 1600);
  assert.equal(s.projected.repasses, 7200);
  assert.equal(s.projected.result, 4500 + 2700 - 500);
  assert.equal(s.netResult, 4500); // realizado intacto
});

test("comissão menor que as deduções (livre = 0): fatias fecham sem passar da receita", () => {
  const sale = buildSale({ gross: 1000, invoicePercentage: 20, expenses: [{ category: "ITBI", amount: 1500 }], payments: [received(1000, "2026-10-03")] });
  const s = computeHealth({ sales: [sale], expenses: [], today: TODAY }).summary;
  assert.equal(s.netRevenue, 0);
  assert.ok(Math.abs(s.invoice + s.saleExpenses + s.repasses - 1000) < 0.011);
  assert.ok(s.invoice >= 0 && s.saleExpenses >= 0 && s.repasses >= 0);
});

test("venda sem detalhamento: o que não é da imobiliária fica como repasse", () => {
  const shares = splitSaleShares({ grossCommission: 10000, totals: { agencyCommission: 4000 } });
  assert.equal(Math.round(shares.repasses * 10000), 6000);
  assert.equal(shares.invoice, 0);
});

test("vendas canceladas e mês vazio não geram nota nem repasse", () => {
  const sale = buildSale({ invoicePercentage: 20, status: "cancelled", payments: [received(10000, "2026-10-03")] });
  const s = computeHealth({ sales: [sale], expenses: [], today: TODAY }).summary;
  assert.equal(s.invoice, 0);
  assert.equal(s.repasses, 0);
  assert.equal(computeHealth({ sales: [], expenses: [], today: TODAY }).summary.netResult, 0);
});
