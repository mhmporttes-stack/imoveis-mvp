import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildExpensePanel, collectExpenseEvents, computeHealth, dueStatus, forecastAmountFor, planRecurringSplit,
  saoPauloToday, DUE_SOON_DAYS
} from "../lib/financial-health-core.mjs";

const TODAY = "2026-10-15";
const exp = (over = {}) => ({
  id: "e1", description: "Energia", category: "Energia", expenseType: "fixed", amountMode: "variable", amount: 300,
  expenseDate: "2026-07-10", isRecurring: true, recurrencePeriod: "monthly", recurrenceEndDate: null, ...over
});
const paid = (expenseId, occurrenceDate, paidAmount, expectedAmount = null, paidDate = occurrenceDate) =>
  ({ expenseId, occurrenceDate, status: "paid", paidDate, paidAmount, expectedAmount });
const month = (m) => ({ start: `2026-${m}-01`, end: `2026-${m}-31` });

test("série variável: 3 meses pagos em valores diferentes — a próxima previsão é o último pago", () => {
  const e = exp();
  const ov = [paid("e1", "2026-07-10", 280, 300), paid("e1", "2026-08-10", 410, 280), paid("e1", "2026-09-10", 350, 410)];
  const events = collectExpenseEvents([e], { start: "2026-07-01", end: "2026-12-31" }, TODAY, ov);
  const by = Object.fromEntries(events.map((x) => [x.originalDate, x]));
  assert.equal(by["2026-07-10"].amount, 280); // histórico intacto (pago)
  assert.equal(by["2026-08-10"].amount, 410);
  assert.equal(by["2026-09-10"].amount, 350);
  assert.equal(by["2026-10-10"].expectedAmount, 350); // não paga: referência = último pago (setembro)
  assert.equal(by["2026-11-10"].expectedAmount, 350);
  assert.equal(by["2026-12-10"].expectedAmount, 350);
  assert.equal(by["2026-10-10"].status, "planned");
  assert.equal(by["2026-09-10"].paidAmount, 350);
  assert.equal(by["2026-09-10"].expectedAmount, 410); // previsto congelado ao confirmar
});

test("série variável sem nenhuma paga usa o valor cadastrado; ocorrência anterior à paga não é afetada", () => {
  const e = exp();
  assert.equal(forecastAmountFor(e, "2026-10-10", []), 300);
  const ov = [paid("e1", "2026-09-10", 500, 300)];
  assert.equal(forecastAmountFor(e, "2026-08-10", ov), 300); // mês passado não é reescrito pela paga posterior
  assert.equal(forecastAmountFor(e, "2026-10-10", ov), 500);
  assert.equal(forecastAmountFor(e, "2026-09-10", ov), 300); // a própria ocorrência não se auto-referencia
});

test("referência é por série: pagamento de outra despesa não contamina", () => {
  const a = exp({ id: "a" });
  const b = exp({ id: "b", amount: 100 });
  const ov = [paid("a", "2026-09-10", 999, 300)];
  assert.equal(forecastAmountFor(b, "2026-10-10", ov), 100);
  assert.equal(forecastAmountFor(a, "2026-10-10", ov), 999);
});

test("série fixa continua exatamente como hoje (valor cadastrado, mesmo com paga diferente)", () => {
  const e = exp({ id: "f1", amountMode: "fixed", amount: 2000 });
  const ov = [paid("f1", "2026-09-10", 2500, 2000)];
  const events = collectExpenseEvents([e], { start: "2026-09-01", end: "2026-11-30" }, TODAY, ov);
  const by = Object.fromEntries(events.map((x) => [x.originalDate, x]));
  assert.equal(by["2026-09-10"].amount, 2500);
  assert.equal(by["2026-10-10"].expectedAmount, 2000);
  assert.equal(by["2026-11-10"].expectedAmount, 2000);
  // despesa antiga (sem amountMode) = fixa
  const old = exp({ id: "old", amount: 700 });
  delete old.amountMode;
  assert.equal(collectExpenseEvents([old], month("11"), TODAY, [paid("old", "2026-10-10", 900)])[0].amount, 700);
});

