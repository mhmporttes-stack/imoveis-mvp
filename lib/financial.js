import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { getAdminDisplayName } from "./admin-users";
import { normalizePersonName } from "./name-utils";
import { canUseProfileDatabaseScope, isAssociateProfile, isGeneralAdminAuth, isManagerProfile, isOwnerAdminEmail } from "./admin-profiles";
import { getAdminProfileById } from "./admin-profiles";
import { calculateCommissionDistribution } from "./financial-calculations";
import { getTodayInSaoPaulo } from "./daily-report";
import { computeReceiptRepair, RECEIPT_REPAIR_NOTE } from "./financial-receipt-repair-core.mjs";
import { applyExpectedReceiptVisibility, computeForecastAmount, isValidDateKey } from "./financial-expected-receipt-core.mjs";
import {
  confirmExpectedReceipt as confirmExpectedReceiptCore,
  reconcileExpectedReceiptActivities as reconcileExpectedReceiptActivitiesCore,
  rescheduleExpectedReceipt as rescheduleExpectedReceiptCore,
  syncExpectedReceiptActivity as syncExpectedReceiptActivityCore
} from "./financial-expected-receipt-db.mjs";

export const FINANCIAL_STATUS = {
  PENDING: "pending",
  PARTIAL: "partial",
  RECEIVED: "received",
  CANCELLED: "cancelled"
};

export const FINANCIAL_STATUS_OPTIONS = [
  { value: FINANCIAL_STATUS.PENDING, label: "Pendente" },
  { value: FINANCIAL_STATUS.PARTIAL, label: "Parcialmente recebido" },
  { value: FINANCIAL_STATUS.RECEIVED, label: "Recebido" },
  { value: FINANCIAL_STATUS.CANCELLED, label: "Cancelado" }
];

export const PAYMENT_STATUS = {
  EXPECTED: "expected",
  RECEIVED: "received",
  OVERDUE: "overdue",
  CANCELLED: "cancelled"
};

export const PAYMENT_STATUS_OPTIONS = [
  { value: PAYMENT_STATUS.EXPECTED, label: "Previsto" },
  { value: PAYMENT_STATUS.RECEIVED, label: "Recebido" },
  { value: PAYMENT_STATUS.OVERDUE, label: "Atrasado" },
  { value: PAYMENT_STATUS.CANCELLED, label: "Cancelado" }
];

export const FINANCIAL_EXPENSE_CATEGORIES = [
  "Repasse",
  "Corretor parceiro",
  "Captador",
  "Indicador",
  "Documentação",
  "Cartório",
  "ITBI",
  "Engenharia",
  "Marketing",
  "Tráfego pago",
  "Bonificação",
  "Taxa",
  "Outros"
];

const FINANCIAL_TABLE_HINT = "A tabela financeira ainda nao existe no Supabase. Execute a migration supabase/migrations/20260820_financial_module.sql no SQL Editor do Supabase.";

export function canManageFinancial() {
  return hasSupabaseAdminConfig;
}

// rowToFinancialSale só lê full_name/phone/responsible_user_id do cliente
// (abaixo) — o join trazia simulation_registrations INTEIRA (tabela larga)
// por venda, sem limite, em toda carga do Financeiro. Achado da auditoria de
// performance 2026-10-01.
const FINANCIAL_SALE_CLIENT_SELECT = "client:simulation_registrations!inner(full_name, phone, responsible_user_id)";

export async function listFinancialSales(auth = null) {
  const supabase = getFinancialClient();
  let query = supabase
    .from("financial_sales")
    .select(`
      *,
      ${FINANCIAL_SALE_CLIENT_SELECT},
      expenses:financial_expenses(*),
      payments:financial_payments(*)
    `)
    .order("sale_date", { ascending: false })
    .order("created_at", { ascending: false });

  query = applyFinancialClientScope(query, auth);
  const { data, error } = await query;

  if (error) throw error;
  let sales = (data || []).map(rowToFinancialSale);

  // Auto-reparo (rede de segurança): venda "Recebido" sem recebimento lançado.
  // Falha aqui nunca derruba a tela do Financeiro.
  const repaired = await Promise.all(sales.map((sale) => repairReceivedSaleMissingPayments(sale).catch((repairError) => {
    console.error("Nao foi possivel reparar o recebimento da venda financeira.", repairError);
    return false;
  })));
  if (repaired.some(Boolean)) {
    const refetch = applyFinancialClientScope(supabase
      .from("financial_sales")
      .select(`
        *,
        ${FINANCIAL_SALE_CLIENT_SELECT},
        expenses:financial_expenses(*),
        payments:financial_payments(*)
      `)
      .order("sale_date", { ascending: false })
      .order("created_at", { ascending: false }), auth);
    const refreshed = await refetch;
    if (!refreshed.error) sales = (refreshed.data || []).map(rowToFinancialSale);
  }

  sales = sales.map((sale) => hideExpectedReceiptFromNonOwner(sale, auth));
  return isAssociateProfile(auth?.profile) ? sales.map(toAssociateFinancialView) : sales;
}

