import test from "node:test";
import assert from "node:assert/strict";
import {
  applyExpectedReceiptVisibility,
  buildActivityTexts,
  buildForecastEntry,
  calculateReceivableMetrics,
  computeForecastAmount,
  flattenReceivableEntries,
  planActivitySync,
  planConfirmation,
  scheduledAtForDate
} from "../lib/financial-expected-receipt-core.mjs";
import {
  confirmExpectedReceipt,
  reconcileExpectedReceiptActivities,
  rescheduleExpectedReceipt,
  syncExpectedReceiptActivity
} from "../lib/financial-expected-receipt-db.mjs";
import { computeReceiptRepair } from "../lib/financial-receipt-repair-core.mjs";

// ---------- banco falso (imita os índices únicos parciais da migration) ----------

function createFakeDb(seed = {}) {
  const tables = { financial_sales: [], financial_payments: [], calendar_activities: [], ...seed };
  let counter = 0;
  const violates = (table, row, ignoreId = null) => {
    const rows = tables[table].filter((item) => item.id !== ignoreId);
    if (table === "calendar_activities" && row.financial_sale_id && row.status === "pending") {
      return rows.some((item) => item.financial_sale_id === row.financial_sale_id && item.status === "pending");
    }
    if (table === "financial_payments" && row.confirmed_activity_id) {
      return rows.some((item) => item.confirmed_activity_id === row.confirmed_activity_id);
    }
    return false;
  };
  const dup = { code: "23505", message: "duplicate key value violates unique constraint" };

  function builder(table) {
    const state = { op: "select", payload: null, filters: [], wantRows: false };
    const matches = (row) => state.filters.every((filter) => filter(row));
    const api = {
      select() { state.wantRows = true; return api; },
      insert(payload) { state.op = "insert"; state.payload = payload; return api; },
      update(payload) { state.op = "update"; state.payload = payload; return api; },
      delete() { state.op = "delete"; return api; },
      eq(column, value) { state.filters.push((row) => row[column] === value); return api; },
      not(column, operator, value) { state.filters.push((row) => !(operator === "is" && value === null ? row[column] === null || row[column] === undefined : false)); return api; },
      order() { return api; },
      maybeSingle: () => run(true),
      single: () => run(true),
      then: (resolve, reject) => run(false).then(resolve, reject)
    };
    async function run(single) {
      await Promise.resolve();
      if (state.op === "insert") {
        const rows = Array.isArray(state.payload) ? state.payload : [state.payload];
        const inserted = [];
        for (const row of rows) {
          const record = { id: `${table}-${++counter}`, notified_at: null, ...row };
          if (violates(table, record)) return { data: null, error: dup };
          tables[table].push(record);
          inserted.push(record);
        }
        return { data: single ? inserted[0] : state.wantRows ? inserted : null, error: null };
      }
      if (state.op === "update") {
        const targets = tables[table].filter(matches);
        for (const row of targets) {
          const next = { ...row, ...state.payload };
          if (violates(table, next, row.id)) return { data: null, error: dup };
          Object.assign(row, state.payload);
        }
        return { data: state.wantRows ? targets.map((row) => ({ ...row })) : null, error: null };
      }
      if (state.op === "delete") {
        tables[table] = tables[table].filter((row) => !matches(row));
        return { data: null, error: null };
      }
      const rows = tables[table].filter(matches).map((row) => ({ ...row }));
      return { data: single ? rows[0] || null : rows, error: null };
    }
    return api;
  }
  return { tables, from: (table) => builder(table) };
}

function buildCtx(db, { today = "2026-10-15" } = {}) {
  return {
    db,
    getToday: () => today,
    resolveResponsible: () => "admin-1",
    getSale: async (id) => {
      const row = db.tables.financial_sales.find((sale) => sale.id === id);
      if (!row) return null;
      const payments = db.tables.financial_payments
        .filter((payment) => payment.sale_id === id)
        .map((payment) => ({ id: payment.id, installmentNumber: payment.installment_number, amount: Number(payment.amount), expectedDate: payment.expected_date || "", receivedDate: payment.received_date || "", status: payment.status }));
      const received = payments.filter((payment) => payment.status === "received").reduce((sum, payment) => sum + payment.amount, 0);
      const free = Number(row.gross_commission) - (row.invoice_issued ? Number(row.gross_commission) * 0.15 : 0);
      return {
        id: row.id,
        clientId: row.client_id,
        clientName: row.client_name,
        propertyName: row.property_name,
        expectedReceiptDate: row.expected_receipt_date || "",
        financialStatus: row.financial_status,
        updatedByEmail: row.updated_by_email || "",
        payments,
        totals: { grossCommission: Number(row.gross_commission), freeCommission: free, receivedTotal: received }
      };
    }
  };
}

