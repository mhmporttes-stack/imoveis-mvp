import test from "node:test";
import assert from "node:assert/strict";
import {
  computeHealth, expandExpenseOccurrences, addMonthsClamped, rangeFromPeriod, previousRange,
  collectRevenueEvents, cashAt, evaluateReserve, monthlyOperatingCost, percentChange, formatBRL
} from "../lib/financial-health-core.mjs";

const TODAY = "2026-10-15";
const sale = (over = {}) => ({
  id: "s1", brokerId: "b1", brokerName: "Matheus", financialStatus: "partial",
  grossCommission: 10000, totals: { agencyCommission: 4000 },
  payments: [], ...over
});
const pay = (over) => ({ amount: 0, status: "received", receivedDate: "", expectedDate: "", ...over });
const exp = (over = {}) => ({ id: "e1", description: "Aluguel", category: "Aluguel", expenseType: "fixed", amount: 2000, expenseDate: "2026-08-05", isRecurring: false, recurrencePeriod: null, recurrenceEndDate: null, ...over });

test("despesa única só aparece no mês da data", () => {
  const e = exp({ expenseDate: "2026-10-05", expenseType: "variable" });
  assert.equal(expandExpenseOccurrences(e, "2026-10-01", "2026-10-31").length, 1);
  assert.equal(expandExpenseOccurrences(e, "2026-11-01", "2026-11-30").length, 0);
});