// Previsão de recebimento é visível/editável SÓ pelo dono (isOwnerAdminEmail). Sem auth (chamada interna
// do servidor, ex.: cron) o dado é mantido.
export function isExpectedReceiptOwner(auth) {
  return isOwnerAdminEmail(auth?.user?.email);
}

function hideExpectedReceiptFromNonOwner(sale, auth) {
  return applyExpectedReceiptVisibility(sale, auth ? isExpectedReceiptOwner(auth) : null);
}

export async function getFinancialSale(id, auth = null) {
  const supabase = getFinancialClient();
  let query = supabase
    .from("financial_sales")
    .select(`
      *,
      ${FINANCIAL_SALE_CLIENT_SELECT},
      expenses:financial_expenses(*),
      payments:financial_payments(*)
    `)
    .eq("id", id);

  query = applyFinancialClientScope(query, auth);
  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  return data ? hideExpectedReceiptFromNonOwner(rowToFinancialSale(data), auth) : null;
}

export async function ensureFinancialSaleForRegistration(registration, adminEmail = "", saleDate = "", options = {}) {
  const normalizedRegistration = registration?.id
    ? registration
    : await readRegistration(registration);

  if (!normalizedRegistration?.id) return null;

  const supabase = getFinancialClient();
  const { data: existing, error: existingError } = await supabase
    .from("financial_sales")
    .select("id")
    .eq("client_id", normalizedRegistration.id)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing?.id) {
    if (options.updateExistingDate && normalizeDate(saleDate)) {
      const { error: updateError } = await supabase
        .from("financial_sales")
        .update({ sale_date: normalizeDate(saleDate), updated_by_email: normalizeEmail(adminEmail) })
        .eq("id", existing.id);
      if (updateError) throw updateError;
    }
    return getFinancialSale(existing.id);
  }

  const clientName = normalizePersonName(normalizedRegistration.fullName || normalizedRegistration.full_name || "");
  const brokerId = normalizedRegistration.responsibleUserId || normalizedRegistration.responsible_user_id || null;
  const brokerProfile = brokerId ? await getAdminProfileById(brokerId) : null;
  const brokerEmail = normalizeEmail(brokerProfile?.email || adminEmail || normalizedRegistration.lastAdminEmail || normalizedRegistration.last_admin_email);
  const brokerName = brokerProfile?.name || getAdminDisplayName(brokerEmail);

  const { data, error } = await supabase
    .from("financial_sales")
    .insert({
      client_id: normalizedRegistration.id,
      broker_email: brokerEmail,
      broker_name: brokerName,
      broker_id: brokerId,
      broker_share_percentage: brokerProfile?.brokerCommissionPercentage ?? 50,
      agency_share_percentage: brokerProfile?.agencyCommissionPercentage ?? 50,
      sale_date: normalizeDate(saleDate) || currentDateString(),
      created_by_email: brokerEmail,
      updated_by_email: brokerEmail,
      notes: clientName ? `Venda criada automaticamente para ${clientName}.` : "Venda criada automaticamente."
    })
    .select("id")
    .single();

  if (error) {
    if (String(error.message || "").toLowerCase().includes("duplicate")) {
      const { data: duplicate } = await supabase
        .from("financial_sales")
        .select("id")
        .eq("client_id", normalizedRegistration.id)
        .maybeSingle();
      return duplicate?.id ? getFinancialSale(duplicate.id) : null;
    }
    throw error;
  }

  return getFinancialSale(data.id);
}