const gustavo = (extra = {}) => ({ id: "sale-gustavo", client_id: "client-1", client_name: "Gustavo de Oliveira Oseki", property_name: "Gaudí", gross_commission: 9000, invoice_issued: false, financial_status: "pending", expected_receipt_date: "2026-10-15", ...extra });
const pendingActivities = (db) => db.tables.calendar_activities.filter((activity) => activity.status === "pending");
const paymentsOf = (db, saleId) => db.tables.financial_payments.filter((payment) => payment.sale_id === saleId);
const actor = { actorProfileId: "admin-1", actorUserId: "user-1", adminEmail: "admin@x.com" };

// ---------- visibilidade: só o dono ----------

test("previsão é só do dono: não-dono não recebe a data; dono e chamada interna mantêm", () => {
  const sale = { id: "s1", expectedReceiptDate: "2026-10-15", clientName: "G", financialStatus: "pending", payments: [] };
  assert.equal(applyExpectedReceiptVisibility(sale, false).expectedReceiptDate, "");
  assert.equal(applyExpectedReceiptVisibility(sale, true).expectedReceiptDate, "2026-10-15");
  assert.equal(applyExpectedReceiptVisibility(sale, null).expectedReceiptDate, "2026-10-15");
  assert.equal(applyExpectedReceiptVisibility(null, false), null);
  assert.equal(sale.expectedReceiptDate, "2026-10-15"); // não muta o original
  // sem data visível, nada entra nos indicadores do não-dono
  const hidden = applyExpectedReceiptVisibility(sale, false);
  assert.deepEqual(flattenReceivableEntries([hidden], () => 9000), []);
});

// ---------- previsão e indicadores ----------

test("previsão: saldo = comissão BRUTA − recebido − parcelas já datadas; venda recebida/cancelada = 0", () => {
  assert.equal(computeForecastAmount({ grossCommission: 9000, financialStatus: "pending", payments: [] }), 9000);
  assert.equal(computeForecastAmount({ grossCommission: 9000, financialStatus: "partial", payments: [{ status: "received", amount: 5000 }] }), 4000);
  assert.equal(computeForecastAmount({ grossCommission: 9000, financialStatus: "pending", payments: [{ status: "expected", amount: 3000, expectedDate: "2026-11-01" }] }), 6000);
  // parcela sem data não é contada em nenhum indicador, então não abate o saldo previsto
  assert.equal(computeForecastAmount({ grossCommission: 9000, financialStatus: "pending", payments: [{ status: "expected", amount: 3000, expectedDate: "" }] }), 9000);
  assert.equal(computeForecastAmount({ grossCommission: 9000, financialStatus: "received", payments: [] }), 0);
  assert.equal(computeForecastAmount({ grossCommission: 9000, financialStatus: "cancelled", payments: [] }), 0);
  assert.equal(computeForecastAmount({ grossCommission: 9000, financialStatus: "pending", payments: [{ status: "received", amount: 9500 }] }), 0);
});

test("venda pendente SEM previsão continua como hoje: nenhuma entrada nova", () => {
  const sale = { id: "s1", clientName: "A", financialStatus: "pending", payments: [], expectedReceiptDate: "" };
  assert.equal(buildForecastEntry(sale, 9000), null);
  assert.deepEqual(flattenReceivableEntries([sale], () => 9000), []);
});

test("venda pendente COM previsão entra em 'a receber' do mês correto e nunca em 'recebido'", () => {
  const sale = { id: "s1", clientName: "Gustavo", propertyName: "Gaudí", financialStatus: "pending", payments: [], expectedReceiptDate: "2026-10-15" };
  const entries = flattenReceivableEntries([sale], () => 9000);
  const metrics = calculateReceivableMetrics(entries, new Date(2026, 9, 2));
  assert.equal(metrics.expectedThisMonth, 9000);
  assert.equal(metrics.receivedThisMonth, 0);
  assert.equal(entries[0].isForecast, true);
  assert.equal(entries[0].amount, 9000);
});