test("recorrente mensal: considerada nos meses seguintes sem materializar, ajusta dia 31", () => {
  const e = exp({ isRecurring: true, recurrencePeriod: "monthly", expenseDate: "2026-01-31" });
  const occ = expandExpenseOccurrences(e, "2026-02-01", "2026-04-30").map((o) => o.date);
  assert.deepEqual(occ, ["2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.equal(addMonthsClamped("2026-01-31", 1, 31), "2026-02-28");
});

test("recorrência respeita encerramento, início e periodicidade trimestral", () => {
  const e = exp({ isRecurring: true, recurrencePeriod: "quarterly", expenseDate: "2026-01-10", recurrenceEndDate: "2026-08-01" });
  assert.deepEqual(expandExpenseOccurrences(e, "2025-01-01", "2026-12-31").map((o) => o.date), ["2026-01-10", "2026-04-10", "2026-07-10"]);
  assert.equal(expandExpenseOccurrences(e, "2025-01-01", "2025-12-31").length, 0);
});

test("valor 0 ou data inválida não gera ocorrência", () => {
  assert.equal(expandExpenseOccurrences(exp({ amount: 0 }), "2026-01-01", "2026-12-31").length, 0);
  assert.equal(expandExpenseOccurrences(exp({ expenseDate: "x" }), "2026-01-01", "2026-12-31").length, 0);
});

test("receita recebida × prevista nunca se misturam; cancelado é ignorado", () => {
  const sales = [sale({ payments: [
    pay({ amount: 5000, receivedDate: "2026-10-03" }),
    pay({ amount: 3000, status: "expected", expectedDate: "2026-10-25" }),
    pay({ amount: 1000, status: "cancelled", expectedDate: "2026-10-20" })
  ] }), sale({ id: "s2", financialStatus: "cancelled", payments: [pay({ amount: 9000, receivedDate: "2026-10-04" })] })];
  const h = computeHealth({ sales, expenses: [], today: TODAY });
  assert.equal(h.summary.revenueGross, 5000);
  assert.equal(h.summary.expectedGross, 3000);
  assert.equal(h.summary.projected.revenueGross, 8000);
});

test("lucro, margem: apropria custos da venda proporcionalmente ao recebido", () => {
  const sales = [sale({ payments: [pay({ amount: 5000, receivedDate: "2026-10-03" })] })];
  const expenses = [exp({ expenseDate: "2026-10-05", expenseType: "variable", amount: 1000 })];
  const h = computeHealth({ sales, expenses, today: TODAY });
  // 5000 recebido: parte da imobiliária 40% = 2000; custos da venda 3000
  assert.equal(h.summary.netRevenue, 2000);
  assert.equal(h.summary.saleCosts, 3000);
  assert.equal(h.summary.operatingExpenses, 1000);
  assert.equal(h.summary.expenses, 4000);
  assert.equal(h.summary.profit, 1000); // 5000 - 4000
  assert.equal(h.summary.marginPercent, 20);
});

test("mês vazio e R$ 0: sem divisão por zero, margem nula", () => {
  const h = computeHealth({ sales: [], expenses: [], today: TODAY });
  assert.equal(h.summary.revenueGross, 0);
  assert.equal(h.summary.profit, 0);
  assert.equal(h.summary.marginPercent, null);
  assert.equal(h.cash, null);
  assert.equal(h.cashConfigured, false);
  assert.equal(h.reserve.level, null);
  assert.equal(h.breakEven.grossNeeded, null);
  assert.deepEqual(h.byBroker, []);
  assert.equal(h.changes.revenue, null);
});

test("despesa futura é prevista, não realizada", () => {
  const expenses = [exp({ expenseDate: "2026-10-28", expenseType: "variable", amount: 700 })];
  const h = computeHealth({ sales: [], expenses, today: TODAY });
  assert.equal(h.summary.operatingExpenses, 0);
  assert.equal(h.summary.plannedOperating, 700);
  assert.equal(h.summary.projected.result, -700);
});

test("exemplo do dono: expectativa separa real de projetado", () => {
  // recebido 25.000, previsto 12.000, despesas realizadas 8.000, previstas 4.000 → 25.000
  const sales = [sale({ grossCommission: 40000, totals: { agencyCommission: 40000 }, payments: [
    pay({ amount: 25000, receivedDate: "2026-10-02" }),
    pay({ amount: 12000, status: "expected", expectedDate: "2026-10-28" })
  ] })];
  const expenses = [exp({ expenseDate: "2026-10-03", amount: 8000, expenseType: "variable" }), exp({ id: "e2", expenseDate: "2026-10-29", amount: 4000, expenseType: "variable" })];
  const h = computeHealth({ sales, expenses, today: TODAY });
  assert.equal(h.summary.profit, 17000);
  assert.equal(h.summary.projected.result, 25000);
  assert.equal(h.expectation.result, 25000);
  assert.equal(h.expectation.expensesPlanned, 4000);
});

test("caixa: não inventa saldo; com saldo inicial soma entradas e subtrai saídas", () => {
  const sales = [sale({ payments: [pay({ amount: 5000, receivedDate: "2026-10-03" }), pay({ amount: 1000, receivedDate: "2026-09-01" })] })];
  const { events } = collectRevenueEvents(sales, TODAY);
  const expenses = [exp({ isRecurring: true, recurrencePeriod: "monthly", expenseDate: "2026-09-10", amount: 500 })];
  assert.equal(cashAt({ settings: { openingCashBalance: null, openingCashDate: "" }, revenueEvents: events, expenses, atDate: TODAY, today: TODAY }), null);
  const settings = { openingCashBalance: 10000, openingCashDate: "2026-09-01" };
  // entradas líquidas: 1000*0.4 + 5000*0.4 = 2400; saídas operacionais: 09-10 e 10-10 = 1000
  assert.equal(cashAt({ settings, revenueEvents: events, expenses, atDate: TODAY, today: TODAY }), 11400);
  assert.equal(cashAt({ settings, revenueEvents: events, expenses, atDate: "2026-08-31", today: TODAY }), null);
});

test("reserva/cobertura: critérios matemáticos configuráveis", () => {
  const s = { reserveMonths: 3, criticalMonths: 1 };
  assert.equal(evaluateReserve({ cash: 9000, monthlyCost: 3000, settings: s }).level, "healthy");
  assert.equal(evaluateReserve({ cash: 6000, monthlyCost: 3000, settings: s }).level, "attention");
  assert.equal(evaluateReserve({ cash: 3000, monthlyCost: 3000, settings: s }).level, "critical");
  assert.equal(evaluateReserve({ cash: 3000, monthlyCost: 3000, settings: s }).recommended, 9000);
  assert.equal(evaluateReserve({ cash: 3000, monthlyCost: 0, settings: s }).level, null);
  assert.equal(evaluateReserve({ cash: null, monthlyCost: 3000, settings: s }).level, null);
});

test("custo operacional mensal usa o maior entre média de 3 meses e recorrência", () => {
  const rent = exp({ isRecurring: true, recurrencePeriod: "monthly", expenseDate: "2026-10-01", amount: 2000 });
  assert.equal(monthlyOperatingCost({ expenses: [rent], today: TODAY }).value, 2000);
  const old = exp({ isRecurring: true, recurrencePeriod: "monthly", expenseDate: "2026-01-01", amount: 1000 });
  const extra = exp({ id: "x", expenseType: "extraordinary", expenseDate: "2026-09-02", amount: 99999 });
  assert.equal(monthlyOperatingCost({ expenses: [old, extra], today: TODAY }).value, 1000);
});

test("ponto de equilíbrio: falta = necessário − recebido", () => {
  const sales = [sale({ payments: [pay({ amount: 5000, receivedDate: "2026-10-03" })] })];
  const expenses = [exp({ isRecurring: true, recurrencePeriod: "monthly", expenseDate: "2026-10-01", amount: 3000 })];
  const h = computeHealth({ sales, expenses, today: TODAY });
  assert.equal(h.breakEven.contributionPercent, 40);
  assert.equal(h.breakEven.grossNeeded, 7500);
  assert.equal(h.breakEven.grossGap, 2500);
  assert.equal(h.breakEven.netGap, 1000);
});

test("resultado por corretor usa parte da imobiliária recebida, não VGV; período selecionável", () => {
  const sales = [
    sale({ payments: [pay({ amount: 10000, receivedDate: "2026-10-03" })] }),
    sale({ id: "s2", brokerId: "b2", brokerName: "Isabela", grossCommission: 10000, totals: { agencyCommission: 5000 }, payments: [pay({ amount: 4000, receivedDate: "2026-10-04" }), pay({ id: "p", amount: 1000, receivedDate: "2026-09-04" })] })
  ];
  const h = computeHealth({ sales, expenses: [], today: TODAY });
  assert.deepEqual(h.byBroker.map((b) => [b.name, b.agencyResult]), [["Matheus", 4000], ["Isabela", 2000]]);
  const last = computeHealth({ sales, expenses: [], today: TODAY, period: "lastMonth" });
  assert.deepEqual(last.byBroker.map((b) => [b.name, b.agencyResult]), [["Isabela", 500]]);
});

test("período personalizado e comparação com período anterior", () => {
  const r = rangeFromPeriod("custom", TODAY, { start: "2026-10-10", end: "2026-10-19" });
  assert.deepEqual(previousRange(r), { start: "2026-09-30", end: "2026-10-09" });
  assert.deepEqual(previousRange({ start: "2026-10-01", end: "2026-10-31" }), { start: "2026-09-01", end: "2026-09-30" });
  const sales = [sale({ payments: [pay({ amount: 2000, receivedDate: "2026-09-12" }), pay({ amount: 3000, receivedDate: "2026-10-12" })] })];
  const h = computeHealth({ sales, expenses: [], today: TODAY });
  assert.equal(h.changes.revenue, 50);
  assert.equal(percentChange(10, 0), null);
});

test("evolução: realizado até hoje, projeção separada, mês anterior acumulado", () => {
  const sales = [sale({ payments: [pay({ amount: 5000, receivedDate: "2026-10-03" }), pay({ amount: 2000, status: "expected", expectedDate: "2026-10-20" }), pay({ amount: 1000, receivedDate: "2026-09-10" })] })];
  const h = computeHealth({ sales, expenses: [], today: TODAY });
  const ev = h.evolution;
  assert.equal(ev.todayIndex, 15);
  assert.equal(ev.realized.revenue[14], 5000);
  assert.equal(ev.realized.revenue[15], null); // não mostra o futuro como realizado
  assert.equal(ev.projected.revenue[14], 5000);
  assert.equal(ev.projected.revenue[30], 7000);
  assert.equal(ev.previous.revenue[29], 1000);
});

test("apontamentos: fato/apontamento/recomendação, sem chamar de desnecessário; detecta duplicidade e alta", () => {
  const expenses = [
    exp({ id: "a", description: "Anúncio", category: "Anúncios", expenseType: "variable", amount: 1000, expenseDate: "2026-09-10" }),
    exp({ id: "b", description: "Anúncio", category: "Anúncios", expenseType: "variable", amount: 2000, expenseDate: "2026-10-10" }),
    exp({ id: "c", description: "Anúncio", category: "Anúncios", expenseType: "variable", amount: 2000, expenseDate: "2026-10-10" })
  ];
  const h = computeHealth({ sales: [], expenses, today: TODAY });
  const ids = h.insights.map((i) => i.id);
  assert.ok(ids.includes("expenses-variation"));
  assert.ok(ids.includes("possible-duplicates"));
  assert.ok(ids.includes("category-up-Anúncios"));
  assert.ok(!JSON.stringify(h.insights).toLowerCase().includes("desnecess"));
  const v = h.insights.find((i) => i.id === "expenses-variation");
  assert.ok(v.fact && v.flag && v.recommendation);
});

test("estimativa fica separada do previsto", () => {
  const expenses = [
    exp({ id: "a", expenseType: "variable", amount: 900, expenseDate: "2026-07-10" }),
    exp({ id: "b", expenseType: "variable", amount: 900, expenseDate: "2026-08-10" }),
    exp({ id: "c", expenseType: "variable", amount: 900, expenseDate: "2026-09-10" })
  ];
  const h = computeHealth({ sales: [], expenses, today: TODAY });
  assert.equal(h.estimate.remaining, 900);
  assert.equal(h.summary.projected.result, 0); // estimativa não entra no projetado
});

test("formatação brasileira", () => {
  assert.match(formatBRL(12500), /R\$\s12\.500,00/);
});

test("previsão de recebimento do saldo entra como PREVISTO (sem dupla contagem com parcelas datadas)", () => {
  const base = sale({
    financialStatus: "partial", grossCommission: 10000, totals: { agencyCommission: 4000, freeCommission: 10000 },
    expectedReceiptDate: "2026-10-27",
    payments: [pay({ amount: 4000, receivedDate: "2026-10-03" }), pay({ amount: 2000, status: "expected", expectedDate: "2026-10-20" })]
  });
  const h = computeHealth({ sales: [base], expenses: [], today: TODAY });
  assert.equal(h.summary.revenueGross, 4000);
  // parcela datada 2.000 + saldo da previsão (10.000 − 4.000 − 2.000 = 4.000)
  assert.equal(h.summary.expectedGross, 6000);
  assert.equal(h.expectation.forecastIncluded, 4000);
  // não-dono: o servidor zera a data → nada de previsão
  const hidden = computeHealth({ sales: [{ ...base, expectedReceiptDate: "" }], expenses: [], today: TODAY });
  assert.equal(hidden.summary.expectedGross, 2000);
  // venda recebida nunca tem previsão
  const done = computeHealth({ sales: [{ ...base, financialStatus: "received" }], expenses: [], today: TODAY });
  assert.equal(done.expectation.forecastIncluded, 0);
});
