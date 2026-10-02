import test from "node:test";
import assert from "node:assert/strict";
import {
  computeHealth, expandExpenseOccurrences, addMonthsClamped, rangeFromPeriod, previousRange,
  collectRevenueEvents, collectExpenseEvents, planRecurringSplit, planOverrideMigration, cashAt, evaluateReserve, monthlyOperatingCost, percentChange, formatBRL
} from "../lib/financial-health-core.mjs";

const TODAY = "2026-10-15";
const sale = (over = {}) => ({
  id: "s1", brokerId: "b1", brokerName: "Matheus", financialStatus: "partial",
  grossCommission: 10000, totals: { agencyCommission: 4000 },
  payments: [], ...over
});
const pay = (over) => ({ amount: 0, status: "received", receivedDate: "", expectedDate: "", ...over });
const paid = (expenseId, occurrenceDate, paidAmount, paidDate = occurrenceDate) => ({ expenseId, occurrenceDate, status: "paid", paidDate, paidAmount });
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
  const h = computeHealth({ sales, expenses, overrides: [paid("e1", "2026-10-05", 1000)], today: TODAY });
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
  const h = computeHealth({ sales, expenses, overrides: [paid("e1", "2026-10-03", 8000)], today: TODAY });
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
  const overrides = [paid("e1", "2026-09-10", 500), paid("e1", "2026-10-10", 500)];
  assert.equal(cashAt({ settings, revenueEvents: events, expenses, overrides, atDate: TODAY, today: TODAY }), 11400);
  // sem confirmação manual a despesa NÃO sai do caixa, mesmo com a data vencida
  assert.equal(cashAt({ settings, revenueEvents: events, expenses, overrides: [], atDate: TODAY, today: TODAY }), 12400);
  assert.equal(cashAt({ settings, revenueEvents: events, expenses, overrides, atDate: "2026-08-31", today: TODAY }), null);
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
  const overrides = expenses.map((e) => paid(e.id, e.expenseDate, e.amount));
  const h = computeHealth({ sales: [], expenses, overrides, today: TODAY });
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
  const overrides = expenses.map((e) => paid(e.id, e.expenseDate, e.amount));
  const h = computeHealth({ sales: [], expenses, overrides, today: TODAY });
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

// ---------- despesa prevista × paga (confirmação manual) ----------

const rent = (over = {}) => exp({ id: "r1", description: "Aluguel", amount: 2000, expenseDate: "2026-10-05", expenseType: "fixed", ...over });

test("prevista ≠ paga: despesa com data vencida NÃO vira paga sozinha", () => {
  const h = computeHealth({ sales: [], expenses: [rent()], overrides: [], today: TODAY });
  assert.equal(h.summary.operatingExpenses, 0); // realizado não considera
  assert.equal(h.summary.expenses, 0);
  assert.equal(h.summary.profit, 0);
  assert.equal(h.summary.plannedOperating, 2000); // continua prevista
  assert.equal(h.summary.overdueOperating, 2000); // e vencida
  assert.equal(h.summary.projected.result, -2000); // projeção considera a prevista
});

test("vencimento não confirma pagamento em nenhuma data posterior", () => {
  const later = computeHealth({ sales: [], expenses: [rent()], today: "2027-03-20" });
  assert.equal(later.summary.operatingExpenses, 0);
  assert.equal(later.history.every((r) => r.expenses === 0), true);
});

test("confirmação manual: entra no realizado, no caixa e sai da projeção; usa data e valor pagos", () => {
  const sales = [sale({ payments: [pay({ amount: 5000, receivedDate: "2026-10-03" })] })];
  const settings = { openingCashBalance: 10000, openingCashDate: "2026-10-01" };
  const base = { sales, expenses: [rent()], settings, today: TODAY };
  const before = computeHealth({ ...base, overrides: [] });
  const after = computeHealth({ ...base, overrides: [paid("r1", "2026-10-05", 1950, "2026-10-08")] });
  assert.equal(before.summary.operatingExpenses, 0);
  assert.equal(after.summary.operatingExpenses, 1950); // valor efetivamente pago
  assert.equal(after.summary.plannedOperating, 0);
  assert.equal(before.cash, 12000); // 10000 + 2000 (parte da imobiliária)
  assert.equal(after.cash, 10050);
  assert.equal(after.history.at(-1).expenses, 3000 + 1950);
});

