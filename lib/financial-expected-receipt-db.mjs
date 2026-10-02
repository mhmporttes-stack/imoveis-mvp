// Operações com banco da PREVISÃO DE RECEBIMENTO (atividade na Agenda, confirmação, reagendamento,
// reconciliação). Sem "server-only" e com o acesso a dados INJETADO (`ctx`) para ser testável com um
// banco falso (tests/financial-expected-receipt.test.mjs). A fiação real fica em lib/financial.js.
//
// ctx = {
//   db,                         cliente estilo Supabase (service role)
//   getSale(id),                venda completa (clientId/clientName/propertyName/expectedReceiptDate/
//                               financialStatus/payments/totals.freeCommission/updatedByEmail) ou null
//   getToday(),                 "YYYY-MM-DD" de hoje em America/Sao_Paulo
//   resolveResponsible(sale),   id do perfil dono da atividade quando não há ator (cron) — ou ""
// }
//
// Garantias (o banco reforça com índices únicos — ver a migration 20261002130000):
//   • no máximo UMA atividade "Confirmar recebimento" aberta por venda;
//   • no máximo UM pagamento por atividade confirmada.
import {
  EXPECTED_RECEIPT_ACTIVITY_TYPE,
  buildActivityTexts,
  computeForecastAmount,
  isValidDateKey,
  planActivitySync,
  planConfirmation,
  toCents
} from "./financial-expected-receipt-core.mjs";

const UNIQUE_VIOLATION = "23505";

function forecastOf(sale) {
  return computeForecastAmount({
    freeCommission: sale.totals?.freeCommission ?? 0,
    financialStatus: sale.financialStatus,
    payments: sale.payments
  });
}

async function findOpenActivity(db, saleId) {
  const { data, error } = await db.from("calendar_activities").select("*").eq("financial_sale_id", saleId).eq("status", "pending").maybeSingle();
  if (error) throw error;
  return data || null;
}

// Garante que a atividade da venda esteja de acordo com a previsão atual (cria / reagenda a MESMA /
// conclui / remove). Idempotente: rodar de novo sem mudança não escreve nada.
export async function syncExpectedReceiptActivity(ctx, saleId, { actorProfileId = "", actorUserId = null } = {}) {
  const { db } = ctx;
  const sale = await ctx.getSale(saleId);
  if (!sale) return { action: "none" };

  const forecastAmount = forecastOf(sale);
  const texts = buildActivityTexts({ clientName: sale.clientName, propertyName: sale.propertyName, amount: forecastAmount, expectedDate: sale.expectedReceiptDate });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const open = await findOpenActivity(db, saleId);
    const plan = planActivitySync({
      financialStatus: sale.financialStatus,
      expectedReceiptDate: sale.expectedReceiptDate,
      forecastAmount,
      texts,
      activity: open ? { id: open.id, scheduledAt: open.scheduled_at, title: open.title, note: open.note } : null
    });
    const now = new Date().toISOString();

    if (plan.action === "none") return { action: "none", activityId: open?.id || "" };

    if (plan.action === "complete") {
      const { error } = await db.from("calendar_activities").update({ status: "completed", completed_at: now, updated_at: now }).eq("id", open.id).eq("status", "pending");
      if (error) throw error;
      return { action: "complete", activityId: open.id };
    }

    if (plan.action === "delete") {
      const { error } = await db.from("calendar_activities").delete().eq("id", open.id).eq("status", "pending");
      if (error) throw error;
      return { action: "delete", activityId: open.id };
    }

    if (plan.action === "update") {
      const patch = { title: plan.title, note: plan.note, scheduled_at: plan.scheduledAt, updated_at: now };
      // Nova data = o lembrete (push/WhatsApp/e-mail do cron) deve disparar de novo na nova data.
      if (plan.rescheduled) patch.notified_at = null;
      const { error } = await db.from("calendar_activities").update(patch).eq("id", open.id).eq("status", "pending");
      if (error) throw error;
      return { action: "update", activityId: open.id, rescheduled: plan.rescheduled };
    }

    // create
    const responsible = actorProfileId || (await ctx.resolveResponsible(sale));
    if (!responsible) return { action: "skipped", reason: "sem responsável para a atividade" };
    const { data, error } = await db.from("calendar_activities").insert({
      client_id: sale.clientId || null,
      responsible_user_id: responsible,
      title: plan.title,
      activity_type: EXPECTED_RECEIPT_ACTIVITY_TYPE,
      scheduled_at: plan.scheduledAt,
      note: plan.note,
      priority: "important",
      status: "pending",
      financial_sale_id: saleId,
      created_by: actorUserId || null
    }).select("*").single();
    if (!error) return { action: "create", activityId: data?.id || "" };
    // Execução simultânea criou a atividade primeiro (índice único parcial): relê e segue como "update".
    if (error.code !== UNIQUE_VIOLATION) throw error;
  }
  return { action: "none" };
}