test("alterar a previsão de outubro para novembro tira o valor de outubro e leva para novembro", () => {
  const base = { id: "s1", clientName: "G", financialStatus: "pending", payments: [] };
  const october = calculateReceivableMetrics(flattenReceivableEntries([{ ...base, expectedReceiptDate: "2026-10-30" }], () => 9000), new Date(2026, 9, 2));
  const november = calculateReceivableMetrics(flattenReceivableEntries([{ ...base, expectedReceiptDate: "2026-11-05" }], () => 9000), new Date(2026, 9, 2));
  assert.equal(october.expectedThisMonth, 9000);
  assert.equal(november.expectedThisMonth, 0);
  assert.equal(november.next30, 0); // 02/10 + 30 dias = 01/11 → 05/11 só entra na janela de 60 dias
  assert.equal(november.next60, 9000);
  assert.equal(november.next90, 9000);
});

test("janelas 30/60/90 dias usam previsões futuras pendentes e não contam o já recebido", () => {
  const now = new Date(2026, 9, 2);
  const sales = [
    { id: "a", clientName: "A", financialStatus: "pending", payments: [], expectedReceiptDate: "2026-10-20" }, // +18d
    { id: "b", clientName: "B", financialStatus: "pending", payments: [], expectedReceiptDate: "2026-11-25" }, // +54d
    { id: "c", clientName: "C", financialStatus: "pending", payments: [], expectedReceiptDate: "2026-12-20" }, // +79d
    { id: "d", clientName: "D", financialStatus: "received", payments: [{ status: "received", amount: 5000, receivedDate: "2026-10-01" }], expectedReceiptDate: "2026-10-10" } // recebida: ignora
  ];
  const metrics = calculateReceivableMetrics(flattenReceivableEntries(sales, () => 1000), now);
  assert.equal(metrics.next30, 1000);
  assert.equal(metrics.next60, 2000);
  assert.equal(metrics.next90, 3000);
  assert.equal(metrics.receivedThisMonth, 5000);
  assert.equal(metrics.expectedThisMonth, 1000);
});

test("previsão vencida e não confirmada continua visível e NÃO vira recebida", () => {
  const sale = { id: "s1", clientName: "G", financialStatus: "pending", payments: [], expectedReceiptDate: "2026-09-15" };
  const entries = flattenReceivableEntries([sale], () => 9000);
  const metrics = calculateReceivableMetrics(entries, new Date(2026, 9, 2));
  assert.equal(metrics.overdueBeforeMonth, 9000);
  assert.equal(metrics.receivedThisMonth, 0);
  assert.equal(entries[0].status, "expected");
  assert.equal(planActivitySync({ financialStatus: "pending", expectedReceiptDate: "2026-09-15", forecastAmount: 9000, texts: { title: "t", note: "n" }, activity: { scheduledAt: scheduledAtForDate("2026-09-15"), title: "t", note: "n" } }).action, "none");
});

test("parcela cancelada não conta como 'a receber'", () => {
  const sale = { id: "s", clientName: "A", financialStatus: "pending", expectedReceiptDate: "", payments: [{ id: "p", status: "cancelled", amount: 700, expectedDate: "2026-10-10" }] };
  assert.equal(calculateReceivableMetrics(flattenReceivableEntries([sale], () => 0), new Date(2026, 9, 2)).expectedThisMonth, 0);
});

// ---------- plano da atividade ----------

test("plano da atividade: cria, mantém (idempotente), reagenda a mesma, conclui se recebida, remove se cancelada/sem previsão", () => {
  const texts = buildActivityTexts({ clientName: "Gustavo", propertyName: "Gaudí", amount: 9000, expectedDate: "2026-10-15" });
  assert.match(texts.title, /Confirmar recebimento — Gustavo/);
  assert.match(texts.note, /R\$\s?9\.000,00 · Gaudí · Previsão: 15\/10\/2026/);

  const input = { financialStatus: "pending", expectedReceiptDate: "2026-10-15", forecastAmount: 9000, texts };
  assert.equal(planActivitySync({ ...input, activity: null }).action, "create");
  const existing = { id: "x", scheduledAt: scheduledAtForDate("2026-10-15"), title: texts.title, note: texts.note };
  assert.equal(planActivitySync({ ...input, activity: existing }).action, "none");

  const moved = buildActivityTexts({ clientName: "Gustavo", propertyName: "Gaudí", amount: 9000, expectedDate: "2026-10-25" });
  const update = planActivitySync({ ...input, expectedReceiptDate: "2026-10-25", texts: moved, activity: existing });
  assert.equal(update.action, "update");
  assert.equal(update.rescheduled, true);

  assert.equal(planActivitySync({ ...input, financialStatus: "received", activity: existing }).action, "complete");
  assert.equal(planActivitySync({ ...input, financialStatus: "cancelled", activity: existing }).action, "delete");
  assert.equal(planActivitySync({ ...input, expectedReceiptDate: "", activity: existing }).action, "delete");
  assert.equal(planActivitySync({ ...input, forecastAmount: 0, activity: existing }).action, "delete");
  assert.equal(planActivitySync({ ...input, financialStatus: "received", activity: null }).action, "none");
});

