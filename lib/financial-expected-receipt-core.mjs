// Regras puras (sem banco, sem React) da PREVISÃO DE RECEBIMENTO da comissão.
// Usado pelo servidor (lib/financial-expected-receipt.js), pelo Financeiro (client) e pelos testes
// (tests/financial-expected-receipt.test.mjs).
//
// Três datas diferentes, nunca misturar:
//   sale_date                         → data da venda
//   financial_sales.expected_receipt_date → PREVISÃO de entrada do saldo da comissão (aqui)
//   financial_payments.received_date  → data REAL em que o dinheiro entrou
// A previsão nunca vira recebimento sozinha: só a confirmação humana cria o pagamento.

export const EXPECTED_RECEIPT_ACTIVITY_TYPE = "recebimento";
const SAO_PAULO_OFFSET = "-03:00";
const REMINDER_TIME = "09:00";

export const toCents = (value) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
};
const fromCents = (cents) => Math.round(cents) / 100;

export function isValidDateKey(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const isClosed = (status) => status === "received" || status === "cancelled";

// Saldo previsto: o que ainda falta receber da comissão LIVRE e que NÃO está coberto por parcelas já
// datadas (essas entram nos indicadores por conta própria, com a data delas — não pode contar duas vezes).
// Venda recebida/cancelada nunca tem previsão. Parcela sem data não abate: ela não aparece em nenhum
// indicador, então o saldo continua sendo "a receber" na data da previsão.
export function computeForecastAmount({ freeCommission = 0, financialStatus = "pending", payments = [] } = {}) {
  if (isClosed(financialStatus)) return 0;
  const list = Array.isArray(payments) ? payments : [];
  const receivedCents = list
    .filter((payment) => payment?.status === "received")
    .reduce((sum, payment) => sum + toCents(payment.amount), 0);
  const scheduledOpenCents = list
    .filter((payment) => (payment?.status === "expected" || payment?.status === "overdue") && isValidDateKey(payment?.expectedDate ?? payment?.expected_date))
    .reduce((sum, payment) => sum + toCents(payment.amount), 0);
  return fromCents(Math.max(0, toCents(freeCommission) - receivedCents - scheduledOpenCents));
}

// ---------- Indicadores do Financeiro ----------

const parseDateKey = (value) => {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return null;
  const [year, month, day] = text.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
};
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const between = (value, start, end) => {
  const date = value instanceof Date ? startOfDay(value) : parseDateKey(value);
  return Boolean(date) && date >= startOfDay(start) && date <= startOfDay(end);
};

// Previsão da venda como uma "linha de recebimento" (mesmo formato das parcelas) para a Agenda de
// recebimentos e para os indicadores. null quando não há previsão válida ou saldo.
export function buildForecastEntry(sale = {}, freeCommission = 0) {
  if (!isValidDateKey(sale.expectedReceiptDate)) return null;
  const amount = computeForecastAmount({ freeCommission, financialStatus: sale.financialStatus, payments: sale.payments });
  if (!(amount > 0)) return null;
  return {
    key: `${sale.id}-forecast`,
    id: "",
    saleId: sale.id,
    clientName: sale.clientName || "Cliente sem nome",
    propertyName: sale.propertyName || "",
    installmentNumber: null,
    amount,
    expectedDate: sale.expectedReceiptDate,
    receivedDate: "",
    status: "expected",
    isForecast: true
  };
}

// Entradas de uma venda para os indicadores: parcelas cadastradas + previsão do saldo.
export function flattenReceivableEntries(sales = [], getFreeCommission = () => 0) {
  const entries = [];
  for (const sale of sales) {
    (Array.isArray(sale.payments) ? sale.payments : []).forEach((payment, index) => {
      entries.push({
        ...payment,
        key: `${sale.id}-${payment.id || index}`,
        clientName: sale.clientName || "Cliente sem nome",
        propertyName: sale.propertyName || "",
        saleId: sale.id
      });
    });
    const forecast = buildForecastEntry(sale, getFreeCommission(sale));
    if (forecast) entries.push(forecast);
  }
  return entries.sort((a, b) => (parseDateKey(a.expectedDate)?.getTime() || 0) - (parseDateKey(b.expectedDate)?.getTime() || 0));
}

const isOpenEntry = (entry) => entry.status !== "received" && entry.status !== "cancelled";

// "Recebido" = SOMENTE pagamento confirmado (status received) com data real no mês. Previsão nunca conta
// como recebida. "A receber" = não recebido e não cancelado, pela data prevista.
export function calculateReceivableMetrics(entries = [], now = new Date()) {
  const today = startOfDay(now);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const sum = (items) => fromCents(items.reduce((total, entry) => total + toCents(entry.amount), 0));
  const open = entries.filter(isOpenEntry);
  const within = (days) => {
    const end = new Date(today);
    end.setDate(end.getDate() + days);
    return sum(open.filter((entry) => between(entry.expectedDate, today, end)));
  };
  return {
    expectedThisMonth: sum(open.filter((entry) => between(entry.expectedDate, monthStart, monthEnd))),
    receivedThisMonth: sum(entries.filter((entry) => entry.status === "received" && between(entry.receivedDate, monthStart, monthEnd))),
    next30: within(30),
    next60: within(60),
    next90: within(90),
    // Previsões/parcelas de meses anteriores que ninguém confirmou: não somem dos indicadores.
    overdueBeforeMonth: sum(open.filter((entry) => {
      const date = parseDateKey(entry.expectedDate);
      return Boolean(date) && date < monthStart;
    }))
  };
}

// ---------- Atividade na Agenda ----------

export function scheduledAtForDate(dateKey) {
  if (!isValidDateKey(dateKey)) return null;
  return new Date(`${dateKey}T${REMINDER_TIME}:00${SAO_PAULO_OFFSET}`).toISOString();
}

const MONEY = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatDateKey = (dateKey) => {
  const [year, month, day] = String(dateKey).split("-");
  return `${day}/${month}/${year}`;
};

export function buildActivityTexts({ clientName = "", propertyName = "", amount = 0, expectedDate = "" } = {}) {
  const name = String(clientName || "Cliente").trim() || "Cliente";
  const parts = [`Confirmar recebimento — ${name}`, MONEY.format(amount)];
  if (String(propertyName || "").trim()) parts.push(String(propertyName).trim());
  parts.push(`Previsão: ${formatDateKey(expectedDate)}`);
  return {
    title: `Confirmar recebimento — ${name}`.slice(0, 160),
    note: parts.slice(1).join(" · ").slice(0, 500)
  };
}

// Decide o que fazer com a atividade "Confirmar recebimento" de uma venda. Idempotente: com a atividade
// já certa devolve "none" (rodar de novo não escreve nada). `activity` = a atividade ABERTA (pending)
// da venda, ou null.
//   venda recebida            → conclui a atividade aberta (o dinheiro já entrou)
//   cancelada / sem previsão / sem saldo → remove a atividade aberta (nada a confirmar)
//   com previsão e saldo      → cria, ou reagenda/atualiza a MESMA atividade (nunca duplica)
export function planActivitySync({ financialStatus = "pending", expectedReceiptDate = "", forecastAmount = 0, texts = {}, activity = null } = {}) {
  const scheduledAt = scheduledAtForDate(expectedReceiptDate);
  const wantsActivity = !isClosed(financialStatus) && Boolean(scheduledAt) && forecastAmount > 0;

  if (!wantsActivity) {
    if (!activity) return { action: "none" };
    return { action: financialStatus === "received" ? "complete" : "delete" };
  }

  if (!activity) return { action: "create", scheduledAt, title: texts.title, note: texts.note };

  const sameMoment = new Date(activity.scheduledAt).getTime() === new Date(scheduledAt).getTime();
  if (sameMoment && activity.title === texts.title && (activity.note || "") === texts.note) return { action: "none" };
  return { action: "update", scheduledAt, title: texts.title, note: texts.note, rescheduled: !sameMoment };
}

// ---------- Confirmação de recebimento (total ou parcial) ----------

export function planConfirmation({ forecastAmount = 0, freeCommission = 0, receivedTotal = 0, amount = null, nextExpectedDate = "" } = {}) {
  const forecastCents = toCents(forecastAmount);
  if (forecastCents <= 0) return { ok: false, error: "Não há saldo previsto para confirmar nesta venda." };

  const hasAmount = amount !== null && amount !== undefined && String(amount).trim() !== "";
  const amountCents = hasAmount ? toCents(amount) : forecastCents;
  if (amountCents <= 0) return { ok: false, error: "Informe um valor recebido maior que zero." };
  if (amountCents > forecastCents) {
    return { ok: false, error: `O valor recebido não pode ser maior que o saldo previsto (${MONEY.format(fromCents(forecastCents))}).` };
  }

  const receivedAfterCents = toCents(receivedTotal) + amountCents;
  const fullyReceived = receivedAfterCents >= toCents(freeCommission);
  const nextDate = !fullyReceived && isValidDateKey(nextExpectedDate) ? String(nextExpectedDate).trim() : null;

  return {
    ok: true,
    paymentAmount: fromCents(amountCents),
    receivedAfter: fromCents(receivedAfterCents),
    remaining: fromCents(Math.max(0, toCents(freeCommission) - receivedAfterCents)),
    status: fullyReceived ? "received" : "partial",
    // Recebimento total encerra a previsão. Parcial: o saldo só ganha nova previsão se uma data válida foi informada.
    nextExpectedDate: nextDate
  };
}
