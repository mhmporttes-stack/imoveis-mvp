import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import {
  DEFAULT_HEALTH_SETTINGS,
  OPERATING_EXPENSE_CATEGORIES,
  OPERATING_EXPENSE_TYPES,
  RECURRENCE_PERIODS,
  expandExpenseOccurrences,
  forecastAmountFor,
  normalizeAmountMode,
  isIsoDate,
  planOverrideMigration,
  planRecurringSplit,
  round2,
  toNumber
} from "./financial-health-core.mjs";
import { normalizeMoneyValue } from "./financial";
import { getTodayInSaoPaulo } from "./daily-report";

// Persistência da aba "Saúde" (despesas operacionais da empresa + configuração de caixa/reserva).
// Autorização: o chamador (rota/página) exige admin geral ANTES de chamar estas funções.

const HEALTH_TABLE_HINT = "As tabelas da aba Saúde ainda não existem no Supabase. Aplique a migration supabase/migrations/20261002120000_financial_health.sql.";

export function formatHealthError(error) {
  const message = error?.message || String(error || "");
  const n = message.toLowerCase();
  if (n.includes("amount_mode") || n.includes("expected_amount")) return "A migration supabase/migrations/20261003130000_financial_variable_expenses.sql ainda não foi aplicada no Supabase.";
  if (n.includes("financial_operating_expense") || n.includes("financial_health_settings") || n.includes("schema cache")) return HEALTH_TABLE_HINT;
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
    // amountMode ≠ expenseType (Natureza do gasto): fixed = mesmo valor todo mês; variable = previsto × pago
    amountMode: normalizeAmountMode(row.amount_mode),
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
  if (!partial || has("amountMode")) {
    if (has("amountMode") && payload.amountMode !== "fixed" && payload.amountMode !== "variable") throw new Error("Informe se o valor da despesa é fixo ou variável.");
    record.amount_mode = normalizeAmountMode(payload.amountMode);
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

// Edição. Recorrente com mudança de valor/categoria/tipo/descrição/periodicidade vale SÓ dali para
// frente (`effectiveFrom`, padrão hoje): a série antiga é encerrada no dia anterior e nasce uma nova —
// os meses passados e as confirmações de pagamento já feitas não mudam (planRecurringSplit).
export async function updateOperatingExpense(id, payload, adminEmail = "", { effectiveFrom = "" } = {}) {
  const supabase = client();
  const email = clean(adminEmail, 200).toLowerCase();
  const { data: currentRow, error: currentError } = await supabase.from("financial_operating_expenses").select("*").eq("id", id).maybeSingle();
  if (currentError) throw currentError;
  if (!currentRow) throw new Error("Despesa não encontrada.");
  const current = rowToOperatingExpense(currentRow);
  const record = validateOperatingExpensePayload(payload, { partial: true });
  const from = isIsoDate(effectiveFrom) ? effectiveFrom : getTodayInSaoPaulo();

  if (current.isRecurring && record.is_recurring === false) {
    throw new Error("Para deixar de cobrar uma despesa recorrente use \"Encerrar\" — assim o histórico é preservado.");
  }

  // Alteração da série recorrente: calcula o plano em termos do modelo (camelCase).
  const changes = {};
  if (record.description !== undefined) changes.description = record.description;
  if (record.category !== undefined) changes.category = record.category;
  if (record.expense_type !== undefined) changes.expenseType = record.expense_type;
  if (record.amount_mode !== undefined) changes.amountMode = record.amount_mode;
  if (record.amount !== undefined) changes.amount = record.amount;
  if (record.recurrence_period !== undefined && record.is_recurring) changes.recurrencePeriod = record.recurrence_period;
  if (record.note !== undefined) changes.note = record.note;
  if (record.recurrence_end_date !== undefined) changes.recurrenceEndDate = record.recurrence_end_date;

  if (current.isRecurring) {
    const plan = planRecurringSplit(current, changes, from);
    if (plan.mode === "none") return current;
    if (plan.mode === "split") return splitRecurringExpense(supabase, current, plan, from, email);
    // in_place: mudanças que não tocam o histórico (observação, encerramento) ou sem passado a preservar.
    // A âncora de uma série recorrente não é editada aqui (as confirmações são amarradas a ela).
    delete record.expense_date;
  } else if (record.expense_date && record.expense_date !== current.expenseDate) {
    // despesa única que muda de data: leva junto a confirmação/reagendamento (chave = data original)
    const { error: moveError } = await supabase.from("financial_operating_expense_occurrences")
      .update({ occurrence_date: record.expense_date }).eq("expense_id", id).eq("occurrence_date", current.expenseDate);
    if (moveError) throw moveError;
  }
  if (record.recurrence_end_date && record.expense_date && record.recurrence_end_date < record.expense_date) {
    throw new Error("O encerramento não pode ser anterior à data da despesa.");
  }

  const { data, error } = await supabase
    .from("financial_operating_expenses")
    .update({ ...record, updated_by_email: email, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Despesa não encontrada.");
  return rowToOperatingExpense(data);
}

// Ordem segura (sem transação no PostgREST): cria a nova → move confirmações futuras → encerra a antiga;
// se algo falhar no meio, desfaz o que já foi feito.
async function splitRecurringExpense(supabase, current, plan, from, email) {
  const { data: oldOverrides, error: overridesError } = await supabase
    .from("financial_operating_expense_occurrences").select("*").eq("expense_id", current.id).gte("occurrence_date", from);
  if (overridesError) throw overridesError;
  const migration = planOverrideMigration((oldOverrides || []).map(rowToOccurrence), plan.newRow, from);
  if (migration.blocked.length) {
    throw new Error("Há pagamento confirmado ou reagendamento a partir dessa data que não existe na nova recorrência. Escolha outra data de vigência.");
  }

  const nr = plan.newRow;
  const { data: created, error: createError } = await supabase.from("financial_operating_expenses").insert({
    description: nr.description, category: nr.category, expense_type: nr.expenseType, amount_mode: normalizeAmountMode(nr.amountMode), amount: nr.amount,
    expense_date: nr.expenseDate, is_recurring: true, recurrence_period: nr.recurrencePeriod,
    recurrence_end_date: nr.recurrenceEndDate, note: nr.note || "",
    created_by_email: email, updated_by_email: email
  }).select("*").single();
  if (createError) throw createError;

  const moved = [];
  try {
    for (const o of migration.migrate) {
      const { error } = await supabase.from("financial_operating_expense_occurrences")
        .update({ expense_id: created.id }).eq("expense_id", current.id).eq("occurrence_date", o.occurrenceDate);
      if (error) throw error;
      moved.push(o.occurrenceDate);
    }
    const { error: closeError } = await supabase.from("financial_operating_expenses")
      .update({ recurrence_end_date: plan.closeOld.recurrenceEndDate, updated_by_email: email, updated_at: new Date().toISOString() })
      .eq("id", current.id);
    if (closeError) throw closeError;
  } catch (error) {
    for (const date of moved) {
      await supabase.from("financial_operating_expense_occurrences").update({ expense_id: current.id }).eq("expense_id", created.id).eq("occurrence_date", date);
    }
    await supabase.from("financial_operating_expenses").delete().eq("id", created.id);
    throw error;
  }
  return rowToOperatingExpense(created);
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

// ---------- ocorrências: confirmar pagamento, reagendar, desfazer ----------

export function rowToOccurrence(row = {}) {
  return {
    expenseId: row.expense_id,
    occurrenceDate: row.occurrence_date,
    status: row.status,
    paidDate: row.paid_date || null,
    paidAmount: row.paid_amount === null || row.paid_amount === undefined ? null : Number(row.paid_amount),
    // previsto CONGELADO no momento da confirmação (nulo em pagamentos anteriores à migration)
    expectedAmount: row.expected_amount === null || row.expected_amount === undefined ? null : Number(row.expected_amount),
    rescheduledTo: row.rescheduled_to || null
  };
}

export async function listExpenseOccurrences() {
  const { data, error } = await client().from("financial_operating_expense_occurrences").select("*").limit(20000);
  if (error) throw error;
  return (data || []).map(rowToOccurrence);
}

// action: "pay" (confirmar), "reschedule" (reagendar) ou "undo" (desfazer a confirmação).
export async function applyOccurrenceAction(expenseId, payload = {}, adminEmail = "") {
  const supabase = client();
  const { data: expenseRow, error: expenseError } = await supabase.from("financial_operating_expenses").select("*").eq("id", expenseId).maybeSingle();
  if (expenseError) throw expenseError;
  if (!expenseRow) throw new Error("Despesa não encontrada.");
  const expense = rowToOperatingExpense(expenseRow);
  const occurrenceDate = payload.occurrenceDate;
  if (!isIsoDate(occurrenceDate)) throw new Error("Informe a ocorrência da despesa.");
  // só aceita ocorrências que realmente existem na série (nada de linha solta)
  const exists = expandExpenseOccurrences(expense, occurrenceDate, occurrenceDate).length > 0;
  if (!exists) throw new Error("Essa ocorrência não existe nesta despesa.");

  const { data: existing, error: existingError } = await supabase.from("financial_operating_expense_occurrences")
    .select("*").eq("expense_id", expenseId).eq("occurrence_date", occurrenceDate).maybeSingle();
  if (existingError) throw existingError;
  const email = clean(adminEmail, 200).toLowerCase();
  const base = { expense_id: expenseId, occurrence_date: occurrenceDate, updated_by_email: email, updated_at: new Date().toISOString() };
  const today = getTodayInSaoPaulo();
  let record;

  if (payload.action === "pay") {
    const paidDate = payload.paidDate || today;
    if (!isIsoDate(paidDate)) throw new Error("Informe uma data de pagamento válida.");
    if (paidDate > today) throw new Error("A data de pagamento não pode ser futura. Para uma data futura, reagende a despesa.");
    // Previsto desta ocorrência: série fixa = valor cadastrado; variável = valor pago da última ocorrência paga anterior.
    // Ao confirmar de novo (corrigir o valor) o previsto já congelado é mantido.
    let expected = expense.amount;
    if (expense.amountMode === "variable") {
      const { data: seriesRows, error: seriesError } = await supabase.from("financial_operating_expense_occurrences")
        .select("*").eq("expense_id", expenseId).eq("status", "paid").lt("occurrence_date", occurrenceDate);
      if (seriesError) throw seriesError;
      expected = forecastAmountFor(expense, occurrenceDate, (seriesRows || []).map(rowToOccurrence));
    }
    expected = round2(expected);
    const frozenExpected = existing?.status === "paid" && existing.expected_amount !== null && existing.expected_amount !== undefined ? Number(existing.expected_amount) : expected;
    const rawPaid = payload.paidAmount;
    const amount = rawPaid === undefined || rawPaid === null || rawPaid === "" ? expected : round2(normalizeMoneyValue(rawPaid));
    if (!(amount > 0)) throw new Error("Informe um valor pago maior que zero.");
    if (amount > 100000000) throw new Error("Valor acima do limite permitido.");
    record = { ...base, status: "paid", paid_date: paidDate, paid_amount: amount, expected_amount: frozenExpected, rescheduled_to: existing?.rescheduled_to || null };
  } else if (payload.action === "reschedule") {
    if (existing?.status === "paid") throw new Error("Esta despesa já foi paga. Desfaça a confirmação antes de reagendar.");
    if (!isIsoDate(payload.rescheduledTo)) throw new Error("Informe a nova data.");
    record = { ...base, status: "pending", paid_date: null, paid_amount: null, expected_amount: null, rescheduled_to: payload.rescheduledTo === occurrenceDate ? null : payload.rescheduledTo };
  } else if (payload.action === "undo") {
    if (existing?.status !== "paid") throw new Error("Esta despesa não está paga.");
    record = { ...base, status: "pending", paid_date: null, paid_amount: null, expected_amount: null, rescheduled_to: existing.rescheduled_to || null };
  } else {
    throw new Error("Ação inválida.");
  }

  const { data, error } = await supabase.from("financial_operating_expense_occurrences")
    .upsert(record, { onConflict: "expense_id,occurrence_date" }).select("*").single();
  if (error) throw error;
  return rowToOccurrence(data);
}