test("plano de confirmação: integral, parcial, valor inválido e teto no saldo previsto", () => {
  const full = planConfirmation({ forecastAmount: 9000, grossCommission: 9000, receivedTotal: 0 });
  assert.deepEqual([full.ok, full.paymentAmount, full.status, full.nextExpectedDate, full.remaining], [true, 9000, "received", null, 0]);

  const partial = planConfirmation({ forecastAmount: 9000, grossCommission: 9000, receivedTotal: 0, amount: 5000, nextExpectedDate: "2026-11-10" });
  assert.deepEqual([partial.status, partial.remaining, partial.nextExpectedDate, partial.receivedAfter], ["partial", 4000, "2026-11-10", 5000]);

  const partialNoDate = planConfirmation({ forecastAmount: 9000, grossCommission: 9000, receivedTotal: 0, amount: 5000 });
  assert.equal(partialNoDate.nextExpectedDate, null);

  assert.equal(planConfirmation({ forecastAmount: 9000, grossCommission: 9000, receivedTotal: 0, amount: 9000.01 }).ok, false);
  assert.equal(planConfirmation({ forecastAmount: 9000, grossCommission: 9000, receivedTotal: 0, amount: 0 }).ok, false);
  assert.equal(planConfirmation({ forecastAmount: 0, grossCommission: 9000, receivedTotal: 9000 }).ok, false);
  // recebimento total ignora nova previsão
  assert.equal(planConfirmation({ forecastAmount: 9000, grossCommission: 9000, receivedTotal: 0, amount: 9000, nextExpectedDate: "2026-11-10" }).nextExpectedDate, null);
});

// ---------- fluxo com banco: criação, reagendamento, confirmação, idempotência ----------

test("criar previsão cria UMA atividade vinculada à venda; repetir não duplica", async () => {
  const db = createFakeDb({ financial_sales: [gustavo()] });
  const ctx = buildCtx(db);
  assert.equal((await syncExpectedReceiptActivity(ctx, "sale-gustavo", actor)).action, "create");
  assert.equal((await syncExpectedReceiptActivity(ctx, "sale-gustavo", actor)).action, "none");
  assert.equal((await syncExpectedReceiptActivity(ctx, "sale-gustavo", actor)).action, "none");
  const [activity] = pendingActivities(db);
  assert.equal(pendingActivities(db).length, 1);
  assert.equal(activity.financial_sale_id, "sale-gustavo");
  assert.equal(activity.activity_type, "recebimento");
  assert.equal(activity.responsible_user_id, "admin-1");
  assert.equal(activity.scheduled_at, scheduledAtForDate("2026-10-15"));
});

test("venda sem previsão não cria atividade", async () => {
  const db = createFakeDb({ financial_sales: [gustavo({ expected_receipt_date: null })] });
  assert.equal((await syncExpectedReceiptActivity(buildCtx(db), "sale-gustavo", actor)).action, "none");
  assert.equal(db.tables.calendar_activities.length, 0);
});

test("duas sincronizações simultâneas não criam atividade duplicada (índice único)", async () => {
  const db = createFakeDb({ financial_sales: [gustavo()] });
  const ctx = buildCtx(db);
  await Promise.all([syncExpectedReceiptActivity(ctx, "sale-gustavo", actor), syncExpectedReceiptActivity(ctx, "sale-gustavo", actor), syncExpectedReceiptActivity(ctx, "sale-gustavo", actor)]);
  assert.equal(pendingActivities(db).length, 1);
});

