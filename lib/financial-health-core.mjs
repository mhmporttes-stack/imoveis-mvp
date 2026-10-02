// Núcleo de cálculo da aba "Saúde" do Financeiro. Funções PURAS (sem banco, sem
// "server-only"): rodam no servidor, no client e nos testes (node --test).
// Fórmulas e definições: docs/FINANCEIRO_SAUDE.md.
//
// Vocabulário (nunca misturar):
//   REALIZADO  = dinheiro que de fato entrou/saiu (recebimento com status "recebido";
//                despesa com data <= hoje).
//   PREVISTO   = valor já registrado para o futuro (recebimento "previsto/atrasado" com
//                data esperada; despesa/recorrência com data > hoje).
//   ESTIMADO   = derivado de histórico (nunca entra no PREVISTO; sempre rotulado).

import { computeForecastAmount } from "./financial-expected-receipt-core.mjs";

export const OPERATING_EXPENSE_TYPES = [
  { value: "fixed", label: "Fixa / recorrente" },
  { value: "variable", label: "Variável / pontual" },
  { value: "extraordinary", label: "Extraordinária" }
];

// Como o valor da despesa se comporta (≠ expense_type = "Natureza do gasto"):
//   fixed    → mesmo valor previsto todo mês (comportamento original)
//   variable → previsto × pago: o valor realmente pago vira a referência da próxima previsão da série
export const AMOUNT_MODES = [
  { value: "fixed", label: "Valor fixo" },
  { value: "variable", label: "Valor variável (muda todo mês)" }
];
export function normalizeAmountMode(value) {
  return value === "variable" ? "variable" : "fixed";
}

// Janela de "A vencer": vencimento entre hoje e hoje + DUE_SOON_DAYS (inclusive) — decisão do dono, 2026-10-02.
export const DUE_SOON_DAYS = 7;

export const DUE_STATUS_LABELS = { planned: "Prevista", due_soon: "A vencer", overdue: "Vencida", paid: "Paga" };

export const RECURRENCE_PERIODS = [
  { value: "monthly", label: "Mensal", months: 1 },
  { value: "bimonthly", label: "Bimestral", months: 2 },
  { value: "quarterly", label: "Trimestral", months: 3 },
  { value: "semiannual", label: "Semestral", months: 6 },
  { value: "annual", label: "Anual", months: 12 }
];

export const OPERATING_EXPENSE_CATEGORIES = [
  "Aluguel",
  "Água",
  "Energia",
  "Internet",
  "Energia e água",
  "Internet e telefone",
  "Sistemas e assinaturas",
  "Assinaturas de IA (Claude, GPT)",
  "Copa e limpeza",
  "Servidor e hospedagem",
  "Contabilidade",
  "Salários e pró-labore",
  "Impostos e taxas",
  "Anúncios",
  "Combustível",
  "Materiais",
  "Serviços de terceiros",
  "Manutenção",
  "Equipamentos",
  "Reforma",
  "Outros"
];

// Despesas de uma venda (financial_expenses) cuja categoria é pagamento a OUTRO PARTICIPANTE da venda
// = REPASSE (não é despesa operacional). As demais categorias (Documentação, Cartório, ITBI, Engenharia,
// Marketing, Tráfego pago, Taxa, Outros) são despesas da venda e entram em "Despesas operacionais".
export const REPASSE_EXPENSE_CATEGORIES = ["Repasse", "Corretor parceiro", "Captador", "Indicador", "Bonificação"];

export const DEFAULT_HEALTH_SETTINGS = {
  openingCashBalance: null, // null = não configurado (NUNCA assumir 0)
  openingCashDate: "",
  reserveMonths: 3,
  criticalMonths: 1
};

const MONTHS_BY_PERIOD = Object.fromEntries(RECURRENCE_PERIODS.map((p) => [p.value, p.months]));
const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// ---------- datas (strings YYYY-MM-DD, aritmética em UTC: sem surpresa de fuso) ----------

export function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.UTC(...splitIso(value)));
}

// Data de hoje no fuso America/Sao_Paulo (YYYY-MM-DD), a partir de um instante. Pura (sem relógio global).
export function saoPauloToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function splitIso(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return [y, m - 1, d];
}

export function isoToDays(iso) {
  return Math.round(Date.UTC(...splitIso(iso)) / 86400000);
}

