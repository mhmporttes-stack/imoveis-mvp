// Financeiro > Saúde — fixtures 100% fictícias para a vitrine (somente `next dev`).
// Formato de `health` entregue por app/admin/financeiro/page.jsx (expenses, occurrences, settings, today)
// e das respostas de /api/financeiro/saude/** (lib/financial-health.js). Datas relativas a hoje, para a tela
// sempre mostrar vencidas, a vencer e previstas. Nada vem do banco; os POST/PATCH só mudam a memória da página.
//
// Variantes (?variante=): "" normal · "semcaixa" (caixa não configurado) · "vazio" (nenhuma conta cadastrada).

import { addDays, addMonthsClamped, forecastAmountFor, monthRange, saoPauloToday } from "@/lib/financial-health-core.mjs";

const TODAY = saoPauloToday();
const MONTH = monthRange(TODAY);

const dueSoonDate = addDays(TODAY, 3);
const energyBase = addDays(TODAY, -9);
const aiDate = addDays(TODAY, 6);
const accountingDate = MONTH.end;

const E = {
  rent: "00000000-0000-4000-8000-000000000001",
  energy: "00000000-0000-4000-8000-000000000002",
  ai: "00000000-0000-4000-8000-000000000003",
  accounting: "00000000-0000-4000-8000-000000000004",
  coffee: "00000000-0000-4000-8000-000000000005",
  aircon: "00000000-0000-4000-8000-000000000006",
  mouse: "00000000-0000-4000-8000-000000000007"
};

const expenses = [
  { id: E.rent, description: "Aluguel da sala", category: "Aluguel", expenseType: "fixed", amountMode: "fixed", amount: 2800, expenseDate: addMonthsClamped(dueSoonDate, -4), isRecurring: true, recurrencePeriod: "monthly", recurrenceEndDate: null, note: "" },
  { id: E.energy, description: "Energia elétrica", category: "Energia", expenseType: "fixed", amountMode: "variable", amount: 640, expenseDate: addMonthsClamped(energyBase, -3), isRecurring: true, recurrencePeriod: "monthly", recurrenceEndDate: null, note: "" },
  { id: E.ai, description: "Assinaturas de IA", category: "Assinaturas de IA (Claude, GPT)", expenseType: "fixed", amountMode: "fixed", amount: 549, expenseDate: addMonthsClamped(aiDate, -2), isRecurring: true, recurrencePeriod: "monthly", recurrenceEndDate: null, note: "" },
  { id: E.accounting, description: "Contabilidade", category: "Contabilidade", expenseType: "fixed", amountMode: "fixed", amount: 450, expenseDate: addMonthsClamped(accountingDate, -3), isRecurring: true, recurrencePeriod: "monthly", recurrenceEndDate: null, note: "" },
  { id: E.coffee, description: "Galão d'água e café", category: "Copa e limpeza", expenseType: "variable", amountMode: "fixed", amount: 85, expenseDate: addDays(TODAY, -2), isRecurring: false, recurrencePeriod: null, recurrenceEndDate: null, note: "" },
  { id: E.aircon, description: "Manutenção do ar-condicionado", category: "Manutenção", expenseType: "extraordinary", amountMode: "fixed", amount: 380, expenseDate: addDays(TODAY, 2), isRecurring: false, recurrencePeriod: null, recurrenceEndDate: null, note: "" },
  { id: E.mouse, description: "Mouse e teclado", category: "Equipamentos", expenseType: "variable", amountMode: "fixed", amount: 210, expenseDate: MONTH.start, isRecurring: false, recurrencePeriod: null, recurrenceEndDate: null, note: "" }
];

const paid = (expenseId, occurrenceDate, paidAmount, expectedAmount, paidDate = occurrenceDate) => ({ expenseId, occurrenceDate, status: "paid", paidDate, paidAmount, expectedAmount, rescheduledTo: null });

const occurrences = [
  ...[-4, -3, -2, -1].map((k) => { const d = addMonthsClamped(dueSoonDate, k); return paid(E.rent, d, 2800, 2800); }),
  paid(E.energy, addMonthsClamped(energyBase, -3), 612.4, 640),
  paid(E.energy, addMonthsClamped(energyBase, -2), 688.15, 612.4),
  paid(E.energy, addMonthsClamped(energyBase, -1), 731.9, 688.15),
  ...[-2, -1].map((k) => paid(E.ai, addMonthsClamped(aiDate, k), 549, 549)),
  ...[-3, -2, -1].map((k) => paid(E.accounting, addMonthsClamped(accountingDate, k), 450, 450)),
  paid(E.mouse, MONTH.start, 189.9, 210)
];

const sale = (id, brokerName, gross, totals, payments, extra = {}) => ({
  id, brokerId: `vitrine-${brokerName.split(" ")[0].toLowerCase()}`, brokerName, financialStatus: payments.every((p) => p.status === "received") ? "received" : "partial",
  grossCommission: gross, totals: { grossCommission: gross, ...totals }, expenses: [], payments, expectedReceiptDate: "", ...extra
});