test("reagendar 15/10 → 25/10 move a MESMA atividade, mantém pendente e não duplica", async () => {
  const db = createFakeDb({ financial_sales: [gustavo()] });
  const ctx = buildCtx(db);
  await syncExpectedReceiptActivity(ctx, "sale-gustavo", actor);
  const originalId = pendingActivities(db)[0].id;
  db.tables.calendar_activities[0].notified_at = "2026-10-15T12:00:00Z";

  const result = await rescheduleExpectedReceipt(ctx, "sale-gustavo", "2026-10-25", actor);
  assert.equal(pendingActivities(db).length, 1);
  assert.equal(pendingActivities(db)[0].id, originalId);
  assert.equal(pendingActivities(db)[0].scheduled_at, scheduledAtForDate("2026-10-25"));
  assert.equal(pendingActivities(db)[0].notified_at, null);
  assert.match(pendingActivities(db)[0].note, /25\/10\/2026/);
  assert.equal(result.sale.financialStatus, "pending");
  assert.equal(result.sale.expectedReceiptDate, "2026-10-25");
  assert.equal(paymentsOf(db, "sale-gustavo").length, 0);

  // mês diferente: sai de outubro e vai para novembro nos indicadores
  await rescheduleExpectedReceipt(ctx, "sale-gustavo", "2026-11-05", actor);
  assert.equal(pendingActivities(db).length, 1);
  assert.equal(pendingActivities(db)[0].id, originalId);
  assert.equal(db.tables.financial_sales[0].expected_receipt_date, "2026-11-05");
});

test("reagendar recusa data inválida e venda já recebida/cancelada", async () => {
  const db = createFakeDb({ financial_sales: [gustavo(), gustavo({ id: "s-rec", financial_status: "received" }), gustavo({ id: "s-can", financial_status: "cancelled" })] });
  const ctx = buildCtx(db);
  await assert.rejects(() => rescheduleExpectedReceipt(ctx, "sale-gustavo", "31/12/2026", actor), /data de previsão válida/);
  await assert.rejects(() => rescheduleExpectedReceipt(ctx, "s-rec", "2026-11-05", actor), /já está recebida/);
  await assert.rejects(() => rescheduleExpectedReceipt(ctx, "s-can", "2026-11-05", actor), /já está recebida ou cancelada/);
});

test("confirmação INTEGRAL: 1 pagamento, venda recebida, atividade concluída, previsão encerrada", async () => {
  const db = createFakeDb({ financial_sales: [gustavo()] });
  const ctx = buildCtx(db);
  await syncExpectedReceiptActivity(ctx, "sale-gustavo", actor);
  const activityId = pendingActivities(db)[0].id;

  const result = await confirmExpectedReceipt(ctx, "sale-gustavo", {}, actor);
  assert.equal(result.alreadyConfirmed, false);
  const payments = paymentsOf(db, "sale-gustavo");
  assert.equal(payments.length, 1);
  assert.equal(payments[0].amount, 9000);
  assert.equal(payments[0].status, "received");
  assert.equal(payments[0].received_date, "2026-10-15");
  assert.equal(payments[0].confirmed_activity_id, activityId);
  assert.equal(db.tables.financial_sales[0].financial_status, "received");
  assert.equal(db.tables.financial_sales[0].expected_receipt_date, null);
  assert.equal(pendingActivities(db).length, 0);
  assert.equal(db.tables.calendar_activities.find((activity) => activity.id === activityId).status, "completed");
  assert.equal(result.sale.totals.receivedTotal, 9000);
  const metrics = calculateReceivableMetrics(flattenReceivableEntries([result.sale], (sale) => sale.totals.grossCommission), new Date(2026, 9, 15));
  assert.equal(metrics.expectedThisMonth, 0);
  assert.equal(metrics.receivedThisMonth, 9000);
});

test("confirmação aceita data real informada, diferente da data da confirmação", async () => {
  const db = createFakeDb({ financial_sales: [gustavo()] });
  await confirmExpectedReceipt(buildCtx(db), "sale-gustavo", { receivedDate: "2026-10-13" }, actor);
  assert.equal(paymentsOf(db, "sale-gustavo")[0].received_date, "2026-10-13");
});

test("IDEMPOTÊNCIA: confirmar de novo (sequencial) não cria outro pagamento", async () => {
  const db = createFakeDb({ financial_sales: [gustavo()] });
  const ctx = buildCtx(db);
  await confirmExpectedReceipt(ctx, "sale-gustavo", {}, actor);
  const again = await confirmExpectedReceipt(ctx, "sale-gustavo", {}, actor);
  const third = await confirmExpectedReceipt(ctx, "sale-gustavo", { amount: 100 }, actor);
  assert.equal(again.alreadyConfirmed, true);
  assert.equal(third.alreadyConfirmed, true);
  assert.equal(paymentsOf(db, "sale-gustavo").length, 1);
  assert.equal(pendingActivities(db).length, 0);
});