// Cliente entrou no status "Pago" (sale_paid, fim do pipeline de venda,
// pedido do dono 2026-10-01) — marca a venda financeira correspondente como
// recebida, sem mexer em valores/despesas/repasses já lançados. Cria a venda
// primeiro se, por algum motivo, ainda não existir (nunca deveria acontecer:
// qualquer etapa do pipeline já cria via ensureFinancialSaleForRegistration).
export async function markFinancialSaleReceivedForRegistration(registration, adminEmail = "", receivedDate = "") {
  const normalizedRegistration = registration?.id ? registration : await readRegistration(registration);
  if (!normalizedRegistration?.id) return null;

  const sale = await ensureFinancialSaleForRegistration(normalizedRegistration, adminEmail);
  if (!sale?.id) return null;

  const supabase = getFinancialClient();

  // financial_status é sempre DERIVADO da soma dos recebimentos (payments)
  // contra a comissão bruta (deriveFinancialStatus) — só marcar o status sem
  // lançar o recebimento em si deixaria a venda "Recebido" na lista, mas sem
  // nenhum valor computado nos totais mensais do Financeiro, e a marcação se
  // perderia na próxima vez que a venda fosse salva pela tela (recalcula do
  // zero a partir dos payments). Lança o valor que falta receber (comissão
  // bruta − já recebido) como um recebimento novo. Data: a informada por
  // quem marcou o cliente como "Pago" (regra do dono, 2026-10-01 — "sempre
  // que eu lançar uma venda como paga quero [...] me perguntando qual a data
  // do recebimento", pra contar no mês certo mesmo com lançamento atrasado);
  // sem data informada (chamada de outro lugar), cai no dia de hoje.
  await insertMissingReceipt(supabase, sale.id, computeReceiptRepair({
    financialStatus: FINANCIAL_STATUS.RECEIVED,
    grossCommission: sale.grossCommission,
    payments: sale.payments
  }), normalizeDate(receivedDate) || getTodayInSaoPaulo());

  const { error } = await supabase
    .from("financial_sales")
    .update({ financial_status: FINANCIAL_STATUS.RECEIVED, manual_status: true, updated_by_email: normalizeEmail(adminEmail) })
    .eq("id", sale.id);
  if (error) throw error;

  // Venda recebida: a atividade "Confirmar recebimento" aberta (se houver) é concluída.
  await syncExpectedReceiptActivitySafely(sale.id, null, adminEmail);

  return getFinancialSale(sale.id);
}

// Lança o recebimento que falta (já calculado por computeReceiptRepair) e,
// como a leitura+insert não é atômica, desfaz duplicata de corrida: se duas
// execuções simultâneas lançaram o mesmo reparo, mantém só o mais antigo.
async function insertMissingReceipt(supabase, saleId, repair, receivedDate) {
  if (!repair?.needsRepair || !(repair.amount > 0)) return false;

  const { error: paymentError } = await supabase.from("financial_payments").insert({
    sale_id: saleId,
    installment_number: repair.nextInstallmentNumber,
    amount: repair.amount,
    received_date: receivedDate,
    status: PAYMENT_STATUS.RECEIVED,
    note: RECEIPT_REPAIR_NOTE
  });
  if (paymentError) throw paymentError;

  const { data: marked, error: markedError } = await supabase
    .from("financial_payments")
    .select("id, created_at")
    .eq("sale_id", saleId)
    .eq("note", RECEIPT_REPAIR_NOTE)
    .eq("status", PAYMENT_STATUS.RECEIVED)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (markedError) throw markedError;
  if ((marked || []).length > 1) {
    const extraIds = marked.slice(1).map((row) => row.id);
    const { error: deleteError } = await supabase.from("financial_payments").delete().in("id", extraIds);
    if (deleteError) throw deleteError;
  }
  return true;
}

// Auto-reparo: venda "Recebido" cujo cliente está em "Pago" (sale_paid) mas
// cujos recebimentos somam menos que a comissão bruta (ex.: cliente marcado
// "Pago" antes do lançamento automático existir — incidente 2026-10-01).
// Idempotente: lança só a diferença, nunca passa do total e não toca em venda
// consistente. Retorna true se lançou algo.
export async function repairReceivedSaleMissingPayments(sale) {
  if (!sale?.id || sale.financialStatus !== FINANCIAL_STATUS.RECEIVED || !sale.manualStatus) return false;

  const repair = computeReceiptRepair({
    financialStatus: sale.financialStatus,
    grossCommission: sale.grossCommission,
    payments: sale.payments
  });
  if (!repair.needsRepair) return false;

  const supabase = getFinancialClient();
  const { data: client, error: clientError } = await supabase
    .from("simulation_registrations")
    .select("status")
    .eq("id", sale.clientId || sale.client_id)
    .maybeSingle();
  if (clientError) throw clientError;
  if (client?.status !== "sale_paid") return false;

  return insertMissingReceipt(supabase, sale.id, repair, getTodayInSaoPaulo());
}

