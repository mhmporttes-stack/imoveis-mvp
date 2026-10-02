import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import {
  DEFAULT_HEALTH_SETTINGS,
  OPERATING_EXPENSE_CATEGORIES,
  OPERATING_EXPENSE_TYPES,
  RECURRENCE_PERIODS,
  isIsoDate,
  round2,
  toNumber
} from "./financial-health-core.mjs";
import { normalizeMoneyValue } from "./financial";

// Persistência da aba "Saúde" (despesas operacionais da empresa + configuração de caixa/reserva).
// Autorização: o chamador (rota/página) exige admin geral ANTES de chamar estas funções.

const HEALTH_TABLE_HINT = "As tabelas da aba Saúde ainda não existem no Supabase. Aplique a migration supabase/migrations/20261002120000_financial_health.sql.";

export function formatHealthError(error) {
  const message = error?.message || String(error || "");
  const n = message.toLowerCase();
  if (n.includes("financial_operating_expenses") || n.includes("financial_health_settings") || n.includes("schema cache")) return HEALTH_TABLE_HINT;
  return message || "Não foi possível carregar a aba Saúde.";
}

function client() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo nao configurado para gerenciar o financeiro.");
  return supabase;
}

function clean(value, max = 300) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function rowToOperatingExpense(row = {}) {
  return {
    id: row.id,
    description: row.description || "",
    category: row.category || "Outros",
    expenseType: row.expense_type || "variable",
    amount: Number(row.amount || 0),
    expenseDate: row.expense_date || "",
    isRecurring: Boolean(row.is_recurring),
    recurrencePeriod: row.recurrence_period || null,
    recurrenceEndDate: row.recurrence_end_date || null,
    note: row.note || ""
  };
}

export async function listOperatingExpenses() {
  const { data, error } = await client()
    .from("financial_operating_expenses")
    .select("*")
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return (data || []).map(rowToOperatingExpense);
}

// Valida e normaliza o payload (lança Error com mensagem em português).
export function validateOperatingExpensePayload(payload = {}, { partial = false } = {}) {
  const record = {};
  const has = (key) => payload[key] !== undefined;

  if (!partial || has("description")) {
    const description = clean(payload.description, 160);
    if (!description) throw new Error("Informe a descrição da despesa.");
    record.description = description;
  }
  if (!partial || has("category")) {
    record.category = OPERATING_EXPENSE_CATEGORIES.includes(payload.category) ? payload.category : "Outros";
  }
  if (!partial || has("expenseType")) {
    if (!OPERATING_EXPENSE_TYPES.some((t) => t.value === payload.expenseType)) throw new Error("Informe o tipo da despesa (fixa, variável ou extraordinária).");
    record.expense_type = payload.expenseType;
  }
  if (!partial || has("amount")) {
    const amount = round2(normalizeMoneyValue(payload.amount));
    if (!(amount > 0)) throw new Error("Informe um valor maior que zero.");
    if (amount > 100000000) throw new Error("Valor acima do limite permitido.");
    record.amount = amount;
  }
  if (!partial || has("expenseDate")) {
    if (!isIsoDate(payload.expenseDate)) throw new Error("Informe uma data válida.");
    record.expense_date = payload.expenseDate;
  }
  if (!partial || has("isRecurring") || has("recurrencePeriod") || has("recurrenceEndDate")) {
    const recurring = Boolean(payload.isRecurring);
    record.is_recurring = recurring;
    if (recurring) {
      if (!RECURRENCE_PERIODS.some((p) => p.value === payload.recurrencePeriod)) throw new Error("Informe a periodicidade da despesa recorrente.");
      record.recurrence_period = payload.recurrencePeriod;
      record.recurrence_end_date = payload.recurrenceEndDate ? (isIsoDate(payload.recurrenceEndDate) ? payload.recurrenceEndDate : (() => { throw new Error("Data de encerramento inválida."); })()) : null;
    } else {
      record.recurrence_period = null;
      record.recurrence_end_date = null;
    }
  }
  if (!partial || has("note")) record.note = clean(payload.note, 500);
  return record;
}

export async function createOperatingExpense(payload, adminEmail = "") {
  const record = validateOperatingExpensePayload(payload);
  if (record.recurrence_end_date && record.recurrence_end_date < record.expense_date) throw new Error("O encerramento não pode ser anterior à data da despesa.");
  const email = clean(adminEmail, 200).toLowerCase();
  const { data, error } = await client()
    .from("financial_operating_expenses")
    .insert({ ...record, created_by_email: email, updated_by_email: email })
    .select("*")
    .single();
  if (error) throw error;
  return rowToOperatingExpense(data);
}

export async function updateOperatingExpense(id, payload, adminEmail = "") {
  const record = validateOperatingExpensePayload(payload, { partial: true });
  if (record.recurrence_end_date && record.expense_date && record.recurrence_end_date < record.expense_date) {
    throw new Error("O encerramento não pode ser anterior à data da despesa.");
  }
  const { data, error } = await client()
    .from("financial_operating_expenses")
    .update({ ...record, updated_by_email: clean(adminEmail, 200).toLowerCase(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Despesa não encontrada.");
  return rowToOperatingExpense(data);
}

export async function deleteOperatingExpense(id) {
  const { data, error } = await client().from("financial_operating_expenses").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("Despesa não encontrada.");
  return true;
}

export async function getHealthSettings() {
  const { data, error } = await client().from("financial_health_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_HEALTH_SETTINGS };
  return {
    openingCashBalance: data.opening_cash_balance === null || data.opening_cash_balance === undefined ? null : Number(data.opening_cash_balance),
    openingCashDate: data.opening_cash_date || "",
    reserveMonths: Number(data.reserve_months ?? DEFAULT_HEALTH_SETTINGS.reserveMonths),
    criticalMonths: Number(data.critical_months ?? DEFAULT_HEALTH_SETTINGS.criticalMonths)
  };
}

export async function saveHealthSettings(payload = {}, adminEmail = "") {
  const hasBalance = payload.openingCashBalance !== null && payload.openingCashBalance !== undefined && String(payload.openingCashBalance).trim() !== "";
  const reserveMonths = toNumber(normalizeMoneyValue(payload.reserveMonths));
  const criticalMonths = toNumber(normalizeMoneyValue(payload.criticalMonths));
  if (!(reserveMonths > 0 && reserveMonths <= 36)) throw new Error("A reserva deve ficar entre 0,1 e 36 meses.");
  if (!(criticalMonths >= 0) || criticalMonths >= reserveMonths) throw new Error("O limite crítico deve ser menor que a reserva desejada.");
  if (hasBalance && !isIsoDate(payload.openingCashDate)) throw new Error("Informe a data do saldo inicial.");

  const record = {
    id: 1,
    opening_cash_balance: hasBalance ? round2(normalizeMoneyValue(payload.openingCashBalance)) : null,
    opening_cash_date: hasBalance ? payload.openingCashDate : null,
    reserve_months: reserveMonths,
    critical_months: criticalMonths,
    updated_by_email: clean(adminEmail, 200).toLowerCase(),
    updated_at: new Date().toISOString()
  };
  const { error } = await client().from("financial_health_settings").upsert(record, { onConflict: "id" });
  if (error) throw error;
  return getHealthSettings();
}