test("DUPLICIDADE: duas confirmações simultâneas criam exatamente 1 pagamento", async () => {
  const db = createFakeDb({ financial_sales: [gustavo()] });
  const ctx = buildCtx(db);
  await syncExpectedReceiptActivity(ctx, "sale-gustavo", actor);
  const results = await Promise.all([
    confirmExpectedReceipt(ctx, "sale-gustavo", {}, actor),
    confirmExpectedReceipt(ctx, "sale-gustavo", {}, actor),
    confirmExpectedReceipt(ctx, "sale-gustavo", {}, actor)
  ]);
  assert.equal(results.filter((result) => !result.alreadyConfirmed).length, 1);
  assert.equal(paymentsOf(db, "sale-gustavo").length, 1);
  assert.equal(paymentsOf(db, "sale-gustavo")[0].amount, 9000);
  assert.equal(db.tables.financial_sales[0].financial_status, "received");
});

test("o banco sozinho impede dois pagamentos para a mesma atividade", async () => {
  const db = createFakeDb({ financial_sales: [gustavo()] });
  const first = await db.from("financial_payments").insert({ sale_id: "sale-gustavo", amount: 1, status: "received", confirmed_activity_id: "act-1" });
  const second = await db.from("financial_payments").insert({ sale_id: "sale-gustavo", amount: 1, status: "received", confirmed_activity_id: "act-1" });
  assert.equal(first.error, null);
  assert.equal(second.error.code, "23505");
});

test("RECEBIMENTO PARCIAL: 5.000 de 9.000 → parcial, saldo 4.000 com nova previsão e atividade só do saldo", async () => {
  const db = createFakeDb({ financial_sales: [gustavo()] });
  const ctx = buildCtx(db);
  await syncExpectedReceiptActivity(ctx, "sale-gustavo", actor);
  const firstActivityId = pendingActivities(db)[0].id;

  const result = await confirmExpectedReceipt(ctx, "sale-gustavo", { amount: 5000, nextExpectedDate: "2026-11-10" }, actor);
  assert.equal(result.status, "partial");
  assert.equal(result.remaining, 4000);
  assert.equal(paymentsOf(db, "sale-gustavo").length, 1);
  assert.equal(paymentsOf(db, "sale-gustavo")[0].amount, 5000);
  assert.equal(db.tables.financial_sales[0].financial_status, "partial");
  assert.equal(db.tables.financial_sales[0].expected_receipt_date, "2026-11-10");

  const open = pendingActivities(db);
  assert.equal(open.length, 1);
  assert.notEqual(open[0].id, firstActivityId);
  assert.equal(open[0].scheduled_at, scheduledAtForDate("2026-11-10"));
  assert.match(open[0].note, /R\$\s?4\.000,00/);

  // dashboard: 5.000 recebidos + 4.000 previstos — os 9.000 não são contados de novo
  const entries = flattenReceivableEntries([result.sale], (sale) => sale.totals.grossCommission);
  const metrics = calculateReceivableMetrics(entries, new Date(2026, 9, 15));
  assert.equal(metrics.receivedThisMonth, 5000);
  assert.equal(metrics.expectedThisMonth, 0);
  assert.equal(metrics.next30, 4000);

  // fechar o saldo restante: 2º pagamento (outra atividade) e venda recebida
  const final = await confirmExpectedReceipt(ctx, "sale-gustavo", {}, actor);
  assert.equal(final.alreadyConfirmed, false);
  assert.equal(paymentsOf(db, "sale-gustavo").length, 2);
  assert.equal(paymentsOf(db, "sale-gustavo").reduce((sum, payment) => sum + payment.amount, 0), 9000);
  assert.equal(db.tables.financial_sales[0].financial_status, "received");
  assert.equal(pendingActivities(db).length, 0);
});

test("parcial sem nova previsão: saldo fica sem data e sem atividade, venda continua parcial", async () => {
  const db = createFakeDb({ financial_sales: [gustavo()] });
  const result = await confirmExpectedReceipt(buildCtx(db), "sale-gustavo", { amount: 5000 }, actor);
  assert.equal(result.status, "partial");
  assert.equal(db.tables.financial_sales[0].expected_receipt_date, null);
  assert.equal(pendingActivities(db).length, 0);
});

test("valor recebido maior que o saldo previsto é recusado e não grava nada", async () => {
  const db = createFakeDb({ financial_sales: [gustavo()] });
  const ctx = buildCtx(db);
  await assert.rejects(() => confirmExpectedReceipt(ctx, "sale-gustavo", { amount: 9500 }, actor), /maior que o saldo previsto/);
  assert.equal(paymentsOf(db, "sale-gustavo").length, 0);
  assert.equal(pendingActivities(db).length, 1); // atividade continua aberta
  assert.equal(db.tables.financial_sales[0].financial_status, "pending");
});