export async function updateFinancialSale(id, payload = {}, adminEmail = "", auth = null) {
  const supabase = getFinancialClient();
  const current = await getFinancialSale(id, auth);
  if (!current?.id) throw new Error("Venda financeira nao encontrada.");

  const saleValue = payload.saleValue !== undefined ? normalizeMoneyValue(payload.saleValue) : current.saleValue;
  let commissionPercentage = payload.commissionPercentage !== undefined
    ? normalizeMoneyValue(payload.commissionPercentage)
    : current.commissionPercentage;
  let grossCommission = payload.grossCommission !== undefined
    ? normalizeMoneyValue(payload.grossCommission)
    : current.grossCommission;
  const commissionInputMode = payload.commissionInputMode || current.commissionInputMode || "amount";

  if (commissionInputMode === "percentage") {
    grossCommission = saleValue > 0 ? roundMoney((saleValue * commissionPercentage) / 100) : 0;
  } else {
    commissionPercentage = saleValue > 0 ? roundMoney((grossCommission / saleValue) * 100, 4) : 0;
  }

  const paymentRecords = Array.isArray(payload.payments)
    ? payload.payments.map(paymentToRecord).filter((payment) => payment.amount > 0 || payment.expected_date || payment.received_date || payment.note)
    : current.payments.map(paymentToRecord);

  const financialStatus = payload.financialStatus
    ? normalizeFinancialStatus(payload.financialStatus)
    : deriveFinancialStatus(grossCommission, paymentRecords);
  const expenseRecords = Array.isArray(payload.expenses)
    ? payload.expenses.map(expenseToRecord).filter((expense) => expense.description || expense.amount > 0)
    : current.expenses.map(expenseToRecord);
  const invoiceIssued = payload.invoiceIssued !== undefined ? Boolean(payload.invoiceIssued) : current.invoiceIssued;
  const expenseTotal = expenseRecords.reduce((total, expense) => total + normalizeMoneyValue(expense.amount), 0);
  const freeCommission = Math.max(0, roundMoney(grossCommission - (invoiceIssued ? grossCommission * 0.15 : 0) - expenseTotal));
  const hasManagerCommission = payload.hasManagerCommission !== undefined ? Boolean(payload.hasManagerCommission) : current.hasManagerCommission;
  const managerId = hasManagerCommission ? sanitizeText(payload.managerId !== undefined ? payload.managerId : current.managerId) : "";
  const manager = hasManagerCommission ? await getAdminProfileById(managerId) : null;
  if (hasManagerCommission && (!manager || !["admin", "manager"].includes(manager.role) || manager.status !== "active")) {
    throw new Error("Selecione um gestor ativo.");
  }
  const distribution = calculateCommissionDistribution({
    freeCommission,
    hasManagerCommission,
    managerPercentage: payload.managerPercentage !== undefined ? payload.managerPercentage : current.managerPercentage,
    brokerPercentage: payload.brokerSharePercentage !== undefined ? payload.brokerSharePercentage : current.brokerSharePercentage,
    agencyPercentage: payload.agencySharePercentage !== undefined ? payload.agencySharePercentage : current.agencySharePercentage
  });
  const brokerId = sanitizeText(payload.brokerId !== undefined ? payload.brokerId : current.brokerId) || null;
  const broker = brokerId ? await getAdminProfileById(brokerId) : null;
  if (brokerId && (!broker || !["admin", "manager", "broker"].includes(broker.role) || broker.status !== "active")) {
    throw new Error("Selecione um corretor ativo.");
  }

  const record = {
    property_name: sanitizeText(payload.propertyName !== undefined ? payload.propertyName : current.propertyName),
    broker_id: brokerId,
    broker_email: broker?.email || normalizeEmail(payload.brokerEmail !== undefined ? payload.brokerEmail : current.brokerEmail),
    broker_name: broker?.name || sanitizeText(payload.brokerName !== undefined ? payload.brokerName : current.brokerName),
    sale_date: normalizeDate(payload.saleDate) || current.saleDate || currentDateString(),
    sale_value: saleValue,
    commission_percentage: commissionPercentage,
    gross_commission: grossCommission,
    commission_input_mode: commissionInputMode === "percentage" ? "percentage" : "amount",
    financial_status: financialStatus,
    manual_status: Boolean(payload.manualStatus),
    invoice_issued: invoiceIssued,
    has_manager_commission: distribution.hasManagerCommission,
    manager_id: manager?.id || null,
    manager_name: manager?.name || "",
    manager_email: manager?.email || "",
    manager_percentage: distribution.managerPercentage,
    manager_commission: distribution.managerCommission,
    distribution_base: distribution.distributionBase,
    broker_share_percentage: distribution.brokerPercentage,
    broker_commission: distribution.brokerCommission,
    agency_share_percentage: distribution.agencyPercentage,
    agency_commission: distribution.agencyCommission,
    notes: sanitizeText(payload.notes !== undefined ? payload.notes : current.notes),
    updated_by_email: normalizeEmail(adminEmail)
  };

  // Previsão de recebimento do saldo da comissão (≠ data da venda, ≠ data real do pagamento): só o DONO
  // lança/altera. Outro admin que salve a venda não toca nesse campo (nem o enxerga: `current` vem oculto).
  const ownerEditsForecast = isExpectedReceiptOwner(auth);
  if (ownerEditsForecast && payload.expectedReceiptDate !== undefined) {
    record.expected_receipt_date = isValidDateKey(normalizeDate(payload.expectedReceiptDate)) ? normalizeDate(payload.expectedReceiptDate) : null;
  }

  const { error } = await supabase.from("financial_sales").update(record).eq("id", id);
  if (error) throw error;

  if (Array.isArray(payload.expenses)) {
    await replaceSaleExpenses(supabase, id, payload.expenses);
  }

  if (Array.isArray(payload.payments)) {
    await replaceSalePayments(supabase, id, payload.payments);
  }

  // Mantém a atividade "Confirmar recebimento" da Agenda de acordo com a previsão/saldo/status salvos.
  // Falha aqui não perde o salvamento financeiro: o cron scheduled-activities reconcilia depois.
  // Sem o dono como ator, a atividade (se precisar ser criada) é atribuída ao dono pelo resolveResponsible.
  await syncExpectedReceiptActivitySafely(id, ownerEditsForecast ? auth : null, adminEmail);

  return getFinancialSale(id, auth);
}