export function daysToIso(days) {
  const date = new Date(days * 86400000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(iso, n) {
  return daysToIso(isoToDays(iso) + n);
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// Soma n meses mantendo o dia-âncora (31 → último dia dos meses curtos).
export function addMonthsClamped(iso, n, anchorDay = null) {
  const [y, m, d] = splitIso(iso);
  const total = y * 12 + m + n;
  const year = Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const day = Math.min(anchorDay || d, daysInMonth(year, month));
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function monthRange(iso) {
  const [y, m] = splitIso(iso);
  return {
    start: `${y}-${String(m + 1).padStart(2, "0")}-01`,
    end: `${y}-${String(m + 1).padStart(2, "0")}-${String(daysInMonth(y, m)).padStart(2, "0")}`
  };
}

export function shiftMonth(iso, n) {
  return monthRange(addMonthsClamped(monthRange(iso).start, n));
}

export function isFullMonth(range) {
  const month = monthRange(range.start);
  return month.start === range.start && month.end === range.end;
}

export function monthLabel(iso, withYear = true) {
  const [y, m] = splitIso(iso);
  return withYear ? `${MONTH_NAMES[m]} de ${y}` : MONTH_NAMES[m];
}

export function inRange(iso, range) {
  return Boolean(iso) && iso >= range.start && iso <= range.end;
}

export function rangeFromPeriod(period, today, custom = {}) {
  const [y, m] = splitIso(today);
  if (period === "month") return monthRange(today);
  if (period === "lastMonth") return shiftMonth(today, -1);
  if (period === "quarter") {
    const startMonth = Math.floor(m / 3) * 3;
    return { start: `${y}-${String(startMonth + 1).padStart(2, "0")}-01`, end: monthRange(`${y}-${String(startMonth + 3).padStart(2, "0")}-01`).end };
  }
  if (period === "year") return { start: `${y}-01-01`, end: `${y}-12-31` };
  if (period === "custom") {
    const start = isIsoDate(custom.start) ? custom.start : "";
    const end = isIsoDate(custom.end) ? custom.end : "";
    if (start && end) return start <= end ? { start, end } : { start: end, end: start };
    if (start) return { start, end: today > start ? today : start };
    if (end) return { start: monthRange(end).start, end };
  }
  return monthRange(today);
}

export function previousRange(range) {
  if (isFullMonth(range)) return shiftMonth(range.start, -1);
  const length = isoToDays(range.end) - isoToDays(range.start) + 1;
  return { start: addDays(range.start, -length), end: addDays(range.start, -1) };
}

// ---------- números ----------

export function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function formatBRL(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(round2(value));
}

export function formatPercentBR(value, digits = 1) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value || 0))}%`;
}

// Variação percentual só quando existe base comparável (> 0). Senão null.
export function percentChange(current, previous) {
  const base = Number(previous);
  if (!Number.isFinite(base) || base <= 0) return null;
  return round2(((Number(current) - base) / base) * 100);
}

// ---------- despesas operacionais e recorrência ----------

export function normalizeExpenseType(value) {
  return OPERATING_EXPENSE_TYPES.some((t) => t.value === value) ? value : "variable";
}

// Expande UMA despesa em ocorrências dentro de [start, end]. Recorrência nunca é
// materializada no banco: a linha guarda só a âncora (data da 1ª ocorrência),
// o período e, opcionalmente, a data de encerramento.
export function expandExpenseOccurrences(expense, start, end) {
  const amount = round2(toNumber(expense?.amount));
  const anchor = expense?.expenseDate;
  if (!isIsoDate(anchor) || amount <= 0 || !isIsoDate(start) || !isIsoDate(end)) return [];

  const base = {
    expenseId: expense.id || "",
    description: expense.description || "",
    category: expense.category || "Outros",
    expenseType: normalizeExpenseType(expense.expenseType),
    amount,
    recurring: Boolean(expense.isRecurring)
  };

  if (!expense.isRecurring) {
    return anchor >= start && anchor <= end ? [{ ...base, date: anchor }] : [];
  }

  const step = MONTHS_BY_PERIOD[expense.recurrencePeriod];
  if (!step) return anchor >= start && anchor <= end ? [{ ...base, date: anchor }] : [];

  const anchorDay = splitIso(anchor)[2];
  const lastDate = isIsoDate(expense.recurrenceEndDate) && expense.recurrenceEndDate < end ? expense.recurrenceEndDate : end;
  const out = [];
  // pula direto para perto do início do intervalo (evita laço longo)
  const [ay, am] = splitIso(anchor);
  const [sy, sm] = splitIso(start);
  let index = Math.max(0, Math.floor(((sy * 12 + sm) - (ay * 12 + am)) / step) - 1);
  for (let guard = 0; guard < 2000; guard += 1, index += 1) {
    const date = addMonthsClamped(anchor, index * step, anchorDay);
    if (date > lastDate) break;
    if (date >= anchor && date >= start) out.push({ ...base, date });
  }
  return out;
}

// Confirmação manual por ocorrência (tabela financial_operating_expense_occurrences):
//   { expenseId, occurrenceDate (data ORIGINAL da ocorrência), status: "paid"|"pending",
//     paidDate, paidAmount, rescheduledTo }
// REGRA: despesa só é PAGA (realizada) após confirmação manual. A data chegar NÃO paga.
//   paga      → realizada, na data do pagamento (paidDate) e pelo valor pago (paidAmount, congelado)
//   não paga  → PREVISTA, na data reagendada (se houver) ou na data original; vencida = data < hoje
export function overrideKey(expenseId, date) {
  return `${expenseId}|${date}`;
}

export function indexOverrides(overrides) {
  return new Map((overrides || []).map((o) => [overrideKey(o.expenseId, o.occurrenceDate), o]));
}

// Status de vencimento de uma ocorrência (datas YYYY-MM-DD; `today` já no fuso de São Paulo):
//   paga → "paid" · vencimento < hoje → "overdue" · hoje..hoje+7 → "due_soon" · depois → "planned".
export function dueStatus({ paid = false, date, today }) {
  if (paid) return "paid";
  if (!isIsoDate(date) || !isIsoDate(today)) return "planned";
  if (date < today) return "overdue";
  if (date <= addDays(today, DUE_SOON_DAYS)) return "due_soon";
  return "planned";
}

// Valor PREVISTO de uma ocorrência. Série fixa: o valor cadastrado. Série variável: o valor efetivamente
// PAGO na última ocorrência paga ANTERIOR a esta (a referência da próxima previsão); sem nenhuma paga,
// o valor cadastrado. Calculado na leitura — nunca reescreve meses passados nem divide a série.
export function forecastAmountFor(expense, occurrenceDate, overrides = []) {
  const base = round2(toNumber(expense?.amount));
  if (normalizeAmountMode(expense?.amountMode) !== "variable" || !expense?.isRecurring) return base;
  let best = null;
  for (const o of overrides || []) {
    if (o.expenseId !== expense.id || o.status !== "paid" || !isIsoDate(o.occurrenceDate) || o.occurrenceDate >= occurrenceDate) continue;
    const paid = round2(toNumber(o.paidAmount));
    if (!(paid > 0)) continue;
    if (!best || o.occurrenceDate > best.date) best = { date: o.occurrenceDate, paid };
  }
  return best ? best.paid : base;
}

export function collectExpenseEvents(expenses, range, today, overrides = []) {
  const index = indexOverrides(overrides);
  const horizon = addDays(range.end, 400); // ocorrência futura reagendada para dentro do intervalo
  // referência de série variável: só as pagas, agrupadas por série
  const paidBySeries = new Map();
  for (const o of overrides || []) {
    if (o?.status !== "paid") continue;
    if (!paidBySeries.has(o.expenseId)) paidBySeries.set(o.expenseId, []);
    paidBySeries.get(o.expenseId).push(o);
  }
  const out = [];
  for (const expense of expenses || []) {
    if (!isIsoDate(expense?.expenseDate)) continue;
    const mode = normalizeAmountMode(expense.amountMode);
    const series = mode === "variable" ? paidBySeries.get(expense.id) || [] : [];
    for (const occurrence of expandExpenseOccurrences(expense, expense.expenseDate, horizon)) {
      const override = index.get(overrideKey(occurrence.expenseId, occurrence.date));
      const paid = override?.status === "paid" && isIsoDate(override.paidDate);
      const rescheduledTo = !paid && isIsoDate(override?.rescheduledTo) ? override.rescheduledTo : "";
      const date = paid ? override.paidDate : (rescheduledTo || occurrence.date);
      if (!inRange(date, range)) continue;
      const forecast = mode === "variable" ? forecastAmountFor(expense, occurrence.date, series) : occurrence.amount;
      const frozenExpected = override?.expectedAmount === null || override?.expectedAmount === undefined ? null : round2(toNumber(override.expectedAmount));
      const paidAmount = paid ? round2(toNumber(override.paidAmount ?? forecast)) : null;
      out.push({
        ...occurrence,
        originalDate: occurrence.date,
        dueDate: rescheduledTo || occurrence.date,
        date,
        amount: paid ? paidAmount : forecast,
        amountMode: mode,
        // previsto: congelado na confirmação (se houver) ou o calculado agora; pago só existe após confirmar
        expectedAmount: paid ? frozenExpected : forecast,
        paidAmount,
        paidDate: paid ? override.paidDate : null,
        status: paid ? "realized" : "planned",
        dueStatus: dueStatus({ paid, date, today }),
        overdue: !paid && date < today,
        rescheduled: Boolean(rescheduledTo)
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- painel de compromissos (Saúde) ----------
// Vencidas (qtd + valor, qualquer mês) · Vencem esta semana (hoje..+7) · Total a pagar (vencidas + a vencer +
// previstas do período) · Total pago (pagas no período, pela data do pagamento) · lista "Próximos compromissos"
// (vencidas primeiro, a mais antiga primeiro; depois por data). `range` = período da tela (padrão: mês de hoje).
// Despesa sem vencimento válido não entra nas contas: vem em `undated` (nada é apagado nem alterado).
export function buildExpensePanel({ expenses = [], overrides = [], today, range = null, limit = 0 }) {
  const period = range || monthRange(today);
  const weekEnd = addDays(today, DUE_SOON_DAYS);
  const horizonEnd = [period.end, weekEnd].sort().pop();
  const events = collectExpenseEvents(expenses, { start: "2000-01-01", end: horizonEnd }, today, overrides);
  const undated = (expenses || []).filter((e) => !isIsoDate(e?.expenseDate)).map((e) => ({ id: e.id || "", description: e.description || "", amount: round2(toNumber(e.amount)) }));
  const unpaid = events.filter((e) => e.status === "planned");
  const overdue = unpaid.filter((e) => e.dueStatus === "overdue");
  const dueSoon = unpaid.filter((e) => e.dueStatus === "due_soon");
  const planned = unpaid.filter((e) => e.dueStatus === "planned" && inRange(e.date, period));
  const sum = (list) => round2(list.reduce((s, e) => s + e.amount, 0));
  const toPay = [...overdue, ...dueSoon, ...planned];
  const upcoming = [...toPay].sort((a, b) => {
    const ao = a.dueStatus === "overdue" ? 0 : 1;
    const bo = b.dueStatus === "overdue" ? 0 : 1;
    return ao - bo || a.date.localeCompare(b.date) || String(a.description).localeCompare(String(b.description));
  }).map((e) => ({
    expenseId: e.expenseId, occurrenceDate: e.originalDate, dueDate: e.date, description: e.description, category: e.category,
    expenseType: e.expenseType, amountMode: e.amountMode, expectedAmount: e.expectedAmount, status: e.dueStatus,
    statusLabel: DUE_STATUS_LABELS[e.dueStatus], daysOverdue: e.dueStatus === "overdue" ? isoToDays(today) - isoToDays(e.date) : 0,
    daysToDue: e.dueStatus === "overdue" ? 0 : isoToDays(e.date) - isoToDays(today), rescheduled: e.rescheduled, recurring: e.recurring
  }));
  const paidInPeriod = events.filter((e) => e.status === "realized" && inRange(e.date, period));
  return {
    today,
    period,
    dueSoonDays: DUE_SOON_DAYS,
    overdue: { count: overdue.length, amount: sum(overdue) },
    dueThisWeek: { count: dueSoon.length, amount: sum(dueSoon), from: today, to: weekEnd },
    planned: { count: planned.length, amount: sum(planned) },
    totalToPay: { count: toPay.length, amount: sum(toPay) },
    totalPaid: { count: paidInPeriod.length, amount: sum(paidInPeriod), expected: round2(paidInPeriod.reduce((s, e) => s + (e.expectedAmount ?? e.amount), 0)) },
    upcoming: limit > 0 ? upcoming.slice(0, limit) : upcoming,
    undated
  };
}

// Previstas NÃO confirmadas com data anterior a `beforeDate` (vencidas de meses anteriores).
export function collectPendingBefore(expenses, overrides, beforeDate, today) {
  const start = (expenses || []).map((e) => e.expenseDate).filter(isIsoDate).sort()[0];
  if (!start || start >= beforeDate) return [];
  return collectExpenseEvents(expenses, { start: "2000-01-01", end: addDays(beforeDate, -1) }, today, overrides).filter((e) => e.status === "planned");
}

// Equivalente mensal (R$/mês) das despesas recorrentes ativas na data.
export function recurringMonthlyEquivalent(expenses, atDate) {
  return round2((expenses || []).reduce((sum, expense) => {
    if (!expense?.isRecurring || expense.expenseType === "extraordinary") return sum;
    const step = MONTHS_BY_PERIOD[expense.recurrencePeriod];
    if (!step || !isIsoDate(expense.expenseDate) || expense.expenseDate > atDate) return sum;
    if (isIsoDate(expense.recurrenceEndDate) && expense.recurrenceEndDate < atDate) return sum;
    return sum + toNumber(expense.amount) / step;
  }, 0));
}

// ---------- alteração de recorrente SÓ dali para frente ----------
// Editar valor/categoria/tipo/descrição/periodicidade de uma série recorrente NÃO reescreve o passado:
// a série antiga é ENCERRADA no dia anterior à vigência e nasce uma nova a partir dela (histórico e
// relatórios dos meses encerrados ficam idênticos). Função pura — a persistência está em lib/financial-health.js.
const MATERIAL_FIELDS = ["description", "category", "expenseType", "amount", "recurrencePeriod", "amountMode"];

export function planRecurringSplit(current, changes = {}, effectiveFrom) {
  const same = (field) => {
    if (changes[field] === undefined) return true;
    if (field === "amount") return round2(toNumber(changes.amount)) === round2(toNumber(current.amount));
    if (field === "amountMode") return normalizeAmountMode(changes.amountMode) === normalizeAmountMode(current.amountMode);
    return String(changes[field] ?? "") === String(current[field] ?? "");
  };
  const materialChanged = MATERIAL_FIELDS.some((field) => !same(field));
  const softChanged = ["note", "recurrenceEndDate"].some((field) => changes[field] !== undefined && String(changes[field] || "") !== String(current[field] || ""));
  if (!materialChanged) return softChanged ? { mode: "in_place" } : { mode: "none" };
  if (!current.isRecurring || !isIsoDate(effectiveFrom)) return { mode: "in_place" };
  // nada aconteceu antes da vigência: não há histórico a preservar
  if (current.expenseDate >= effectiveFrom) return { mode: "in_place" };
  if (isIsoDate(current.recurrenceEndDate) && current.recurrenceEndDate < effectiveFrom) {
    throw new Error("Esta recorrência já foi encerrada antes da data de vigência informada.");
  }

  const period = changes.recurrencePeriod || current.recurrencePeriod;
  let firstNew = effectiveFrom;
  if (period === current.recurrencePeriod) {
    const next = expandExpenseOccurrences({ ...current, recurrenceEndDate: null }, effectiveFrom, addDays(effectiveFrom, 400))[0];
    if (next) firstNew = next.date;
  }
  const pick = (field) => (changes[field] !== undefined ? changes[field] : current[field]);
  const endDate = changes.recurrenceEndDate !== undefined ? changes.recurrenceEndDate : current.recurrenceEndDate;
  return {
    mode: "split",
    closeOld: { recurrenceEndDate: addDays(effectiveFrom, -1) },
    newRow: {
      description: pick("description"),
      category: pick("category"),
      expenseType: pick("expenseType"),
      amount: round2(toNumber(pick("amount"))),
      amountMode: normalizeAmountMode(pick("amountMode")),
      note: pick("note") || "",
      isRecurring: true,
      recurrencePeriod: period,
      expenseDate: firstNew,
      recurrenceEndDate: isIsoDate(endDate) && endDate >= firstNew ? endDate : null
    }
  };
}

// Confirmações/reagendamentos da série antiga com data ≥ vigência: seguem para a série nova se a
// ocorrência existir nela; senão bloqueiam a alteração (nada pode ser perdido em silêncio).
export function planOverrideMigration(oldOverrides, newRow, effectiveFrom) {
  const future = (oldOverrides || []).filter((o) => o.occurrenceDate >= effectiveFrom);
  const dates = new Set(expandExpenseOccurrences(newRow, newRow.expenseDate, addDays(effectiveFrom, 800)).map((o) => o.date));
  return {
    migrate: future.filter((o) => dates.has(o.occurrenceDate)),
    blocked: future.filter((o) => !dates.has(o.occurrenceDate))
  };
}

// ---------- receitas (vendas/recebimentos existentes) ----------

// Cada recebimento vira um evento. A parte da imobiliária e os custos da venda
// (repasses, despesas da venda, nota fiscal, comissões de corretor e gestor) são
// apropriados PROPORCIONALMENTE ao valor recebido:
//   net  = comissão da imobiliária × (recebido / comissão bruta)
//   cost = (comissão bruta − comissão da imobiliária) × (recebido / comissão bruta)
// Como a venda não registra a data em que cada repasse foi pago, esta é a
// apropriação gerencial defensável (regime de caixa proporcional).
// Decompõe a comissão bruta de UMA venda em fatias proporcionais (somam 1):
//   imobiliária (resultado) · repasses · nota fiscal · despesas da venda
//   repasses = comissão do corretor + comissão do gestor + despesas da venda de categoria de repasse
// Cada componente vem do que a venda JÁ calcula (totals) — nada é recalculado aqui, então a nota entra
// uma única vez e repasse nunca vira despesa. Venda sem detalhamento (dado antigo/parcial): o que não é
// da imobiliária fica como repasse. Comissão menor que as deduções (livre = 0): fatias reduzidas
// proporcionalmente para fechar exatamente em (bruta − imobiliária).
export function splitSaleShares(sale) {
  const gross = toNumber(sale.grossCommission);
  if (gross <= 0) return { agency: 0, repasses: 0, invoice: 0, saleExpenses: 0 };
  const t = sale.totals || {};
  const agency = Math.min(Math.max(0, toNumber(t.agencyCommission ?? sale.agencyCommission)), gross);
  const expenseRows = Array.isArray(sale.expenses) ? sale.expenses : [];
  const sumExpenses = (predicate) => expenseRows.filter(predicate).reduce((sum, e) => sum + toNumber(e.amount), 0);
  const isRepasse = (e) => REPASSE_EXPENSE_CATEGORIES.includes(e.category);
  let repasses = toNumber(t.brokerCommission) + toNumber(t.managerCommission) + sumExpenses(isRepasse);
  let invoice = toNumber(t.invoiceDeduction);
  let saleExpenses = sumExpenses((e) => !isRepasse(e));
  const target = gross - agency;
  const total = repasses + invoice + saleExpenses;
  if (total <= 0) { repasses = target; invoice = 0; saleExpenses = 0; }
  else if (Math.abs(total - target) > 0.005) {
    const factor = target / total;
    repasses *= factor; invoice *= factor; saleExpenses *= factor;
  }
  return { agency: agency / gross, repasses: repasses / gross, invoice: invoice / gross, saleExpenses: saleExpenses / gross };
}

// Evento de receita (recebido ou previsto) com a decomposição proporcional ao valor.
function revenueEventParts(sale, amount) {
  const gross = toNumber(sale.grossCommission);
  const ratio = gross > 0 ? Math.min(1, amount / gross) : 0;
  const shares = splitSaleShares(sale);
  const base = gross > 0 ? gross * ratio : amount; // valor efetivamente apropriado
  const net = round2(base * shares.agency);
  const invoice = round2(base * shares.invoice);
  const saleExpenses = round2(base * shares.saleExpenses);
  const cost = round2(amount - net);
  return { gross: round2(amount), net, cost, invoice, saleExpenses, repasses: round2(cost - invoice - saleExpenses) };
}

export function collectRevenueEvents(sales, today) {
  const events = [];
  let undatedReceived = 0;
  let undatedExpected = 0;

  for (const sale of sales || []) {
    if (!sale || sale.financialStatus === "cancelled") continue;
    const gross = toNumber(sale.grossCommission);
    const brokerKey = sale.brokerId || sale.brokerEmail || sale.brokerName || "";
    const brokerName = sale.brokerName || sale.brokerEmail || "Sem corretor";

    for (const payment of sale.payments || []) {
      const amount = toNumber(payment.amount);
      if (amount <= 0 || payment.status === "cancelled") continue;
      const common = { saleId: sale.id, brokerKey, brokerName, ...revenueEventParts(sale, amount) };

      if (payment.status === "received") {
        const date = payment.receivedDate || payment.expectedDate;
        if (!isIsoDate(date)) { undatedReceived += 1; continue; }
        events.push({ ...common, kind: "received", date });
      } else {
        if (!isIsoDate(payment.expectedDate)) { undatedExpected += 1; continue; }
        events.push({ ...common, kind: "expected", date: payment.expectedDate, overdue: payment.expectedDate < today, source: "payment" });
      }
    }

    // PREVISÃO DE RECEBIMENTO do saldo (financial_sales.expected_receipt_date — só o dono a vê:
    // para os demais o servidor já devolve a data vazia e nada entra aqui). Mesma regra da Agenda:
    // saldo da comissão BRUTA ainda não recebido nem coberto por parcelas datadas (sem dupla contagem).
    if (isIsoDate(sale.expectedReceiptDate)) {
      const forecast = computeForecastAmount({
        grossCommission: sale.totals?.grossCommission ?? sale.grossCommission ?? 0,
        financialStatus: sale.financialStatus,
        payments: sale.payments || []
      });
      if (forecast > 0) {
        events.push({ saleId: sale.id, brokerKey, brokerName, ...revenueEventParts(sale, forecast), kind: "expected", date: sale.expectedReceiptDate, overdue: sale.expectedReceiptDate < today, source: "forecast" });
      }
    }
  }
  return { events, undatedReceived, undatedExpected };
}

// ---------- resumo de um período ----------

export function summarizeRange({ revenueEvents, expenseEvents, range, today, priorPending = [] }) {
  const received = revenueEvents.filter((e) => e.kind === "received" && inRange(e.date, range));
  const expected = revenueEvents.filter((e) => e.kind === "expected" && inRange(e.date, range));
  const opReal = expenseEvents.filter((e) => e.status === "realized" && inRange(e.date, range));
  const opPlanned = expenseEvents.filter((e) => e.status === "planned" && inRange(e.date, range));
  const sum = (list, key) => round2(list.reduce((s, e) => s + e[key], 0));

  const revenueGross = sum(received, "gross");
  const netRevenue = sum(received, "net");
  const saleCosts = sum(received, "cost");
  // classificação: repasses ≠ nota ≠ despesas (cada real da comissão aparece UMA vez)
  const repasses = sum(received, "repasses");
  const invoice = sum(received, "invoice");
  const saleExpenses = sum(received, "saleExpenses");
  const operatingExpenses = sum(opReal, "amount");
  const expenses = round2(saleCosts + operatingExpenses);
  const profit = round2(revenueGross - expenses);

  const expectedGross = sum(expected, "gross");
  const expectedOverdue = sum(expected.filter((e) => e.overdue), "gross");
  const expectedSaleCosts = sum(expected, "cost");
  const expectedRepasses = sum(expected, "repasses");
  const expectedInvoice = sum(expected, "invoice");
  const expectedSaleExpenses = sum(expected, "saleExpenses");
  const projectable = range.end >= today;
  // Previstas vencidas de meses anteriores seguem sendo obrigação em aberto: entram na projeção.
  const pendingPriorAmount = projectable ? sum(priorPending, "amount") : 0;
  const plannedOperating = round2(sum(opPlanned, "amount") + pendingPriorAmount);
  const overdueOperating = round2(sum(opPlanned.filter((e) => e.overdue), "amount") + pendingPriorAmount);

  const projected = projectable ? {
    revenueGross: round2(revenueGross + expectedGross),
    expenses: round2(expenses + expectedSaleCosts + plannedOperating),
    repasses: round2(repasses + expectedRepasses),
    invoice: round2(invoice + expectedInvoice),
    operatingTotal: round2(operatingExpenses + saleExpenses + expectedSaleExpenses + plannedOperating),
    result: round2(revenueGross + expectedGross - (expenses + expectedSaleCosts + plannedOperating))
  } : null;

  return {
    range,
    // REALIZADO
    revenueGross,
    netRevenue,
    saleCosts,
    repasses,
    invoice,
    saleExpenses,
    operatingExpenses,
    // despesas operacionais PAGAS = da empresa (confirmadas) + despesas ligadas às vendas (ITBI, cartório…)
    operatingTotal: round2(operatingExpenses + saleExpenses),
    expenses,
    netResult: profit,
    profit,
    marginPercent: revenueGross > 0 ? round2((profit / revenueGross) * 100) : null,
    // PREVISTO
    expectedGross,
    expectedOverdue,
    expectedSaleCosts,
    expectedRepasses,
    expectedInvoice,
    expectedSaleExpenses,
    expectedOperating: round2(expectedSaleExpenses + plannedOperating),
    plannedOperating,
    pendingPriorAmount,
    overdueOperating,
    projectable,
    projected,
    counts: { received: received.length, expected: expected.length }
  };
}

// ---------- caixa, reserva, cobertura ----------

export function hasCashConfig(settings) {
  return settings?.openingCashBalance !== null && settings?.openingCashBalance !== undefined
    && settings.openingCashBalance !== "" && Number.isFinite(Number(settings.openingCashBalance))
    && isIsoDate(settings.openingCashDate);
}

// Caixa no FIM do dia `atDate`: saldo inicial (início do dia da data inicial)
// + entradas recebidas − saídas (custos de venda apropriados + despesas operacionais).
export function cashAt({ settings, revenueEvents, expenses, overrides = [], atDate, today }) {
  if (!hasCashConfig(settings)) return null;
  const from = settings.openingCashDate;
  if (atDate < from) return null;
  const window = { start: from, end: atDate };
  const received = revenueEvents.filter((e) => e.kind === "received" && inRange(e.date, window));
  // Saída de caixa = SOMENTE despesa efetivamente PAGA (confirmada), na data do pagamento.
  const operating = collectExpenseEvents(expenses, window, today, overrides).filter((e) => e.status === "realized");
  const inflow = received.reduce((s, e) => s + e.gross, 0);
  const outflow = received.reduce((s, e) => s + e.cost, 0) + operating.reduce((s, e) => s + e.amount, 0);
  return round2(toNumber(settings.openingCashBalance) + inflow - outflow);
}

// Custo operacional mensal de referência (conservador): o MAIOR entre
//  (a) média dos 3 últimos meses fechados de despesas operacionais não extraordinárias
//  (b) equivalente mensal das recorrências ativas hoje.
export function monthlyOperatingCost({ expenses, today, overrides = [] }) {
  const months = [1, 2, 3].map((n) => shiftMonth(today, -n));
  // Custo de referência = o que a operação custa (pago ou ainda a confirmar), sem extraordinárias.
  const total = months.reduce((sum, range) => sum + collectExpenseEvents(expenses, range, today, overrides)
    .filter((e) => e.expenseType !== "extraordinary")
    .reduce((s, e) => s + e.amount, 0), 0);
  const average = round2(total / 3);
  const recurring = recurringMonthlyEquivalent(expenses, today);
  return { value: Math.max(average, recurring), average3m: average, recurring };
}

export function evaluateReserve({ cash, monthlyCost, settings }) {
  const reserveMonths = toNumber(settings?.reserveMonths) || DEFAULT_HEALTH_SETTINGS.reserveMonths;
  const criticalMonths = toNumber(settings?.criticalMonths);
  const recommended = round2(monthlyCost * reserveMonths);
  const coverageMonths = cash !== null && monthlyCost > 0 ? round2(cash / monthlyCost) : null;
  let level = null;
  if (coverageMonths !== null) {
    if (coverageMonths >= reserveMonths) level = "healthy";
    else if (coverageMonths > criticalMonths) level = "attention";
    else level = "critical";
  }
  return { reserveMonths, criticalMonths, recommended, coverageMonths, level, cash };
}

// ---------- ponto de equilíbrio ----------
// Despesas operacionais do período (realizadas + previstas) ÷ margem de contribuição
// (parte da imobiliária ÷ receita bruta recebida, nos últimos 6 meses + período).
export function breakEven({ revenueEvents, expenseEvents, range, today, summary }) {
  const operatingNeeded = round2(expenseEvents.filter((e) => inRange(e.date, range)).reduce((s, e) => s + e.amount, 0));
  const window = { start: shiftMonth(range.start, -6).start, end: range.end < today ? range.end : today };
  const sample = revenueEvents.filter((e) => e.kind === "received" && inRange(e.date, window));
  const grossSample = sample.reduce((s, e) => s + e.gross, 0);
  const netSample = sample.reduce((s, e) => s + e.net, 0);
  const contributionRatio = grossSample > 0 ? netSample / grossSample : null;
  const grossNeeded = contributionRatio && contributionRatio > 0 ? round2(operatingNeeded / contributionRatio) : null;
  return {
    operatingNeeded,
    contributionPercent: contributionRatio === null ? null : round2(contributionRatio * 100),
    grossNeeded,
    grossReceived: summary.revenueGross,
    grossGap: grossNeeded === null ? null : round2(Math.max(0, grossNeeded - summary.revenueGross)),
    netReceived: summary.netRevenue,
    netGap: round2(Math.max(0, operatingNeeded - summary.netRevenue)),
    reached: summary.netRevenue >= operatingNeeded && operatingNeeded > 0
  };
}

// ---------- resultado por corretor ----------
// Métrica: RESULTADO DA IMOBILIÁRIA POR CORRETOR = parte da imobiliária nas comissões
// efetivamente recebidas no período, por corretor da venda. Não é VGV nem comissão
// bruta; não desconta despesas operacionais (não são atribuíveis a um corretor).
export function resultByBroker(revenueEvents, range) {
  const map = new Map();
  for (const e of revenueEvents) {
    if (e.kind !== "received" || !inRange(e.date, range)) continue;
    const key = e.brokerKey || "none";
    const row = map.get(key) || { key, name: e.brokerName, agencyResult: 0, grossReceived: 0, repasses: 0, otherCosts: 0, sales: new Set() };
    row.agencyResult += e.net;
    row.grossReceived += e.gross;
    row.repasses += e.repasses;
    row.otherCosts += e.invoice + e.saleExpenses; // nota fiscal + despesas da venda (≠ repasses)
    row.sales.add(e.saleId);
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ key: r.key, name: r.name, agencyResult: round2(r.agencyResult), grossReceived: round2(r.grossReceived), repasses: round2(r.repasses), otherCosts: round2(r.otherCosts), salesCount: r.sales.size }))
    .sort((a, b) => b.agencyResult - a.agencyResult);
}

// ---------- evolução diária acumulada (mês de referência × mês anterior × projeção) ----------

export function buildEvolution({ revenueEvents, expenseEvents, referenceMonth, today }) {
  const current = monthRange(referenceMonth);
  const previous = shiftMonth(referenceMonth, -1);
  const todayIdx = today >= current.start && today <= current.end ? splitIso(today)[2] : (today > current.end ? 31 : 0);
  const length = splitIso(current.end)[2];

  function dayOf(date, range) { return isoToDays(date) - isoToDays(range.start) + 1; }

  function cumulative(range, { upToDay, includeFuture }) {
    const days = daysInMonth(...[splitIso(range.start)[0], splitIso(range.start)[1]]);
    const rev = Array(days + 1).fill(0);
    const exp = Array(days + 1).fill(0);
    for (const e of revenueEvents) {
      if (!inRange(e.date, range)) continue;
      const isReal = e.kind === "received";
      if (!isReal && !includeFuture) continue;
      const day = !isReal && e.date <= today ? Math.min(days, Math.max(1, dayOf(today >= range.start ? today : range.start, range))) : dayOf(e.date, range);
      rev[day] += e.gross;
      exp[day] += e.cost;
    }
    for (const e of expenseEvents) {
      const carriedOver = includeFuture && range.start === current.start && e.status === "planned" && e.date < range.start;
      if (!inRange(e.date, range) && !carriedOver) continue;
      if (e.status === "planned" && !includeFuture) continue;
      // prevista vencida (não confirmada) é projeção: aparece a partir de hoje, nunca no realizado
      const when = e.status === "planned" && e.date < today && today >= range.start ? today : e.date;
      exp[Math.min(days, Math.max(1, dayOf(when, range)))] += e.amount;
    }
    const out = { revenue: [], expenses: [], result: [] };
    let r = 0; let x = 0;
    for (let d = 1; d <= days; d += 1) {
      r += rev[d]; x += exp[d];
      const visible = d <= upToDay;
      out.revenue.push(visible ? round2(r) : null);
      out.expenses.push(visible ? round2(x) : null);
      out.result.push(visible ? round2(r - x) : null);
    }
    return out;
  }

  const realizedUpTo = Math.min(todayIdx, length);
  const realized = cumulative(current, { upToDay: realizedUpTo, includeFuture: false });
  const hasProjection = today <= current.end;
  const projectedFull = hasProjection ? cumulative(current, { upToDay: length, includeFuture: true }) : null;
  // projeção só dos dias a partir de hoje (liga ao último realizado)
  const projected = projectedFull
    ? Object.fromEntries(["revenue", "expenses", "result"].map((k) => [k, projectedFull[k].map((v, i) => (i + 1 >= realizedUpTo ? v : null))]))
    : null;
  const prev = cumulative(previous, { upToDay: 31, includeFuture: false });

  return { days: length, todayIndex: realizedUpTo, currentMonth: current, previousMonth: previous, previous: prev, realized, projected };
}

// ---------- histórico mensal ----------

export function buildHistory({ revenueEvents, expenses, overrides = [], settings, today, referenceMonth, months = 6 }) {
  const rows = [];
  const lastMonth = monthRange(referenceMonth);
  for (let i = months - 1; i >= 0; i -= 1) {
    const range = shiftMonth(lastMonth.start, -i);
    const expenseEvents = collectExpenseEvents(expenses, range, today, overrides);
    const summary = summarizeRange({ revenueEvents, expenseEvents, range, today, priorPending: range.end >= today ? collectPendingBefore(expenses, overrides, range.start, today) : [] });
    const monthEnd = range.end < today ? range.end : today;
    rows.push({
      month: range.start,
      label: monthLabel(range.start),
      shortLabel: `${monthLabel(range.start, false).slice(0, 3)}/${range.start.slice(2, 4)}`,
      revenueGross: summary.revenueGross,
      expenses: summary.expenses,
      profit: summary.profit,
      marginPercent: summary.marginPercent,
      cashEnd: cashAt({ settings, revenueEvents, expenses, overrides, atDate: monthEnd, today }),
      projected: summary.projected,
      isCurrent: range.start <= today && today <= range.end
    });
  }
  return rows;
}

// ---------- apontamentos (FATO → APONTAMENTO → RECOMENDAÇÃO) ----------

export function buildInsights({ pendingOverdue = [], summary, previousSummary, expenseEvents, previousExpenseEvents, allExpenseRows, reserve, cashPrevCoverage, today, range }) {
  const out = [];
  const push = (item) => out.push({ level: "info", ...item });

  // 1. Despesas OPERACIONAIS vs período anterior (repasses e nota fiscal NÃO são despesas operacionais)
  const change = percentChange(summary.operatingTotal, previousSummary?.operatingTotal);
  if (change !== null && Math.abs(change) >= 10) {
    const up = change > 0;
    push({
      id: "expenses-variation",
      level: up ? "attention" : "positive",
      fact: `As despesas operacionais ${up ? "aumentaram" : "caíram"} ${formatPercentBR(Math.abs(change), 0)} em relação ao período anterior (${formatBRL(previousSummary.operatingTotal)} → ${formatBRL(summary.operatingTotal)}).`,
      flag: up ? "Esse crescimento merece revisão." : null,
      recommendation: up ? "Confira nas categorias abaixo o que mais contribuiu e se o custo continua justificável." : null
    });
  }

  // 2. Categorias (operacionais realizadas)
  const byCategory = groupSum(expenseEvents.filter((e) => e.status === "realized"), "category");
  const prevByCategory = groupSum(previousExpenseEvents.filter((e) => e.status === "realized"), "category");
  const opTotal = Object.values(byCategory).reduce((s, v) => s + v, 0);
  if (opTotal > 0) {
    const [topName, topValue] = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
    const share = (topValue / opTotal) * 100;
    push({
      id: "top-category",
      level: share >= 40 ? "attention" : "info",
      fact: `A categoria ${topName} representa ${formatPercentBR(share, 0)} das despesas operacionais (${formatBRL(topValue)}).`,
      flag: share >= 40 ? "Concentração alta em uma única categoria." : null,
      recommendation: share >= 40 ? "Verifique se a concentração é esperada para o seu modelo de operação." : null
    });
  }
  // 3. Categorias que subiram muito (>=30% e >= R$ 100)
  for (const [name, value] of Object.entries(byCategory)) {
    const prev = prevByCategory[name];
    const pct = percentChange(value, prev);
    if (pct !== null && pct >= 30 && value - prev >= 100) {
      push({
        id: `category-up-${name}`,
        level: "attention",
        fact: `${name} aumentou ${formatPercentBR(pct, 0)} (${formatBRL(prev)} → ${formatBRL(value)}).`,
        flag: "Esse crescimento merece revisão.",
        recommendation: "Verifique se o custo continua justificável."
      });
    }
  }

  // 4. Recorrentes crescendo (equivalente mensal hoje vs no início do período anterior)
  if (previousSummary?.range) {
    const now = recurringMonthlyEquivalent(allExpenseRows, range.end < today ? range.end : today);
    const before = recurringMonthlyEquivalent(allExpenseRows, previousSummary.range.end);
    const pct = percentChange(now, before);
    if (pct !== null && pct >= 5) {
      push({
        id: "recurring-growth",
        level: "attention",
        fact: `O custo mensal recorrente passou de ${formatBRL(before)} para ${formatBRL(now)} (+${formatPercentBR(pct, 0)}).`,
        flag: "Despesas recorrentes crescem de forma permanente nos próximos meses.",
        recommendation: "Revise as assinaturas e contratos novos."
      });
    }
  }

  // 5. Extraordinárias recorrentes (>= 2 dos últimos 3 meses)
  const monthsWithExtra = [0, 1, 2].filter((n) => {
    const r = shiftMonth(range.end < today ? range.end : today, -n);
    return (allExpenseRows || []).flatMap((x) => expandExpenseOccurrences(x, r.start, r.end)).some((e) => e.expenseType === "extraordinary");
  }).length;
  if (monthsWithExtra >= 2) {
    push({
      id: "extraordinary-repeat",
      level: "attention",
      fact: `Houve despesas extraordinárias em ${monthsWithExtra} dos últimos 3 meses.`,
      flag: "Gastos extraordinários que se repetem podem ser, na prática, custos recorrentes.",
      recommendation: "Avalie reclassificá-los como fixos ou variáveis e incluí-los no planejamento."
    });
  }

  // 6. Possíveis duplicidades (mesma descrição + mesmo valor + mesma data, linhas distintas)
  const seen = new Map();
  for (const row of allExpenseRows || []) {
    if (row.isRecurring) continue;
    const key = `${normalizeText(row.description)}|${round2(toNumber(row.amount))}|${row.expenseDate}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(row);
  }
  const duplicates = [...seen.values()].filter((rows) => rows.length > 1);
  if (duplicates.length) {
    const sample = duplicates[0][0];
    push({
      id: "possible-duplicates",
      level: "attention",
      fact: `Há ${duplicates.length} grupo(s) de despesas idênticas (mesma descrição, valor e data), por exemplo "${sample.description}" de ${formatBRL(sample.amount)}.`,
      flag: "Pode ser lançamento em duplicidade (ou duas compras iguais no mesmo dia).",
      recommendation: "Confirme se são lançamentos distintos e exclua o repetido, se for o caso."
    });
  }

  // 7. Margem
  if (summary.marginPercent !== null && previousSummary?.marginPercent !== null && previousSummary?.marginPercent !== undefined) {
    const delta = round2(summary.marginPercent - previousSummary.marginPercent);
    if (Math.abs(delta) >= 5) {
      const up = delta > 0;
      push({
        id: "margin-shift",
        level: up ? "positive" : "attention",
        fact: `A margem ${up ? "melhorou" : "piorou"} ${formatPercentBR(Math.abs(delta), 1).replace("%", " p.p.")} (${formatPercentBR(previousSummary.marginPercent)} → ${formatPercentBR(summary.marginPercent)}).`,
        flag: up ? null : "Menos lucro por real recebido que no período anterior.",
        recommendation: up ? null : "Compare receita e despesas entre os períodos para localizar a causa."
      });
    }
  }

  // 8. Cobertura de caixa
  if (reserve?.coverageMonths !== null && reserve?.coverageMonths !== undefined) {
    const label = reserve.level === "healthy" ? "positive" : reserve.level === "critical" ? "critical" : "attention";
    push({
      id: "cash-coverage",
      level: label,
      fact: `O caixa atual cobre aproximadamente ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(reserve.coverageMonths)} mês(es) da operação (meta de reserva: ${reserve.reserveMonths} meses).`,
      flag: reserve.level === "healthy" ? null : "Cobertura abaixo da reserva configurada.",
      recommendation: reserve.level === "healthy" ? null : `Para atingir a reserva seriam necessários ${formatBRL(Math.max(0, reserve.recommended - reserve.cash))} adicionais.`
    });
    if (cashPrevCoverage !== null && cashPrevCoverage !== undefined && reserve.coverageMonths < cashPrevCoverage - 0.3) {
      push({
        id: "coverage-drop",
        level: "attention",
        fact: `A cobertura de caixa caiu de ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(cashPrevCoverage)} para ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(reserve.coverageMonths)} meses desde o fim do mês anterior.`,
        flag: "A reserva está diminuindo.",
        recommendation: "Acompanhe as entradas previstas para os próximos dias."
      });
    }
  }

  // 9. Projeção
  if (summary.projected) {
    push({
      id: "projection",
      level: summary.projected.result >= 0 ? "info" : "attention",
      fact: `Mantido o cenário previsto, o resultado projetado do período é ${formatBRL(summary.projected.result)} (realizado hoje: ${formatBRL(summary.profit)}).`,
      flag: summary.projected.result < 0 ? "A projeção indica resultado negativo." : null,
      recommendation: summary.projected.result < 0 ? "Verifique recebimentos atrasados e despesas previstas." : null
    });
  }

  // 9b. Despesas vencidas aguardando confirmação (não são pagas só porque a data passou)
  if (pendingOverdue.length) {
    const total = round2(pendingOverdue.reduce((sum, e) => sum + e.amount, 0));
    push({
      id: "expenses-pending-confirmation",
      level: "attention",
      fact: `${pendingOverdue.length} despesa(s) venceram e ainda não tiveram o pagamento confirmado (${formatBRL(total)}).`,
      flag: "Enquanto não forem confirmadas, não entram no realizado nem no caixa — seguem como previstas.",
      recommendation: "Confirme o pagamento (ou reagende) para o lucro e o caixa refletirem a realidade."
    });
  }

  // 10. Recebimentos atrasados
  if (summary.expectedOverdue > 0) {
    push({
      id: "overdue",
      level: "attention",
      fact: `${formatBRL(summary.expectedOverdue)} em recebimentos estão vencidos e ainda não foram marcados como recebidos.`,
      flag: "Pode ser atraso real ou recebimento ainda não lançado.",
      recommendation: "Confirme na aba Recebimentos e atualize o status."
    });
  }

  return out;
}