const sales = [
  sale("venda-1", "Ana Souza", 12000, { invoiceDeduction: 720, managerCommission: 1128, brokerCommission: 5076, agencyCommission: 5076 }, [{ amount: 12000, status: "received", receivedDate: MONTH.start }]),
  sale("venda-2", "Bruno Lima", 8400, { invoiceDeduction: 504, managerCommission: 0, brokerCommission: 3948, agencyCommission: 3948 }, [{ amount: 8400, status: "received", receivedDate: addDays(addMonthsClamped(MONTH.start, -1), 11) }]),
  sale("venda-3", "Carla Mendes", 15000, { invoiceDeduction: 1500, managerCommission: 1350, brokerCommission: 6075, agencyCommission: 6075 }, [{ amount: 15000, status: "received", receivedDate: addDays(addMonthsClamped(MONTH.start, -2), 8) }]),
  sale("venda-4", "Ana Souza", 9600, { invoiceDeduction: 576, managerCommission: 902.4, brokerCommission: 4060.8, agencyCommission: 4060.8 }, [
    { amount: 4800, status: "received", receivedDate: addDays(addMonthsClamped(MONTH.start, -3), 9) },
    { amount: 4800, status: "expected", expectedDate: addDays(TODAY, 5) }
  ]),
  { ...sale("venda-5", "Diego Rocha", 7000, { invoiceDeduction: 420, managerCommission: 658, brokerCommission: 2961, agencyCommission: 2961 }, []), financialStatus: "pending", expectedReceiptDate: MONTH.end }
];

const eligibleBrokers = ["Ana Souza", "Bruno Lima", "Carla Mendes", "Diego Rocha", "Elisa Prado"].map((name) => ({ id: `vitrine-${name.split(" ")[0].toLowerCase()}`, name, email: "" }));

const settings = { openingCashBalance: 15000, openingCashDate: addMonthsClamped(MONTH.start, -4), reserveMonths: 3, criticalMonths: 1 };

export function propsFor(variante = "") {
  return {
    sales,
    initialExpenses: variante === "vazio" ? [] : expenses,
    initialOccurrences: variante === "vazio" ? [] : occurrences,
    initialSettings: variante === "semcaixa" ? { ...settings, openingCashBalance: null, openingCashDate: "" } : settings,
    eligibleBrokers,
    today: TODAY
  };
}

// ---- API fictícia (memória da página) ----

const state = { expenses: [...expenses], occurrences: [...occurrences] };
const readBody = (init) => { try { return JSON.parse(init?.body || "{}"); } catch { return {}; } };
const money = (value) => {
  const raw = String(value ?? "").replace(/[^\d,.-]/g, "");
  const n = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export const routes = [
  { match: /^\/api\/financeiro\/saude\/despesas$/, response: () => ({ expenses: state.expenses }) },
  { match: /^\/api\/financeiro\/saude\/ocorrencias$/, response: () => ({ occurrences: state.occurrences }) },
  {
    method: "POST",
    match: /^\/api\/financeiro\/saude\/despesas$/,
    status: 201,
    response: ({ init }) => {
      const b = readBody(init);
      const row = {
        id: `mock-${Date.now()}`, description: b.description, category: b.category, expenseType: b.expenseType, amountMode: b.amountMode === "variable" ? "variable" : "fixed",
        amount: money(b.amount), expenseDate: b.expenseDate, isRecurring: Boolean(b.isRecurring), recurrencePeriod: b.isRecurring ? b.recurrencePeriod : null,
        recurrenceEndDate: b.isRecurring ? b.recurrenceEndDate || null : null, note: b.note || ""
      };
      state.expenses = [row, ...state.expenses];
      return row;
    }
  },
  {
    method: "PATCH",
    match: /^\/api\/financeiro\/saude\/despesas\/[^/]+$/,
    response: ({ url, init }) => {
      const id = url.pathname.split("/").pop();
      const b = readBody(init);
      const current = state.expenses.find((e) => e.id === id) || {};
      const next = { ...current, ...b, id, amount: b.amount === undefined ? current.amount : money(b.amount) };
      state.expenses = state.expenses.map((e) => (e.id === id ? next : e));
      return next;
    }
  },
  {
    method: "DELETE",
    match: /^\/api\/financeiro\/saude\/despesas\/[^/]+$/,
    response: ({ url }) => {
      const id = url.pathname.split("/").pop();
      state.expenses = state.expenses.filter((e) => e.id !== id);
      return { ok: true };
    }
  },
  {
    method: "POST",
    match: /^\/api\/financeiro\/saude\/despesas\/[^/]+\/ocorrencias$/,
    response: ({ url, init }) => {
      const expenseId = url.pathname.split("/")[5];
      const b = readBody(init);
      const expense = state.expenses.find((e) => e.id === expenseId) || {};
      let row;
      if (b.action === "pay") {
        const expected = forecastAmountFor(expense, b.occurrenceDate, state.occurrences.filter((o) => o.expenseId === expenseId && o.status === "paid"));
        row = { expenseId, occurrenceDate: b.occurrenceDate, status: "paid", paidDate: b.paidDate || TODAY, paidAmount: b.paidAmount ? money(b.paidAmount) : expected, expectedAmount: expected, rescheduledTo: null };
      } else if (b.action === "reschedule") {
        row = { expenseId, occurrenceDate: b.occurrenceDate, status: "pending", paidDate: null, paidAmount: null, expectedAmount: null, rescheduledTo: b.rescheduledTo === b.occurrenceDate ? null : b.rescheduledTo };
      } else {
        row = { expenseId, occurrenceDate: b.occurrenceDate, status: "pending", paidDate: null, paidAmount: null, expectedAmount: null, rescheduledTo: null };
      }
      state.occurrences = [...state.occurrences.filter((o) => !(o.expenseId === expenseId && o.occurrenceDate === b.occurrenceDate)), row];
      return row;
    }
  },
  {
    method: "PUT",
    match: /^\/api\/financeiro\/saude$/,
    response: ({ init }) => {
      const b = readBody(init);
      return { settings: { openingCashBalance: b.openingCashBalance === "" ? null : money(b.openingCashBalance), openingCashDate: b.openingCashDate || "", reserveMonths: money(b.reserveMonths) || 3, criticalMonths: money(b.criticalMonths) || 1 } };
    }
  }
];