// ---------- Previsão de recebimento + Agenda (lógica em financial-expected-receipt-*.mjs) ----------

function receiptContext() {
  const supabase = getFinancialClient();
  return {
    db: supabase,
    getToday: getTodayInSaoPaulo,
    getSale: (id) => getFinancialSale(id),
    // Sem ator (cron / save de outro admin): a atividade é do DONO — só ele lança e vê previsões.
    resolveResponsible: async () => {
      const { data: admins } = await supabase.from("admin_users").select("id, email").eq("status", "active");
      return (admins || []).find((admin) => isOwnerAdminEmail(admin.email))?.id || "";
    }
  };
}

function receiptActor(auth, adminEmail = "") {
  return {
    actorProfileId: auth?.profile?.id || "",
    actorUserId: auth?.user?.id || null,
    adminEmail: normalizeEmail(adminEmail || auth?.user?.email)
  };
}

function assertExpectedReceiptOwner(auth) {
  if (!isExpectedReceiptOwner(auth)) throw new Error("Apenas o administrador principal pode lançar ou alterar a previsão de recebimento.");
}

export async function syncExpectedReceiptActivity(saleId, auth = null, adminEmail = "") {
  return syncExpectedReceiptActivityCore(receiptContext(), saleId, receiptActor(auth, adminEmail));
}

async function syncExpectedReceiptActivitySafely(saleId, auth = null, adminEmail = "") {
  try {
    await syncExpectedReceiptActivity(saleId, auth, adminEmail);
  } catch (error) {
    console.error("Nao foi possivel sincronizar a atividade de confirmacao de recebimento.", error);
  }
}