test("ocorrência paga mantém expected_amount e paid_amount; sem previsto congelado (legado) fica nulo", () => {
  const e = exp({ amountMode: "fixed", amount: 1000 });
  const ev = collectExpenseEvents([e], month("09"), TODAY, [paid("e1", "2026-09-10", 1100, 1000)])[0];
  assert.equal(ev.status, "realized");
  assert.equal(ev.dueStatus, "paid");
  assert.equal(ev.paidAmount, 1100);
  assert.equal(ev.expectedAmount, 1000);
  assert.equal(ev.amount, 1100);
  const legacy = collectExpenseEvents([e], month("09"), TODAY, [paid("e1", "2026-09-10", 1100)])[0];
  assert.equal(legacy.expectedAmount, null);
  assert.equal(legacy.paidAmount, 1100);
});

test("status nos limites: ontem, hoje, +7, +8 e fuso", () => {
  const ds = (date) => dueStatus({ paid: false, date, today: TODAY });
  assert.equal(DUE_SOON_DAYS, 7);
  assert.equal(ds("2026-10-14"), "overdue"); // ontem
  assert.equal(ds("2026-10-15"), "due_soon"); // hoje
  assert.equal(ds("2026-10-22"), "due_soon"); // +7 (inclusive)
  assert.equal(ds("2026-10-23"), "planned"); // +8
  assert.equal(dueStatus({ paid: true, date: "2020-01-01", today: TODAY }), "paid");
  // virada de mês/ano
  assert.equal(dueStatus({ date: "2027-01-03", today: "2026-12-27" }), "due_soon");
  assert.equal(dueStatus({ date: "2027-01-04", today: "2026-12-27" }), "planned");
  // fuso: 02:59 UTC de 03/10 ainda é 02/10 em São Paulo (UTC-3); 03:00 UTC já é 03/10
  assert.equal(saoPauloToday(new Date("2026-10-03T02:59:00Z")), "2026-10-02");
  assert.equal(saoPauloToday(new Date("2026-10-03T03:00:00Z")), "2026-10-03");
  assert.equal(dueStatus({ date: "2026-10-02", today: saoPauloToday(new Date("2026-10-03T02:59:00Z")) }), "due_soon");
  assert.equal(dueStatus({ date: "2026-10-02", today: saoPauloToday(new Date("2026-10-03T03:00:00Z")) }), "overdue");
});

test("vencimento reagendado define o status", () => {
  const e = exp({ amountMode: "fixed", expenseDate: "2026-10-01", isRecurring: false });
  const resched = [{ expenseId: "e1", occurrenceDate: "2026-10-01", status: "pending", rescheduledTo: "2026-10-20" }];
  assert.equal(collectExpenseEvents([e], month("10"), TODAY, resched)[0].dueStatus, "due_soon");
  assert.equal(collectExpenseEvents([e], month("10"), TODAY, [])[0].dueStatus, "overdue");
});

test("pagamento com valor diferente do previsto: realizado usa o pago e o previsto fica registrado", () => {
  const e = exp({ id: "v", amount: 300, isRecurring: false, expenseDate: "2026-10-05", amountMode: "variable" });
  const ov = [paid("v", "2026-10-05", 345.5, 300, "2026-10-12")];
  const ev = collectExpenseEvents([e], month("10"), TODAY, ov)[0];
  assert.equal(ev.amount, 345.5);
  assert.equal(ev.expectedAmount, 300);
  assert.equal(ev.date, "2026-10-12");
  const panel = buildExpensePanel({ expenses: [e], overrides: ov, today: TODAY });
  assert.equal(panel.totalPaid.amount, 345.5);
  assert.equal(panel.totalPaid.expected, 300);
});

test("despesa antiga sem data: fica fora das contas, aparece em undated, nada quebra", () => {
  const noDate = { id: "x", description: "Antiga", amount: 50, expenseDate: "", isRecurring: false };
  const panel = buildExpensePanel({ expenses: [noDate, exp({ amountMode: "fixed", expenseDate: "2026-10-16", isRecurring: false })], overrides: [], today: TODAY });
  assert.deepEqual(panel.undated, [{ id: "x", description: "Antiga", amount: 50 }]);
  assert.equal(panel.totalToPay.count, 1);
  assert.doesNotThrow(() => computeHealth({ expenses: [noDate], overrides: [], today: TODAY }));
});