test("previsão vencida sem confirmação: nada é marcado como recebido; atividade segue aberta", async () => {
  const db = createFakeDb({ financial_sales: [gustavo({ expected_receipt_date: "2026-09-01" })] });
  const ctx = buildCtx(db, { today: "2026-10-20" });
  await syncExpectedReceiptActivity(ctx, "sale-gustavo", actor);
  await reconcileExpectedReceiptActivities(ctx);
  await reconcileExpectedReceiptActivities(ctx);
  assert.equal(db.tables.financial_sales[0].financial_status, "pending");
  assert.equal(paymentsOf(db, "sale-gustavo").length, 0);
  assert.equal(pendingActivities(db).length, 1);
});

test("venda já recebida não ganha expectativa nem atividade", async () => {
  const db = createFakeDb({ financial_sales: [gustavo({ financial_status: "received" })] });
  const ctx = buildCtx(db);
  assert.equal((await syncExpectedReceiptActivity(ctx, "sale-gustavo", actor)).action, "none");
  const result = await confirmExpectedReceipt(ctx, "sale-gustavo", {}, actor);
  assert.equal(result.alreadyConfirmed, true);
  assert.equal(paymentsOf(db, "sale-gustavo").length, 0);
  assert.equal(db.tables.calendar_activities.length, 0);
});

test("venda marcada recebida por outro caminho conclui a atividade aberta; cancelada remove", async () => {
  const db = createFakeDb({ financial_sales: [gustavo(), gustavo({ id: "s2", client_id: "c2" })] });
  const ctx = buildCtx(db);
  await syncExpectedReceiptActivity(ctx, "sale-gustavo", actor);
  await syncExpectedReceiptActivity(ctx, "s2", actor);
  db.tables.financial_sales[0].financial_status = "received";
  db.tables.financial_sales[1].financial_status = "cancelled";
  assert.equal((await syncExpectedReceiptActivity(ctx, "sale-gustavo", actor)).action, "complete");
  assert.equal((await syncExpectedReceiptActivity(ctx, "s2", actor)).action, "delete");
  assert.equal(pendingActivities(db).length, 0);
  assert.equal(db.tables.calendar_activities.filter((activity) => activity.status === "completed").length, 1);
});

test("reconciliação (cron) cria a atividade que faltou, é idempotente e limpa atividade de venda encerrada", async () => {
  const db = createFakeDb({ financial_sales: [gustavo(), gustavo({ id: "s-none", client_id: "c3", expected_receipt_date: null }), gustavo({ id: "s-done", client_id: "c4", financial_status: "received" })] });
  db.tables.calendar_activities.push({ id: "stale", financial_sale_id: "s-done", status: "pending", title: "t", note: "n", scheduled_at: scheduledAtForDate("2026-10-15") });
  const ctx = buildCtx(db);

  const first = await reconcileExpectedReceiptActivities(ctx);
  assert.equal(first.create, 1);
  assert.equal(first.complete, 1);
  assert.equal(pendingActivities(db).length, 1);

  const second = await reconcileExpectedReceiptActivities(ctx);
  assert.equal(second.create + second.update + second.complete + second.delete, 0);
  assert.equal(pendingActivities(db).length, 1);
});

test("alterar valor/dados da venda atualiza a mesma atividade (sem duplicar)", async () => {
  const db = createFakeDb({ financial_sales: [gustavo()] });
  const ctx = buildCtx(db);
  await syncExpectedReceiptActivity(ctx, "sale-gustavo", actor);
  const id = pendingActivities(db)[0].id;
  db.tables.financial_sales[0].gross_commission = 10000;
  assert.equal((await syncExpectedReceiptActivity(ctx, "sale-gustavo", actor)).action, "update");
  assert.equal(pendingActivities(db).length, 1);
  assert.equal(pendingActivities(db)[0].id, id);
  assert.match(pendingActivities(db)[0].note, /10\.000,00/);
});

test("sem responsável resolvido, a criação da atividade é ignorada com segurança (sem lançar erro)", async () => {
  const db = createFakeDb({ financial_sales: [gustavo()] });
  const ctx = { ...buildCtx(db), resolveResponsible: () => "" };
  const result = await syncExpectedReceiptActivity(ctx, "sale-gustavo", {});
  assert.equal(result.action, "skipped");
  assert.equal(db.tables.calendar_activities.length, 0);
});