// CONFIRMAR RECEBIMENTO (total ou parcial) — idempotente; ver financial-expected-receipt-db.mjs.
export async function confirmExpectedReceipt(saleId, input = {}, auth = null) {
  assertExpectedReceiptOwner(auth);
  return confirmExpectedReceiptCore(receiptContext(), saleId, {
    amount: input.amount === "" || input.amount === undefined || input.amount === null ? null : normalizeMoneyValue(input.amount),
    receivedDate: normalizeDate(input.receivedDate),
    nextExpectedDate: normalizeDate(input.nextExpectedDate)
  }, receiptActor(auth));
}

// REAGENDAR a previsão — só a data; a venda segue pendente/parcial.
export async function rescheduleExpectedReceipt(saleId, expectedDate, auth = null) {
  assertExpectedReceiptOwner(auth);
  return rescheduleExpectedReceiptCore(receiptContext(), saleId, normalizeDate(expectedDate), receiptActor(auth));
}

// Rede de segurança do cron (não depende de abrir o Financeiro).
export async function reconcileExpectedReceiptActivities() {
  return reconcileExpectedReceiptActivitiesCore(receiptContext());
}

// Dados para os botões da Agenda: valor previsto e data de cada venda com atividade de recebimento.
export async function listExpectedReceiptSummaries(saleIds = []) {
  const ids = Array.from(new Set((saleIds || []).filter(Boolean)));
  if (!ids.length) return new Map();
  const supabase = getFinancialClient();
  const { data, error } = await supabase
    .from("financial_sales")
    .select(`*, ${FINANCIAL_SALE_CLIENT_SELECT}, expenses:financial_expenses(*), payments:financial_payments(*)`)
    .in("id", ids);
  if (error) throw error;
  const summaries = new Map();
  for (const row of data || []) {
    const sale = rowToFinancialSale(row);
    summaries.set(sale.id, {
      saleId: sale.id,
      clientName: sale.clientName,
      propertyName: sale.propertyName,
      expectedDate: sale.expectedReceiptDate,
      financialStatus: sale.financialStatus,
      amount: computeForecastAmount({ freeCommission: sale.totals.freeCommission, financialStatus: sale.financialStatus, payments: sale.payments })
    });
  }
  return summaries;
}

export async function deleteFinancialSale(id, auth = null) {
  const supabase = getFinancialClient();
  const current = await getFinancialSale(id, auth);
  if (!current?.id) throw new Error("Venda financeira nao encontrada.");
  const { error } = await supabase.from("financial_sales").delete().eq("id", id);
  if (error) throw error;
  return true;
}

export function calculateFinancialTotals(sale = {}) {
  const saleValue = normalizeMoneyValue(sale.saleValue);
  const grossCommission = normalizeMoneyValue(sale.grossCommission);
  const invoiceDeduction = sale.invoiceIssued ? roundMoney(grossCommission * 0.15) : 0;
  const expenses = Array.isArray(sale.expenses) ? sale.expenses : [];
  const payments = Array.isArray(sale.payments) ? sale.payments : [];
  const expenseTotal = expenses.reduce((total, item) => total + normalizeMoneyValue(item.amount), 0);
  const receivedTotal = payments
    .filter((payment) => normalizePaymentStatus(payment.status) === PAYMENT_STATUS.RECEIVED)
    .reduce((total, payment) => total + normalizeMoneyValue(payment.amount), 0);
  const freeCommission = Math.max(0, roundMoney(grossCommission - invoiceDeduction - expenseTotal));
  const receivableTotal = Math.max(0, roundMoney(freeCommission - receivedTotal));
  const distribution = calculateCommissionDistribution({
    freeCommission,
    hasManagerCommission: sale.hasManagerCommission,
    managerPercentage: sale.managerPercentage,
    brokerPercentage: sale.brokerSharePercentage ?? 50,
    agencyPercentage: sale.agencySharePercentage ?? 50
  });

  return {
    saleValue: roundMoney(saleValue),
    grossCommission: roundMoney(grossCommission),
    invoiceDeduction,
    expenseTotal: roundMoney(expenseTotal),
    freeCommission,
    receivedTotal: roundMoney(receivedTotal),
    receivableTotal,
    ...distribution,
    marginPercentage: saleValue > 0 ? roundMoney((freeCommission / saleValue) * 100, 2) : 0
  };
}