// Só promove o status (pending → partial → received) a partir dos pagamentos; nunca rebaixa.
async function healStatusFromPayments(ctx, saleId) {
  const sale = await ctx.getSale(saleId);
  if (!sale || sale.financialStatus === "cancelled" || sale.financialStatus === "received") return sale;
  const receivedCents = (sale.payments || []).filter((payment) => payment.status === "received").reduce((sum, payment) => sum + toCents(payment.amount), 0);
  const freeCents = toCents(sale.totals?.freeCommission);
  const target = freeCents > 0 && receivedCents >= freeCents ? "received" : receivedCents > 0 ? "partial" : sale.financialStatus;
  if (target !== sale.financialStatus) {
    const { error } = await ctx.db.from("financial_sales").update({ financial_status: target }).eq("id", saleId);
    if (error) throw error;
    return ctx.getSale(saleId);
  }
  return sale;
}

// CONFIRMAR RECEBIMENTO — total ou parcial. Idempotente e à prova de execução simultânea:
//   1) a atividade aberta é "reivindicada" por um UPDATE condicional (status pending → completed); só quem
//      ganha cria o pagamento;
//   2) o pagamento leva confirmed_activity_id (índice único): a mesma atividade nunca gera dois pagamentos.
// Falha depois de reivindicar devolve a atividade para pendente (nada fica "concluído sem dinheiro").
export async function confirmExpectedReceipt(ctx, saleId, { amount = null, receivedDate = "", nextExpectedDate = "" } = {}, actor = {}) {
  const { db } = ctx;
  let sale = await ctx.getSale(saleId);
  if (!sale) throw new Error("Venda financeira não encontrada.");
  if (sale.financialStatus === "cancelled") throw new Error("Esta venda está cancelada.");
  if (sale.financialStatus === "received") {
    await syncExpectedReceiptActivity(ctx, saleId, actor);
    return { alreadyConfirmed: true, sale: await ctx.getSale(saleId) };
  }

  await syncExpectedReceiptActivity(ctx, saleId, actor);
  sale = await ctx.getSale(saleId);
  const open = await findOpenActivity(db, saleId);
  if (!open) {
    if (!isValidDateKey(sale.expectedReceiptDate)) throw new Error("Esta venda não tem previsão de recebimento.");
    return { alreadyConfirmed: true, sale: await healStatusFromPayments(ctx, saleId) };
  }

  const effectiveReceivedDate = isValidDateKey(receivedDate) ? String(receivedDate).trim() : ctx.getToday();
  const plan = planConfirmation({
    forecastAmount: forecastOf(sale),
    freeCommission: sale.totals?.freeCommission ?? 0,
    receivedTotal: sale.totals?.receivedTotal ?? 0,
    amount,
    nextExpectedDate
  });
  if (!plan.ok) throw new Error(plan.error);

  const now = new Date().toISOString();
  const claim = await db.from("calendar_activities").update({ status: "completed", completed_at: now, updated_at: now }).eq("id", open.id).eq("status", "pending").select("id");
  if (claim.error) throw claim.error;
  if (!claim.data || claim.data.length === 0) {
    return { alreadyConfirmed: true, sale: await healStatusFromPayments(ctx, saleId) };
  }

  const installment = (sale.payments || []).reduce((max, payment) => Math.max(max, Number(payment.installmentNumber) || 0), 0) + 1;
  const payment = await db.from("financial_payments").insert({
    sale_id: saleId,
    installment_number: installment,
    amount: plan.paymentAmount,
    expected_date: isValidDateKey(sale.expectedReceiptDate) ? sale.expectedReceiptDate : null,
    received_date: effectiveReceivedDate,
    status: "received",
    note: `Recebimento confirmado${isValidDateKey(sale.expectedReceiptDate) ? ` (previsão de ${sale.expectedReceiptDate.split("-").reverse().join("/")})` : ""}.`,
    confirmed_activity_id: open.id
  });
  if (payment.error) {
    if (payment.error.code === UNIQUE_VIOLATION) return { alreadyConfirmed: true, sale: await healStatusFromPayments(ctx, saleId) };
    await db.from("calendar_activities").update({ status: "pending", completed_at: null, updated_at: new Date().toISOString() }).eq("id", open.id).eq("status", "completed");
    throw payment.error;
  }

  const { error: saleError } = await db.from("financial_sales").update({
    financial_status: plan.status,
    expected_receipt_date: plan.nextExpectedDate,
    updated_by_email: actor.adminEmail || sale.updatedByEmail || ""
  }).eq("id", saleId);
  if (saleError) throw saleError;

  // Recebimento parcial com nova previsão → cria a atividade do saldo restante; total → nada a criar.
  await syncExpectedReceiptActivity(ctx, saleId, actor);
  return { alreadyConfirmed: false, remaining: plan.remaining, status: plan.status, sale: await ctx.getSale(saleId) };
}

