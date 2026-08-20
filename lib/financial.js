import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { getAdminDisplayName } from "./admin-users";
import { normalizePersonName } from "./name-utils";

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

export async function listFinancialSales() {
  const supabase = getFinancialClient();
  const { data, error } = await supabase
    .from("financial_sales")
    .select(`
      *,
      client:simulation_registrations(*),
      expenses:financial_expenses(*),
      payments:financial_payments(*)
    `)
    .order("sale_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []).map(rowToFinancialSale);
}

export async function getFinancialSale(id) {
  const supabase = getFinancialClient();
  const { data, error } = await supabase
    .from("financial_sales")
    .select(`
      *,
      client:simulation_registrations(*),
      expenses:financial_expenses(*),
      payments:financial_payments(*)
    `)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? rowToFinancialSale(data) : null;
}

export async function ensureFinancialSaleForRegistration(registration, adminEmail = "") {
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
  if (existing?.id) return getFinancialSale(existing.id);

  const clientName = normalizePersonName(normalizedRegistration.fullName || normalizedRegistration.full_name || "");
  const brokerEmail = normalizeEmail(adminEmail || normalizedRegistration.lastAdminEmail || normalizedRegistration.last_admin_email);
  const brokerName = getAdminDisplayName(brokerEmail);

  const { data, error } = await supabase
    .from("financial_sales")
    .insert({
      client_id: normalizedRegistration.id,
      broker_email: brokerEmail,
      broker_name: brokerName,
      sale_date: currentDateString(),
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

export async function updateFinancialSale(id, payload = {}, adminEmail = "") {
  const supabase = getFinancialClient();
  const current = await getFinancialSale(id);
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

  const record = {
    property_name: sanitizeText(payload.propertyName !== undefined ? payload.propertyName : current.propertyName),
    broker_email: normalizeEmail(payload.brokerEmail !== undefined ? payload.brokerEmail : current.brokerEmail),
    broker_name: sanitizeText(payload.brokerName !== undefined ? payload.brokerName : current.brokerName),
    sale_date: normalizeDate(payload.saleDate) || current.saleDate || currentDateString(),
    sale_value: saleValue,
    commission_percentage: commissionPercentage,
    gross_commission: grossCommission,
    commission_input_mode: commissionInputMode === "percentage" ? "percentage" : "amount",
    financial_status: financialStatus,
    manual_status: Boolean(payload.manualStatus),
    notes: sanitizeText(payload.notes !== undefined ? payload.notes : current.notes),
    updated_by_email: normalizeEmail(adminEmail)
  };

  const { error } = await supabase.from("financial_sales").update(record).eq("id", id);
  if (error) throw error;

  if (Array.isArray(payload.expenses)) {
    await replaceSaleExpenses(supabase, id, payload.expenses);
  }

  if (Array.isArray(payload.payments)) {
    await replaceSalePayments(supabase, id, payload.payments);
  }

  return getFinancialSale(id);
}

export async function deleteFinancialSale(id) {
  const supabase = getFinancialClient();
  const { error } = await supabase.from("financial_sales").delete().eq("id", id);
  if (error) throw error;
  return true;
}

export function calculateFinancialTotals(sale = {}) {
  const saleValue = normalizeMoneyValue(sale.saleValue);
  const grossCommission = normalizeMoneyValue(sale.grossCommission);
  const expenses = Array.isArray(sale.expenses) ? sale.expenses : [];
  const payments = Array.isArray(sale.payments) ? sale.payments : [];
  const expenseTotal = expenses.reduce((total, item) => total + normalizeMoneyValue(item.amount), 0);
  const receivedTotal = payments
    .filter((payment) => normalizePaymentStatus(payment.status) === PAYMENT_STATUS.RECEIVED)
    .reduce((total, payment) => total + normalizeMoneyValue(payment.amount), 0);
  const freeCommission = Math.max(0, roundMoney(grossCommission - expenseTotal));
  const receivableTotal = Math.max(0, roundMoney(freeCommission - receivedTotal));

  return {
    saleValue: roundMoney(saleValue),
    grossCommission: roundMoney(grossCommission),
    expenseTotal: roundMoney(expenseTotal),
    freeCommission,
    receivedTotal: roundMoney(receivedTotal),
    receivableTotal,
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
    saleDate: row.sale_date || "",
    saleValue: Number(row.sale_value || 0),
    commissionPercentage: Number(row.commission_percentage || 0),
    grossCommission: Number(row.gross_commission || 0),
    commissionInputMode: row.commission_input_mode || "amount",
    financialStatus: normalizeFinancialStatus(row.financial_status),
    manualStatus: Boolean(row.manual_status),
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
    note: row.note || ""
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
    note: sanitizeText(payment.note)
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