export function normalizeMoneyValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const cleaned = text.replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  if (cleaned.includes(",")) {
    const normalized = cleaned.replace(/\./g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatFinancialError(error) {
  const message = error?.message || String(error || "");
  const normalized = message.toLowerCase();

  if (
    normalized.includes("financial_sales") ||
    normalized.includes("financial_expenses") ||
    normalized.includes("financial_payments") ||
    normalized.includes("schema cache") ||
    normalized.includes("relation")
  ) {
    return FINANCIAL_TABLE_HINT;
  }

  return message || "Nao foi possivel carregar o modulo financeiro.";
}

function getFinancialClient() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase administrativo nao configurado para gerenciar o financeiro.");
  }
  return supabase;
}

function applyFinancialClientScope(query, auth) {
  if (!auth || isGeneralAdminAuth(auth)) return query;
  if (isManagerProfile(auth.profile) && canUseProfileDatabaseScope(auth.profile)) {
    return query.in("client.responsible_user_id", auth.profile.managedUserIds || [auth.profile.id]);
  }
  if (isAssociateProfile(auth.profile) && canUseProfileDatabaseScope(auth.profile)) {
    const ids = [auth.profile.id, auth.profile.linkedBrokerId].filter(Boolean);
    return ids.length > 1
      ? query.in("client.responsible_user_id", ids)
      : query.eq("client.responsible_user_id", auth.profile.id);
  }
  if (canUseProfileDatabaseScope(auth.profile)) {
    return query.eq("client.responsible_user_id", auth.profile.id);
  }
  return query.eq("client.responsible_user_id", "00000000-0000-0000-0000-000000000000");
}

function toAssociateFinancialView(sale) {
  const commission = roundMoney(sale.totals.freeCommission * 0.1);
  const payments = sale.payments.map((payment) => ({ ...payment, amount: roundMoney(payment.amount * 0.1) }));
  return {
    ...sale,
    grossCommission: commission,
    commissionPercentage: sale.saleValue > 0 ? roundMoney((commission / sale.saleValue) * 100, 4) : 0,
    invoiceIssued: false,
    expenses: [],
    payments,
    hasManagerCommission: false,
    managerId: "",
    managerPercentage: 0,
    brokerSharePercentage: 100,
    agencySharePercentage: 0,
    totals: calculateFinancialTotals({
      ...sale,
      grossCommission: commission,
      invoiceIssued: false,
      expenses: [],
      payments,
      hasManagerCommission: false,
      managerPercentage: 0,
      brokerSharePercentage: 100,
      agencySharePercentage: 0
    })
  };
}