test("pagamento vale na data paga: pago em outro mês cai naquele mês", () => {
  const e = rent({ expenseDate: "2026-09-28" });
  const o = [paid("r1", "2026-09-28", 2000, "2026-10-02")];
  assert.equal(computeHealth({ sales: [], expenses: [e], overrides: o, today: TODAY }).summary.operatingExpenses, 2000);
  assert.equal(computeHealth({ sales: [], expenses: [e], overrides: o, today: TODAY, period: "lastMonth" }).summary.operatingExpenses, 0);
});

test("reagendamento: muda só a data prevista, não paga, e pode mudar de mês", () => {
  const o = [{ expenseId: "r1", occurrenceDate: "2026-10-05", status: "pending", rescheduledTo: "2026-10-28" }];
  const h = computeHealth({ sales: [], expenses: [rent()], overrides: o, today: TODAY });
  assert.equal(h.summary.operatingExpenses, 0);
  assert.equal(h.summary.plannedOperating, 2000);
  assert.equal(h.summary.overdueOperating, 0); // agora vence no futuro
  const moved = computeHealth({ sales: [], expenses: [rent()], overrides: [{ ...o[0], rescheduledTo: "2026-11-10" }], today: TODAY });
  assert.equal(moved.summary.plannedOperating, 0); // saiu de outubro
  assert.equal(computeHealth({ sales: [], expenses: [rent()], overrides: [{ ...o[0], rescheduledTo: "2026-11-10" }], today: TODAY, period: "custom", custom: { start: "2026-11-01", end: "2026-11-30" } }).summary.plannedOperating, 2000);
});

test("reagendar uma ocorrência de recorrente não mexe nas demais", () => {
  const e = rent({ isRecurring: true, recurrencePeriod: "monthly", expenseDate: "2026-08-05" });
  const o = [{ expenseId: "r1", occurrenceDate: "2026-10-05", status: "pending", rescheduledTo: "2026-10-20" }];
  const events = collectExpenseEvents([e], { start: "2026-08-01", end: "2026-11-30" }, TODAY, o);
  assert.deepEqual(events.map((x) => x.date), ["2026-08-05", "2026-09-05", "2026-10-20", "2026-11-05"]);
  assert.deepEqual(events.map((x) => x.status), ["planned", "planned", "planned", "planned"]);
});

test("realizado × projetado: realizado só com pagas; projetado soma previstas (inclusive vencidas) sem estimativa", () => {
  const sales = [sale({ grossCommission: 20000, totals: { agencyCommission: 20000 }, payments: [pay({ amount: 10000, receivedDate: "2026-10-02" }), pay({ amount: 5000, status: "expected", expectedDate: "2026-10-25" })] })];
  const expenses = [rent({ amount: 3000 }), rent({ id: "r2", description: "Sistema", amount: 500, expenseDate: "2026-10-10" }), rent({ id: "r3", description: "Anúncio", amount: 700, expenseDate: "2026-10-30" })];
  const h = computeHealth({ sales, expenses, overrides: [paid("r1", "2026-10-05", 3000)], today: TODAY });
  assert.equal(h.summary.profit, 7000); // 10000 − 3000 paga
  assert.equal(h.summary.projected.result, 10000 + 5000 - 3000 - 500 - 700);
  assert.equal(h.expectation.operatingPlanned, 1200);
  assert.equal(h.expectation.operatingOverdue, 500);
});

test("vencidas de meses anteriores seguem na projeção como obrigação em aberto", () => {
  const e = rent({ expenseDate: "2026-08-05" });
  const h = computeHealth({ sales: [], expenses: [e], overrides: [], today: TODAY });
  assert.equal(h.summary.operatingExpenses, 0);
  assert.equal(h.summary.pendingPriorAmount, 2000);
  assert.equal(h.summary.projected.result, -2000);
  assert.ok(h.insights.some((i) => i.id === "expenses-pending-confirmation"));
  assert.equal(h.evolution.realized.expenses[14], 0); // nunca no realizado
  assert.equal(h.evolution.projected.expenses[30], 2000);
});

test("desfazer confirmação (status pending) volta a prevista", () => {
  const o = [{ expenseId: "r1", occurrenceDate: "2026-10-05", status: "pending", paidDate: null, paidAmount: null }];
  assert.equal(computeHealth({ sales: [], expenses: [rent()], overrides: o, today: TODAY }).summary.operatingExpenses, 0);
});

// ---------- recorrente alterada só dali para frente ----------