test("preservação: reconciliar não toca vendas existentes sem previsão nem altera pagamentos", async () => {
  const db = createFakeDb({
    financial_sales: [gustavo({ id: "old", expected_receipt_date: null, financial_status: "received" }), gustavo({ id: "old2", client_id: "c2", expected_receipt_date: null })],
    financial_payments: [{ id: "pay-old", sale_id: "old", amount: 9000, status: "received", received_date: "2026-10-01", installment_number: 1 }]
  });
  const before = JSON.stringify(db.tables);
  await reconcileExpectedReceiptActivities(buildCtx(db));
  assert.equal(JSON.stringify(db.tables), before);
});

// ---------- base ÚNICA de recebimento (bruta): sem recebimento em dobro com nota/despesa ----------
// Regressão da auditoria incremental 2026-10-02: a Previsão/Confirmar recebimento usava a comissão LIVRE e o
// reparo do "Pago" a BRUTA — confirmar a previsão e depois marcar "Pago" lançava um 2º recebimento automático.

test("venda com nota (livre ≠ bruta): a previsão é a BRUTA e confirmar tudo encerra a venda sem sobra para o reparo do 'Pago'", async () => {
  const db = createFakeDb({ financial_sales: [gustavo({ invoice_issued: true })] }); // bruta 9.000, livre 7.650
  const ctx = buildCtx(db);
  await syncExpectedReceiptActivity(ctx, "sale-gustavo", actor);
  assert.match(pendingActivities(db)[0].note, /R\$\s*9\.000,00/);

  const result = await confirmExpectedReceipt(ctx, "sale-gustavo", {}, actor);
  assert.equal(result.status, "received");
  assert.equal(paymentsOf(db, "sale-gustavo").reduce((sum, payment) => sum + Number(payment.amount), 0), 9000);

  const sale = await ctx.getSale("sale-gustavo");
  const repair = computeReceiptRepair({ financialStatus: "received", grossCommission: sale.totals.grossCommission, payments: sale.payments });
  assert.equal(repair.needsRepair, false);
  assert.equal(repair.amount, 0);
});

test("recebimento parcial no valor da livre: sobra a diferença até a BRUTA e o 'Pago' completa só ela (nunca passa da bruta)", async () => {
  const db = createFakeDb({ financial_sales: [gustavo({ invoice_issued: true })] });
  const ctx = buildCtx(db);
  await syncExpectedReceiptActivity(ctx, "sale-gustavo", actor);

  const partial = await confirmExpectedReceipt(ctx, "sale-gustavo", { amount: 7650 }, actor);
  assert.equal(partial.status, "partial");
  assert.equal(partial.remaining, 1350);

  const sale = await ctx.getSale("sale-gustavo");
  const repair = computeReceiptRepair({ financialStatus: "received", grossCommission: sale.totals.grossCommission, payments: sale.payments });
  assert.deepEqual({ needsRepair: repair.needsRepair, amount: repair.amount }, { needsRepair: true, amount: 1350 });
  assert.equal(7650 + repair.amount, sale.totals.grossCommission);
});

test("invariante: qualquer sequência de confirmações + reparo do 'Pago' nunca soma mais que a comissão bruta", () => {
  const rounds = 300;
  for (let round = 0; round < rounds; round += 1) {
    const gross = 1000 + Math.round(Math.random() * 90000) / 100 * 100;
    let payments = [];
    const steps = 1 + Math.floor(Math.random() * 4);
    for (let step = 0; step < steps; step += 1) {
      const forecast = computeForecastAmount({ grossCommission: gross, financialStatus: "pending", payments });
      if (!(forecast > 0)) break;
      const amount = Math.round(forecast * Math.random() * 100) / 100 || forecast;
      const plan = planConfirmation({ forecastAmount: forecast, grossCommission: gross, receivedTotal: payments.reduce((sum, payment) => sum + payment.amount, 0), amount });
      if (!plan.ok) continue;
      payments = [...payments, { status: "received", amount: plan.paymentAmount, installmentNumber: payments.length + 1 }];
    }
    const repair = computeReceiptRepair({ financialStatus: "received", grossCommission: gross, payments });
    if (repair.needsRepair) payments = [...payments, { status: "received", amount: repair.amount, installmentNumber: payments.length + 1 }];
    const total = Math.round(payments.reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100;
    assert.ok(total <= Math.round(gross * 100) / 100, `soma ${total} > bruta ${gross}`);
    assert.equal(computeReceiptRepair({ financialStatus: "received", grossCommission: gross, payments }).needsRepair, false, "reparo é idempotente");
  }
});