test("painel: vencidas, vencem esta semana, total a pagar, total pago e ordem dos próximos compromissos", () => {
  const one = (id, description, amount, expenseDate) => exp({ id, description, amountMode: "fixed", amount, expenseDate, isRecurring: false });
  const E = [
    one("a", "Aluguel", 1000, "2026-10-05"), // vencida (10 dias)
    one("b", "Internet", 200, "2026-10-02"), // vencida (13 dias, mais antiga)
    one("c", "Água", 80, "2026-10-18"), // a vencer
    one("d", "Contador", 500, "2026-10-22"), // +7 a vencer
    one("e", "Sistema", 150, "2026-10-28"), // prevista (no mês)
    one("f", "Seguro", 999, "2026-11-20"), // prevista fora do período
    one("g", "Luz", 300, "2026-10-03") // paga
  ];
  const ov = [paid("g", "2026-10-03", 320, 300, "2026-10-04")];
  const p = buildExpensePanel({ expenses: E, overrides: ov, today: TODAY });
  assert.deepEqual(p.overdue, { count: 2, amount: 1200 });
  assert.equal(p.dueThisWeek.count, 2);
  assert.equal(p.dueThisWeek.amount, 580);
  assert.equal(p.dueThisWeek.to, "2026-10-22");
  assert.deepEqual(p.planned, { count: 1, amount: 150 });
  assert.deepEqual(p.totalToPay, { count: 5, amount: 1930 });
  assert.equal(p.totalPaid.amount, 320);
  assert.deepEqual(p.upcoming.map((x) => x.description), ["Internet", "Aluguel", "Água", "Contador", "Sistema"]);
  assert.deepEqual(p.upcoming.map((x) => x.status), ["overdue", "overdue", "due_soon", "due_soon", "planned"]);
  assert.equal(p.upcoming[0].daysOverdue, 13);
  assert.equal(p.upcoming[2].daysToDue, 3);
  assert.equal(buildExpensePanel({ expenses: E, overrides: ov, today: TODAY, limit: 2 }).upcoming.length, 2);
});

test("vencida de mês anterior entra em vencidas e no total a pagar mesmo fora do período", () => {
  const e = exp({ amountMode: "fixed", amount: 400, expenseDate: "2026-08-10", isRecurring: false });
  const p = buildExpensePanel({ expenses: [e], overrides: [], today: TODAY });
  assert.deepEqual(p.overdue, { count: 1, amount: 400 });
  assert.equal(p.totalToPay.amount, 400);
});

test("série variável alimenta o painel com a referência do último pago", () => {
  const ov = [paid("e1", "2026-07-10", 300, 300), paid("e1", "2026-08-10", 320, 300), paid("e1", "2026-09-10", 350, 320)];
  const p = buildExpensePanel({ expenses: [exp()], overrides: ov, today: "2026-10-05" });
  assert.equal(p.dueThisWeek.amount, 350); // 10/10 (+5 dias), previsto = 350
  assert.equal(p.upcoming[0].expectedAmount, 350);
});

test("mudar o modo de valor de uma recorrente conta como alteração material (só dali para frente)", () => {
  const cur = exp({ amountMode: "fixed" });
  const plan = planRecurringSplit(cur, { amountMode: "variable" }, "2026-10-15");
  assert.equal(plan.mode, "split");
  assert.equal(plan.newRow.amountMode, "variable");
  assert.equal(planRecurringSplit(cur, { amountMode: "fixed" }, "2026-10-15").mode, "none");
});

test("computeHealth: variável vencida entra como prevista com o valor de referência (nunca como realizada)", () => {
  const ov = [paid("e1", "2026-07-10", 300, 300), paid("e1", "2026-08-10", 320, 300), paid("e1", "2026-09-10", 350, 320)];
  const h = computeHealth({ sales: [], expenses: [exp()], overrides: ov, today: TODAY, period: "month" });
  assert.equal(h.expectation.operatingOverdue, 350);
  assert.equal(h.summary.expenses, 0); // a paga de setembro não está no período corrente
});

test("migration: nome de 14 dígitos, aditiva e idempotente, sem apagar nem reescrever dado", () => {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const name = fs.readdirSync(dir).find((f) => f.includes("financial_variable_expenses"));
  assert.match(name, /^\d{14}_financial_variable_expenses\.sql$/);
  const sql = fs.readFileSync(new URL(name, dir), "utf8").toLowerCase();
  assert.match(sql, /add column if not exists amount_mode text not null default 'fixed'/);
  assert.match(sql, /add column if not exists expected_amount/);
  assert.equal((sql.match(/add constraint/g) || []).length, (sql.match(/drop constraint if exists/g) || []).length);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /drop table|drop column|delete from|truncate|update\s+public/);
});