function groupSum(list, key) {
  const out = {};
  for (const item of list) out[item[key]] = round2((out[item[key]] || 0) + item.amount);
  return out;
}

function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------- estimativa (rotulada, separada do previsto) ----------
// ESTIMATIVA: despesas VARIÁVEIS ainda não lançadas no mês = média dos 3 meses
// anteriores − variáveis já realizadas no mês (mínimo 0). Não entra em `projected`.
export function estimateRemainingVariable({ expenses, overrides = [], range, today }) {
  if (!(range.start <= today && today <= range.end)) return null;
  const months = [1, 2, 3].map((n) => shiftMonth(range.start, -n));
  const variableOf = (r) => collectExpenseEvents(expenses, r, today, overrides)
    .filter((e) => e.expenseType === "variable").reduce((s, e) => s + e.amount, 0);
  const average = months.reduce((s, r) => s + variableOf(r), 0) / 3;
  if (average <= 0) return null;
  const sofar = variableOf({ start: range.start, end: range.end });
  return { average3m: round2(average), alreadyInMonth: round2(sofar), remaining: round2(Math.max(0, average - sofar)) };
}

// ---------- orquestração ----------

export function computeHealth({ sales = [], expenses = [], overrides = [], settings = {}, today, period = "month", custom = {}, referenceMonth = null }) {
  const cfg = { ...DEFAULT_HEALTH_SETTINGS, ...settings };
  const range = rangeFromPeriod(period, today, custom);
  const prevRange = previousRange(range);
  const { events: revenueEvents, undatedReceived, undatedExpected } = collectRevenueEvents(sales, today);

  const expenseEvents = collectExpenseEvents(expenses, range, today, overrides);
  const previousExpenseEvents = collectExpenseEvents(expenses, prevRange, today, overrides);
  const priorOf = (r) => (r.end >= today ? collectPendingBefore(expenses, overrides, r.start, today) : []);
  const summary = summarizeRange({ revenueEvents, expenseEvents, range, today, priorPending: priorOf(range) });
  const previousSummary = summarizeRange({ revenueEvents, expenseEvents: previousExpenseEvents, range: prevRange, today, priorPending: priorOf(prevRange) });

  const cash = cashAt({ settings: cfg, revenueEvents, expenses, overrides, atDate: today, today });
  const cost = monthlyOperatingCost({ expenses, overrides, today });
  const reserve = evaluateReserve({ cash, monthlyCost: cost.value, settings: cfg });
  const lastMonthEnd = shiftMonth(today, -1).end;
  const cashPrev = cashAt({ settings: cfg, revenueEvents, expenses, overrides, atDate: lastMonthEnd, today });
  const cashPrevCoverage = cashPrev !== null && cost.value > 0 ? round2(cashPrev / cost.value) : null;

  const refMonth = referenceMonth || (period === "custom" || period === "quarter" || period === "year"
    ? monthRange(range.end < today ? range.end : today).start
    : range.start);
  const refWindow = { start: shiftMonth(refMonth, -1).start, end: monthRange(refMonth).end };
  const expenseEventsRef = [
    ...collectExpenseEvents(expenses, refWindow, today, overrides),
    // vencidas não confirmadas de antes da janela: aparecem na PROJEÇÃO do mês atual (nunca no realizado)
    ...(monthRange(refMonth).start === monthRange(today).start ? collectPendingBefore(expenses, overrides, refWindow.start, today) : [])
  ];

  const pendingOverdue = collectPendingBefore(expenses, overrides, addDays(today, 1), today).filter((e) => e.overdue);
  const be = breakEven({ revenueEvents, expenseEvents, range, today, summary });
  const currentMonth = monthRange(today);
  const estimate = estimateRemainingVariable({ expenses, overrides, range: currentMonth, today });
  // Expectativa do MÊS ATUAL (independe do período selecionado): realizado + previsto, separados.
  const currentSummary = summarizeRange({ revenueEvents, expenseEvents: collectExpenseEvents(expenses, currentMonth, today, overrides), range: currentMonth, today, priorPending: priorOf(currentMonth) });
  const expectation = {
    available: true,
    monthStart: currentMonth.start,
    received: currentSummary.revenueGross,
    expectedRevenue: currentSummary.expectedGross,
    overdue: currentSummary.expectedOverdue,
    forecastIncluded: round2(revenueEvents.filter((e) => e.kind === "expected" && e.source === "forecast" && inRange(e.date, currentMonth)).reduce((sum, e) => sum + e.gross, 0)),
    expensesRealized: currentSummary.expenses,
    expensesPlanned: round2(currentSummary.expectedSaleCosts + currentSummary.plannedOperating),
    operatingPlanned: currentSummary.plannedOperating,
    operatingOverdue: currentSummary.overdueOperating,
    pendingPrior: currentSummary.pendingPriorAmount,
    projectedRevenue: currentSummary.projected.revenueGross,
    result: currentSummary.projected.result
  };

  return {
    today,
    range,
    previousRange: prevRange,
    settings: cfg,
    cashConfigured: hasCashConfig(cfg),
    summary,
    previousSummary,
    changes: {
      revenue: percentChange(summary.revenueGross, previousSummary.revenueGross),
      expenses: percentChange(summary.expenses, previousSummary.expenses),
      repasses: percentChange(summary.repasses, previousSummary.repasses),
      invoice: percentChange(summary.invoice, previousSummary.invoice),
      operating: percentChange(summary.operatingTotal, previousSummary.operatingTotal),
      profit: percentChange(summary.profit, previousSummary.profit > 0 ? previousSummary.profit : 0),
      marginDeltaPoints: summary.marginPercent !== null && previousSummary.marginPercent !== null ? round2(summary.marginPercent - previousSummary.marginPercent) : null
    },
    cash,
    operatingCost: cost,
    reserve,
    breakEven: be,
    byBroker: resultByBroker(revenueEvents, range),
    evolution: buildEvolution({ revenueEvents, expenseEvents: expenseEventsRef, referenceMonth: refMonth, today }),
    history: buildHistory({ revenueEvents, expenses, overrides, settings: cfg, today, referenceMonth: refMonth, months: 6 }),
    estimate,
    expectation,
    currentSummary,
    insights: buildInsights({ pendingOverdue, summary, previousSummary, expenseEvents, previousExpenseEvents, allExpenseRows: expenses, reserve, cashPrevCoverage, today, range }),
    expenseBreakdown: Object.entries(groupSum(expenseEvents.filter((e) => e.status === "realized"), "category"))
      .map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    dataQuality: { undatedReceived, undatedExpected }
  };
}