test("splitRecurringExpense: histórico intacto, novo valor só a partir da data", () => {
  const old = rent({ isRecurring: true, recurrencePeriod: "monthly", expenseDate: "2026-07-05", amount: 2000 });
  const plan = planRecurringSplit(old, { amount: 2600, category: "Aluguel" }, "2026-10-05");
  assert.equal(plan.mode, "split");
  assert.equal(plan.closeOld.recurrenceEndDate, "2026-10-04");
  assert.equal(plan.newRow.expenseDate, "2026-10-05");
  assert.equal(plan.newRow.amount, 2600);
  const rows = [{ ...old, recurrenceEndDate: plan.closeOld.recurrenceEndDate }, { ...plan.newRow, id: "r2" }];
  const all = collectExpenseEvents(rows, { start: "2026-07-01", end: "2026-12-31" }, "2027-01-01", []);
  assert.deepEqual(all.map((e) => [e.date, e.amount]), [["2026-07-05", 2000], ["2026-08-05", 2000], ["2026-09-05", 2000], ["2026-10-05", 2600], ["2026-11-05", 2600], ["2026-12-05", 2600]]);
});

test("split: ocorrências pagas/passadas mantêm o valor pago e o resumo dos meses encerrados não muda", () => {
  const old = rent({ isRecurring: true, recurrencePeriod: "monthly", expenseDate: "2026-07-05", amount: 2000 });
  const overrides = [paid("r1", "2026-07-05", 2000), paid("r1", "2026-08-05", 2000), paid("r1", "2026-09-05", 2000)];
  const sales = [];
  const before = computeHealth({ sales, expenses: [old], overrides, today: TODAY, period: "lastMonth" });
  const plan = planRecurringSplit(old, { amount: 3000 }, "2026-10-05");
  const rows = [{ ...old, recurrenceEndDate: plan.closeOld.recurrenceEndDate }, { ...plan.newRow, id: "r2" }];
  const after = computeHealth({ sales, expenses: rows, overrides, today: TODAY, period: "lastMonth" });
  assert.equal(after.summary.operatingExpenses, before.summary.operatingExpenses);
  assert.deepEqual(after.history.slice(0, 5).map((r) => r.expenses), before.history.slice(0, 5).map((r) => r.expenses));
  // outubro em diante usa o novo valor (previsto)
  assert.equal(computeHealth({ sales, expenses: rows, overrides, today: TODAY }).summary.plannedOperating, 3000);
});

test("split: mudança de periodicidade ancora na data de vigência; sem passado, edita no lugar", () => {
  const old = rent({ isRecurring: true, recurrencePeriod: "monthly", expenseDate: "2026-07-05", amount: 2000 });
  const q = planRecurringSplit(old, { recurrencePeriod: "quarterly" }, "2026-11-12");
  assert.equal(q.newRow.expenseDate, "2026-11-12");
  assert.equal(q.newRow.recurrencePeriod, "quarterly");
  assert.equal(q.closeOld.recurrenceEndDate, "2026-11-11");
  const fresh = planRecurringSplit(rent({ isRecurring: true, recurrencePeriod: "monthly", expenseDate: "2026-11-05" }), { amount: 10 }, "2026-10-01");
  assert.equal(fresh.mode, "in_place");
  const note = planRecurringSplit(old, { note: "só observação" }, "2026-10-05");
  assert.equal(note.mode, "in_place");
});

test("split: sem alteração relevante não gera versão; mantém o dia do mês quando a periodicidade é a mesma", () => {
  const old = rent({ isRecurring: true, recurrencePeriod: "monthly", expenseDate: "2026-07-31", amount: 100 });
  const plan = planRecurringSplit(old, { amount: 150 }, "2026-10-01");
  assert.equal(plan.newRow.expenseDate, "2026-10-31");
  assert.equal(plan.closeOld.recurrenceEndDate, "2026-09-30");
  assert.equal(planRecurringSplit(old, { amount: 100 }, "2026-10-01").mode, "none");
});

test("migração de confirmações na divisão: leva as que existem na série nova e bloqueia as que sumiriam", () => {
  const old = rent({ isRecurring: true, recurrencePeriod: "monthly", expenseDate: "2026-07-05", amount: 2000 });
  const plan = planRecurringSplit(old, { amount: 2600 }, "2026-10-05");
  const ok = planOverrideMigration([paid("r1", "2026-10-05", 2000), paid("r1", "2026-09-05", 2000)], plan.newRow, "2026-10-05");
  assert.deepEqual(ok.migrate.map((o) => o.occurrenceDate), ["2026-10-05"]); // 09-05 é histórico: fica na série antiga
  const q = planRecurringSplit(old, { recurrencePeriod: "quarterly" }, "2026-10-01");
  const blocked = planOverrideMigration([paid("r1", "2026-11-05", 2000)], q.newRow, "2026-10-01");
  assert.equal(blocked.blocked.length, 1);
});