async function readRegistration(id) {
  if (!id) return null;
  const supabase = getFinancialClient();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function replaceSaleExpenses(supabase, saleId, expenses = []) {
  const { error: deleteError } = await supabase.from("financial_expenses").delete().eq("sale_id", saleId);
  if (deleteError) throw deleteError;

  const records = expenses.map((expense, index) => expenseToRecord(expense, index, saleId)).filter((expense) => expense.description || expense.amount > 0);
  if (!records.length) return;

  const { error } = await supabase.from("financial_expenses").insert(records);
  if (error) throw error;
}

async function replaceSalePayments(supabase, saleId, payments = []) {
  const { error: deleteError } = await supabase.from("financial_payments").delete().eq("sale_id", saleId);
  if (deleteError) throw deleteError;

  const records = payments.map((payment, index) => paymentToRecord(payment, index, saleId)).filter((payment) => payment.amount > 0 || payment.expected_date || payment.received_date || payment.note);
  if (!records.length) return;

  const { error } = await supabase.from("financial_payments").insert(records);
  if (error) throw error;
}

function rowToFinancialSale(row = {}) {
  const sale = {
    id: row.id,
    clientId: row.client_id,
    clientName: normalizePersonName(row.client?.full_name || row.client_name || ""),
    clientPhone: row.client?.phone || "",
    propertyId: row.property_id || "",
    propertyName: row.property_name || "",
    brokerEmail: row.broker_email || "",
    brokerName: row.broker_name || getAdminDisplayName(row.broker_email),
    brokerId: row.broker_id || row.client?.responsible_user_id || "",
    saleDate: row.sale_date || "",
    saleValue: Number(row.sale_value || 0),
    commissionPercentage: Number(row.commission_percentage || 0),
    grossCommission: Number(row.gross_commission || 0),
    commissionInputMode: row.commission_input_mode || "amount",
    financialStatus: normalizeFinancialStatus(row.financial_status),
    manualStatus: Boolean(row.manual_status),
    expectedReceiptDate: row.expected_receipt_date || "",
    invoiceIssued: Boolean(row.invoice_issued),
    hasManagerCommission: Boolean(row.has_manager_commission),
    managerId: row.manager_id || "",
    managerName: row.manager_name || "",
    managerEmail: row.manager_email || "",
    managerPercentage: Number(row.manager_percentage || 0),
    managerCommission: Number(row.manager_commission || 0),
    distributionBase: Number(row.distribution_base || 0),
    brokerSharePercentage: Number(row.broker_share_percentage ?? 50),
    brokerCommission: Number(row.broker_commission || 0),
    agencySharePercentage: Number(row.agency_share_percentage ?? 50),
    agencyCommission: Number(row.agency_commission || 0),
    notes: row.notes || "",
    createdByEmail: row.created_by_email || "",
    updatedByEmail: row.updated_by_email || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    expenses: (row.expenses || []).sort(orderByDisplay).map(rowToExpense),
    payments: (row.payments || []).sort(orderByInstallment).map(rowToPayment),
    client: row.client || null
  };

  return {
    ...sale,
    totals: calculateFinancialTotals(sale)
  };
}

function rowToExpense(row = {}) {
  return {
    id: row.id || "",
    description: row.description || "",
    category: row.category || "Outros",
    amount: Number(row.amount || 0),
    note: row.note || "",
    displayOrder: Number(row.display_order || 0)
  };
}

function rowToPayment(row = {}) {
  return {
    id: row.id || "",
    installmentNumber: Number(row.installment_number || 1),
    amount: Number(row.amount || 0),
    expectedDate: row.expected_date || "",
    receivedDate: row.received_date || "",
    status: normalizePaymentStatus(row.status),
    note: row.note || "",
    confirmedActivityId: row.confirmed_activity_id || ""
  };
}

function expenseToRecord(expense = {}, index = 0, saleId = "") {
  return {
    sale_id: saleId || expense.saleId,
    description: sanitizeText(expense.description),
    category: FINANCIAL_EXPENSE_CATEGORIES.includes(expense.category) ? expense.category : "Outros",
    amount: normalizeMoneyValue(expense.amount),
    note: sanitizeText(expense.note),
    display_order: Number.isFinite(Number(expense.displayOrder)) ? Number(expense.displayOrder) : index
  };
}

function paymentToRecord(payment = {}, index = 0, saleId = "") {
  return {
    sale_id: saleId || payment.saleId,
    installment_number: Math.max(1, Number(payment.installmentNumber || payment.installment_number || index + 1)),
    amount: normalizeMoneyValue(payment.amount),
    expected_date: normalizeDate(payment.expectedDate || payment.expected_date) || null,
    received_date: normalizeDate(payment.receivedDate || payment.received_date) || null,
    status: normalizePaymentStatus(payment.status),
    note: sanitizeText(payment.note),
    confirmed_activity_id: payment.confirmedActivityId || payment.confirmed_activity_id || null
  };
}

function deriveFinancialStatus(grossCommission, payments = []) {
  const total = normalizeMoneyValue(grossCommission);
  const received = payments
    .filter((payment) => normalizePaymentStatus(payment.status) === PAYMENT_STATUS.RECEIVED)
    .reduce((sum, payment) => sum + normalizeMoneyValue(payment.amount), 0);

  if (total > 0 && received >= total) return FINANCIAL_STATUS.RECEIVED;
  if (received > 0) return FINANCIAL_STATUS.PARTIAL;
  return FINANCIAL_STATUS.PENDING;
}

function normalizeFinancialStatus(status) {
  return Object.values(FINANCIAL_STATUS).includes(status) ? status : FINANCIAL_STATUS.PENDING;
}

function normalizePaymentStatus(status) {
  return Object.values(PAYMENT_STATUS).includes(status) ? status : PAYMENT_STATUS.EXPECTED;
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
    const [day, month, year] = text.split("/");
    return `${year}-${month}-${day}`;
  }
  return "";
}

function currentDateString() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function sanitizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function roundMoney(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
}

function orderByDisplay(a, b) {
  return Number(a.display_order || 0) - Number(b.display_order || 0);
}

function orderByInstallment(a, b) {
  return Number(a.installment_number || 0) - Number(b.installment_number || 0);
}