// REAGENDAR — só muda a data da previsão; a venda continua pendente/parcial e o valor segue "a receber".
// A MESMA atividade é movida (sync "update"), sem duplicar.
export async function rescheduleExpectedReceipt(ctx, saleId, expectedDate, actor = {}) {
  const sale = await ctx.getSale(saleId);
  if (!sale) throw new Error("Venda financeira não encontrada.");
  if (sale.financialStatus === "received" || sale.financialStatus === "cancelled") {
    throw new Error("Esta venda já está recebida ou cancelada: não há previsão para reagendar.");
  }
  if (!isValidDateKey(expectedDate)) throw new Error("Informe uma data de previsão válida.");
  if (!(forecastOf(sale) > 0)) throw new Error("Não há saldo a receber nesta venda.");

  const { error } = await ctx.db.from("financial_sales").update({ expected_receipt_date: String(expectedDate).trim(), updated_by_email: actor.adminEmail || sale.updatedByEmail || "" }).eq("id", saleId);
  if (error) throw error;
  await syncExpectedReceiptActivity(ctx, saleId, actor);
  return { sale: await ctx.getSale(saleId) };
}

// Rede de segurança (cron scheduled-activities): não depende de ninguém abrir o Financeiro.
//   • venda pendente/parcial com previsão e sem atividade aberta → cria;
//   • atividade aberta de venda recebida/cancelada/sem previsão → conclui/remove.
export async function reconcileExpectedReceiptActivities(ctx, { limit = 200 } = {}) {
  const { db } = ctx;
  const sales = await db.from("financial_sales").select("id, financial_status, expected_receipt_date");
  if (sales.error) throw sales.error;
  const activities = await db.from("calendar_activities").select("id, financial_sale_id").eq("status", "pending").not("financial_sale_id", "is", null);
  if (activities.error) throw activities.error;

  const ids = new Set();
  for (const sale of sales.data || []) {
    if (sale.expected_receipt_date && (sale.financial_status === "pending" || sale.financial_status === "partial")) ids.add(sale.id);
  }
  for (const activity of activities.data || []) ids.add(activity.financial_sale_id);

  const summary = { checked: 0, create: 0, update: 0, complete: 0, delete: 0, skipped: 0 };
  for (const id of Array.from(ids).slice(0, limit)) {
    summary.checked += 1;
    const result = await syncExpectedReceiptActivity(ctx, id);
    if (summary[result.action] !== undefined) summary[result.action] += 1;
  }
  return summary;
}
