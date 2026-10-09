"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, Clock3, MoreHorizontal, Pencil, Plus, Receipt, RefreshCw, StopCircle, Trash2, Undo2, Wallet } from "lucide-react";
import {
  OPERATING_EXPENSE_CATEGORIES,
  OPERATING_EXPENSE_TYPES,
  RECURRENCE_PERIODS,
  buildExpensePanel,
  collectExpenseEvents,
  inRange
} from "@/lib/financial-health-core.mjs";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Menu from "@/components/ui/Menu";
import Sheet from "@/components/ui/Sheet";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { cx } from "@/components/ui/cx";
import { formatMoney } from "@/components/FinancialHealthCharts";
import { SelectInput, TextInput, formatDate, formatShortDate, fmtNumber, moneyToInput, parseMoney, round2 } from "@/components/FinancialHealthUi";

// "Contas a pagar" da aba Saúde (só admin geral — a aba só é montada para ele e o servidor valida cada rota).
// Todo cálculo vem de lib/financial-health-core.mjs (buildExpensePanel, collectExpenseEvents): aqui é só interface.

const EMPTY_FORM = {
  id: "",
  description: "",
  category: "Outros",
  expenseType: "variable",
  amountMode: "fixed",
  amount: "",
  expenseDate: "",
  isRecurring: false,
  recurrencePeriod: "monthly",
  recurrenceEndDate: "",
  note: "",
  natureTouched: false,
  showPaid: false,
  paidAmount: "",
  paidDate: ""
};

const HEADERS = { "Content-Type": "application/json" };

function friendly(error, fallback) {
  if (error instanceof TypeError) return "Sem conexão com o servidor. Confira a internet e tente de novo.";
  return error?.message || fallback;
}

function daysWord(n) {
  return `${n} ${n === 1 ? "dia" : "dias"}`;
}

/* ---------- estado e ações (hook) ---------- */

export function useHealthAccounts({ expenses, occurrences, today, range, onExpensesChange, onOccurrencesChange, notify }) {
  const [filter, setFilter] = useState("toPay"); // toPay | overdue | week | paid
  const [showAll, setShowAll] = useState(false);
  const [payItem, setPayItem] = useState(null);
  const [rescheduleItem, setRescheduleItem] = useState(null);
  const [form, setForm] = useState(null);
  const [confirmAction, confirmElement] = useConfirm();

  const panel = useMemo(() => buildExpensePanel({ expenses, overrides: occurrences, today, range }), [expenses, occurrences, today, range]);
  const paidList = useMemo(
    () => collectExpenseEvents(expenses, range, today, occurrences)
      .filter((e) => e.status === "realized" && inRange(e.date, range))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => ({
        expenseId: e.expenseId, occurrenceDate: e.originalDate, dueDate: e.dueDate, description: e.description, category: e.category,
        expenseType: e.expenseType, amountMode: e.amountMode, expectedAmount: e.expectedAmount, paidAmount: e.paidAmount, paidDate: e.paidDate,
        status: "paid", statusLabel: "Paga", daysOverdue: 0, daysToDue: 0, rescheduled: e.rescheduled, recurring: e.recurring
      })),
    [expenses, occurrences, today, range]
  );

  function changeFilter(next) {
    setFilter(next);
    setShowAll(false);
  }

  function mergeOccurrence(payload) {
    onOccurrencesChange((current) => [...current.filter((o) => !(o.expenseId === payload.expenseId && o.occurrenceDate === payload.occurrenceDate)), payload]);
  }

  async function postOccurrence(expenseId, occurrenceDate, body) {
    const response = await fetch(`/api/financeiro/saude/despesas/${expenseId}/ocorrencias`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ occurrenceDate, ...body })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível salvar.");
    mergeOccurrence(payload);
    return payload;
  }

  async function undoPaid(item) {
    try {
      await postOccurrence(item.expenseId, item.occurrenceDate, { action: "undo" });
      notify(`Pagamento desfeito: "${item.description}" voltou a ser prevista.`);
    } catch (error) {
      notify(friendly(error, "Não foi possível desfazer o pagamento."), "danger");
    }
  }

  // Devolve "" em caso de sucesso ou a mensagem de erro (mostrada dentro da folha aberta).
  async function confirmPay(item, { paidDate, paidAmount }, { silent = false } = {}) {
    try {
      await postOccurrence(item.expenseId, item.occurrenceDate, { action: "pay", paidDate, paidAmount });
      setPayItem(null);
      if (!silent) notify(`Pagamento confirmado: ${item.description}.`, "success", { label: "Desfazer", onClick: () => undoPaid(item) });
      return "";
    } catch (error) {
      return friendly(error, "Não foi possível confirmar o pagamento.");
    }
  }

  async function confirmReschedule(item, rescheduledTo) {
    try {
      await postOccurrence(item.expenseId, item.occurrenceDate, { action: "reschedule", rescheduledTo });
      setRescheduleItem(null);
      notify(`Conta reagendada para ${formatDate(rescheduledTo)}.`);
      return "";
    } catch (error) {
      return friendly(error, "Não foi possível reagendar.");
    }
  }

  async function reload() {
    const [expensesResponse, occurrencesResponse] = await Promise.all([fetch("/api/financeiro/saude/despesas"), fetch("/api/financeiro/saude/ocorrencias")]);
    const expensesPayload = await expensesResponse.json().catch(() => ({}));
    const occurrencesPayload = await occurrencesResponse.json().catch(() => ({}));
    if (expensesResponse.ok) onExpensesChange(expensesPayload.expenses || []);
    if (occurrencesResponse.ok) onOccurrencesChange(occurrencesPayload.occurrences || []);
  }

  // Cadastro/edição. Devolve "" ou o erro (exibido na própria gaveta).
  async function saveForm(current) {
    const editing = Boolean(current.id);
    const body = {
      description: current.description,
      category: current.category,
      expenseType: current.expenseType,
      amountMode: current.isRecurring ? current.amountMode : "fixed",
      amount: current.amount,
      expenseDate: current.expenseDate,
      isRecurring: current.isRecurring,
      recurrencePeriod: current.recurrencePeriod,
      recurrenceEndDate: current.isRecurring ? current.recurrenceEndDate || null : null,
      note: current.note,
      effectiveFrom: current.effectiveFrom || undefined
    };
    let saved;
    try {
      const response = await fetch(editing ? `/api/financeiro/saude/despesas/${current.id}` : "/api/financeiro/saude/despesas", {
        method: editing ? "PATCH" : "POST",
        headers: HEADERS,
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar a conta.");
      saved = payload;
      if (editing && current.wasRecurring) await reload();
      else onExpensesChange((list) => (editing ? list.map((e) => (e.id === saved.id ? saved : e)) : [saved, ...list]));
    } catch (error) {
      return friendly(error, "Não foi possível salvar a conta.");
    }
    setForm(null);
    if (editing) {
      notify(current.wasRecurring ? `Conta atualizada. A mudança vale a partir de ${formatDate(current.effectiveFrom || today)}; os meses anteriores foram preservados.` : "Conta atualizada.");
      return "";
    }
    if (current.showPaid) {
      // Mesmo caminho de "Marcar como paga": a primeira ocorrência (o vencimento) é paga em seguida.
      const error = await confirmPay(
        { expenseId: saved.id, occurrenceDate: saved.expenseDate, description: saved.description },
        current.mode === "spend" ? { paidDate: current.expenseDate, paidAmount: current.amount } : { paidDate: current.paidDate || today, paidAmount: current.paidAmount || current.amount },
        { silent: true }
      );
      if (error) {
        notify(`${current.mode === "spend" ? "Gasto cadastrado" : "Conta cadastrada"}, mas o pagamento não foi registrado: ${error} Use "Marcar como paga" na lista.`, "danger");
      } else {
        notify(current.mode === "spend" ? `Gasto registrado no custo do mês: ${saved.description}.` : `Conta cadastrada e já marcada como paga: ${saved.description}.`, "success", { label: "Desfazer", onClick: () => undoPaid({ expenseId: saved.id, occurrenceDate: saved.expenseDate, description: saved.description }) });
      }
      return "";
    }
    notify("Conta cadastrada.");
    return "";
  }

  async function removeExpense(expense) {
    const ok = await confirmAction({
      title: `Excluir "${expense.description}"?`,
      description: expense.isRecurring
        ? "Isso remove TODOS os meses (passados e futuros) desta conta recorrente. Para preservar o histórico, use \"Encerrar\" em vez de excluir."
        : "A conta será removida.",
      confirmLabel: "Excluir",
      tone: "danger"
    });
    if (!ok) return;
    try {
      const response = await fetch(`/api/financeiro/saude/despesas/${expense.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível excluir.");
      onExpensesChange((list) => list.filter((e) => e.id !== expense.id));
      notify("Conta excluída.");
    } catch (error) {
      notify(friendly(error, "Não foi possível excluir."), "danger");
    }
  }

  async function endRecurrence(expense) {
    const end = today < expense.expenseDate ? expense.expenseDate : today;
    const ok = await confirmAction({
      title: `Encerrar "${expense.description}" em ${formatDate(end)}?`,
      description: "Os meses anteriores continuam no histórico e nenhum mês novo será cobrado.",
      confirmLabel: "Encerrar"
    });
    if (!ok) return;
    try {
      const response = await fetch(`/api/financeiro/saude/despesas/${expense.id}`, {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({ isRecurring: true, recurrencePeriod: expense.recurrencePeriod, recurrenceEndDate: end })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível encerrar.");
      onExpensesChange((list) => list.map((e) => (e.id === payload.id ? payload : e)));
      notify("Recorrência encerrada.");
    } catch (error) {
      notify(friendly(error, "Não foi possível encerrar."), "danger");
    }
  }

  // "Nova conta" (pedido do dono, 2026-10-09) = conta que vem todo mês: começa como recorrente/fixa (ainda dá para trocar para Única).
  function openNew() {
    setForm({ ...EMPTY_FORM, isRecurring: true, expenseType: "fixed" });
  }

  // "Novo gasto" = algo que já foi gasto, esporádico: despesa única, variável, registrada JÁ PAGA na data do gasto
  // (o próprio cadastro é a confirmação manual do pagamento — mesmo caminho do "Já foi paga?" da Nova conta).
  function openSpend() {
    setForm({ ...EMPTY_FORM, mode: "spend", isRecurring: false, expenseType: "variable", expenseDate: today, showPaid: true, natureTouched: true });
  }

  function openEdit(expense) {
    if (!expense) return;
    setForm({
      ...EMPTY_FORM,
      ...expense,
      amount: moneyToInput(expense.amount),
      amountMode: expense.amountMode || "fixed",
      recurrenceEndDate: expense.recurrenceEndDate || "",
      recurrencePeriod: expense.recurrencePeriod || "monthly",
      note: expense.note || "",
      wasRecurring: expense.isRecurring,
      effectiveFrom: expense.isRecurring ? today : "",
      natureTouched: true
    });
  }

  const sheets = (
    <>
      <PaySheet item={payItem} today={today} onClose={() => setPayItem(null)} onConfirm={confirmPay} />
      <RescheduleSheet item={rescheduleItem} today={today} onClose={() => setRescheduleItem(null)} onConfirm={confirmReschedule} />
      <ExpenseSheet form={form} setForm={setForm} today={today} onSave={saveForm} />
      {confirmElement}
    </>
  );

  return {
    expenses, today, range, panel, paidList, filter, changeFilter, showAll, setShowAll,
    openNew, openSpend, openEdit, openPay: setPayItem, openReschedule: setRescheduleItem, undoPaid, removeExpense, endRecurrence, sheets
  };
}

/* ---------- painel "Contas a pagar" ---------- */

const TOTAL_TONES = {
  danger: { icon: AlertTriangle, iconCls: "bg-danger-soft text-danger", valueCls: "text-danger" },
  warning: { icon: Clock3, iconCls: "bg-warning-soft text-warning", valueCls: "text-warning" },
  info: { icon: Wallet, iconCls: "bg-info-soft text-info", valueCls: "text-navy" },
  success: { icon: CheckCircle2, iconCls: "bg-success-soft text-success", valueCls: "text-ink" }
};

export function AccountsPanel({ acc, periodLabel }) {
  const { panel, paidList, filter, showAll } = acc;
  const totals = [
    { key: "overdue", label: "Vencidas", tone: "danger", count: panel.overdue.count, amount: panel.overdue.amount, caption: panel.overdue.count ? "pagamento atrasado" : "nenhuma em atraso" },
    { key: "week", label: "Vencem esta semana", tone: "warning", count: panel.dueThisWeek.count, amount: panel.dueThisWeek.amount, caption: `${formatShortDate(panel.dueThisWeek.from)} a ${formatShortDate(panel.dueThisWeek.to)}` },
    { key: "toPay", label: "Total a pagar", tone: "info", count: panel.totalToPay.count, amount: panel.totalToPay.amount, caption: "vencidas + a vencer + previstas" },
    { key: "paid", label: "Total pago", tone: "success", count: panel.totalPaid.count, amount: panel.totalPaid.amount, caption: Math.abs(panel.totalPaid.expected - panel.totalPaid.amount) > 0.005 ? `previsto ${formatMoney(panel.totalPaid.expected)}` : periodLabel }
  ];

  const list = filter === "overdue" ? panel.upcoming.filter((i) => i.status === "overdue")
    : filter === "week" ? panel.upcoming.filter((i) => i.status === "due_soon")
    : filter === "paid" ? paidList
    : panel.upcoming;
  const LIMIT = 5;
  const visible = showAll ? list : list.slice(0, LIMIT);
  const titles = {
    toPay: "Próximos compromissos",
    overdue: "Contas vencidas",
    week: "Vencem esta semana",
    paid: "Pagas no período"
  };
  const emptyText = {
    toPay: "Nenhuma conta a pagar no período. Tudo em dia.",
    overdue: "Nenhuma conta vencida. Tudo em dia.",
    week: "Nada vence nos próximos 7 dias.",
    paid: "Nenhuma conta foi paga neste período."
  };

  return (
    <section className="rounded-card border border-line bg-white" aria-labelledby="health-accounts-title">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
        <div className="min-w-0">
          <h3 id="health-accounts-title" className="text-lg font-semibold tracking-[-0.01em] text-navy">Gastos e contas</h3>
          <p className="text-sm text-ink-2">O que a empresa gastou e o que vence · {periodLabel}</p>
        </div>
        {/* Ação principal: registrar um gasto avulso (já pago). Conta recorrente fica abaixo dos totais. */}
        <Button onClick={acc.openSpend} className="max-sm:w-full"><Receipt size={18} aria-hidden="true" /> Novo gasto</Button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 px-4 sm:px-5 lg:grid-cols-4" role="group" aria-label="Filtrar contas pelo total">
        {totals.map((t) => {
          const tone = TOTAL_TONES[t.tone];
          const Icon = tone.icon;
          const active = filter === t.key;
          const dim = t.count === 0 && t.key !== "toPay";
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={active}
              onClick={() => acc.changeFilter(t.key)}
              className={cx(
                "flex min-h-[104px] min-w-0 flex-col rounded-card border p-3 text-left transition-[border-color,box-shadow,transform] duration-150 ease-out-ui",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
                active ? "border-navy bg-info-soft/40 ring-1 ring-navy" : "border-line bg-white hover:border-brand/40"
              )}
            >
              <span className="flex items-center gap-2">
                <span className={cx("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-chip", tone.iconCls)}><Icon className="h-4 w-4" aria-hidden="true" /></span>
                <span className="min-w-0 text-[13px] font-semibold leading-4 text-ink-2">{t.label}</span>
              </span>
              <span className={cx("mt-2 truncate text-xl font-bold tabular-nums leading-7 sm:text-[22px]", dim ? "text-faint" : tone.valueCls)}>{formatMoney(t.amount)}</span>
              <span className="mt-auto pt-1 text-xs leading-4 text-muted">
                <span className="font-semibold text-ink-2">{t.count} {t.count === 1 ? "conta" : "contas"}</span> · {t.caption}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-col gap-1.5 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="text-xs leading-4 text-muted">Conta que vem todo mês (aluguel, internet, sistemas)? Cadastre uma vez e os meses seguintes são previstos.</p>
        <Button variant="secondary" onClick={acc.openNew} className="shrink-0 max-sm:w-full"><Plus size={18} aria-hidden="true" /> Nova conta recorrente</Button>
      </div>

      {panel.undated.length > 0 && (
        <p className="mx-4 mt-3 flex items-start gap-2 rounded-control border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning sm:mx-5" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {panel.undated.length} conta(s) sem vencimento válido ficaram fora dos totais. Edite-as e informe o vencimento.
        </p>
      )}

      <div className="mt-4 border-t border-line px-4 pb-4 sm:px-5">
        <div className="flex items-center justify-between gap-3 py-3">
          <h4 className="text-base font-semibold text-ink">{titles[filter]} <span className="ml-1 text-sm font-medium text-muted tabular-nums">({list.length})</span></h4>
          {filter !== "toPay" && <button type="button" onClick={() => acc.changeFilter("toPay")} className="min-h-touch px-1 text-sm font-semibold text-brand focus-visible:outline-none focus-visible:underline">Ver próximos compromissos</button>}
        </div>

        {!acc.expenses.length ? (
          <EmptyState
            icon={CalendarDays}
            title="Nenhum gasto ou conta cadastrado"
            description="Registre gastos avulsos (Novo gasto) e contas mensais como aluguel e sistemas (Nova conta recorrente) para acompanhar custo do mês, lucro e caixa."
            action={<Button onClick={acc.openSpend}><Receipt size={18} aria-hidden="true" /> Novo gasto</Button>}
            className="py-8"
          />
        ) : !list.length ? (
          <p className="rounded-card border border-dashed border-line bg-mist px-4 py-6 text-center text-sm font-medium text-ink-2">{emptyText[filter]}</p>
        ) : (
          <ul className="divide-y divide-line" aria-label={titles[filter]}>
            {visible.map((item) => (
              <CommitmentRow key={`${item.expenseId}|${item.occurrenceDate}`} item={item} acc={acc} />
            ))}
          </ul>
        )}

        {list.length > LIMIT && (
          <button type="button" onClick={() => acc.setShowAll(!showAll)} className="mt-1 min-h-touch text-sm font-semibold text-brand focus-visible:outline-none focus-visible:underline">
            {showAll ? "Mostrar menos" : `Ver todas (${list.length})`}
          </button>
        )}
      </div>
    </section>
  );
}

function dueText(item, today) {
  if (item.status === "paid") {
    const parts = [`Paga em ${formatShortDate(item.paidDate)}`];
    if (item.expectedAmount !== null && item.expectedAmount !== undefined && Math.abs(item.expectedAmount - item.paidAmount) > 0.005) parts.push(`previsto ${formatMoney(item.expectedAmount)}`);
    return parts.join(" · ");
  }
  if (item.status === "overdue") return `Venceu em ${formatShortDate(item.dueDate)}`;
  if (item.dueDate === today) return "Vence hoje";
  if (item.status === "due_soon") return item.daysToDue === 1 ? "Vence amanhã" : `Vence em ${daysWord(item.daysToDue)} · ${formatShortDate(item.dueDate)}`;
  return `Vence em ${formatDate(item.dueDate)}`;
}

function StatusBadge({ item }) {
  if (item.status === "overdue") return <Badge tone="danger" icon={AlertTriangle}>Vencida há {daysWord(item.daysOverdue)}</Badge>;
  if (item.status === "due_soon") return <Badge tone="warning" icon={Clock3}>A vencer</Badge>;
  if (item.status === "paid") return <Badge tone="success" icon={CheckCircle2}>Paga</Badge>;
  return <Badge tone="neutral" icon={CalendarClock}>Prevista</Badge>;
}

function CommitmentRow({ item, acc }) {
  const paid = item.status === "paid";
  const estimated = !paid && item.amountMode === "variable";
  const amount = paid ? item.paidAmount : item.expectedAmount;
  const expense = acc.expenses.find((e) => e.id === item.expenseId);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2.5 py-3.5 md:grid-cols-[minmax(0,1fr)_8rem_10.5rem_auto] md:items-center">
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-ink">{item.description}</p>
        <p className="mt-0.5 text-sm leading-5 text-ink-2">
          {item.category}
          {item.recurring ? <> · <span className="inline-flex items-center gap-1 align-bottom"><RefreshCw className="h-3 w-3" aria-hidden="true" />Recorrente</span></> : null}
          {item.rescheduled ? " · reagendada" : ""}
        </p>
        <div className="mt-1.5 md:hidden"><StatusBadge item={item} /></div>
        <p className={cx("mt-1 text-sm leading-5", item.status === "overdue" ? "font-medium text-danger" : item.status === "due_soon" ? "font-medium text-warning" : "text-muted")}>{dueText(item, acc.today)}</p>
      </div>
      <div className="text-right md:order-none">
        <p className="text-base font-bold tabular-nums text-ink">{estimated ? "≈ " : ""}{formatMoney(amount)}</p>
        {estimated && <p className="text-xs text-muted">estimado</p>}
      </div>
      <div className="max-md:hidden md:justify-self-start"><StatusBadge item={item} /></div>
      <div className="col-span-2 flex items-center gap-2 md:col-span-1 md:justify-self-end">
        <div className="flex w-full items-center gap-2 md:w-auto">
          {paid ? (
            <Button variant="secondary" onClick={() => acc.undoPaid(item)} className="max-md:flex-1" aria-label={`Desfazer pagamento de ${item.description}`}><Undo2 size={16} aria-hidden="true" /> Desfazer</Button>
          ) : (
            <>
              <Button onClick={() => acc.openPay(item)} className="max-md:flex-1" aria-label={`Marcar como paga: ${item.description}`}><CheckCircle2 size={18} aria-hidden="true" /> Marcar como paga</Button>
              <Menu
                label={`Mais ações: ${item.description}`}
                trigger={<MoreHorizontal className="h-5 w-5" aria-hidden="true" />}
                items={[
                  { label: "Reagendar", icon: CalendarClock, onSelect: () => acc.openReschedule(item) },
                  { label: "Editar conta", icon: Pencil, onSelect: () => acc.openEdit(expense) }
                ]}
              />
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/* ---------- Marcar como paga (modal no desktop, bottom-sheet no celular) ---------- */

function PaySheet({ item, today, onClose, onConfirm }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!item) return;
    setAmount(moneyToInput(item.expectedAmount));
    setDate(today);
    setError("");
    setBusy(false);
  }, [item, today]);

  if (!item) return <Sheet open={false} onClose={onClose} title="Marcar como paga" className="ui-sheet-modal" />;

  const expected = round2(item.expectedAmount);
  const paid = parseMoney(amount);
  const amountOk = Number.isFinite(paid) && paid > 0;
  const dateError = !date ? "Informe a data do pagamento." : date > today ? "A data do pagamento não pode ser futura. Para uma data futura, use Reagendar." : "";
  const diff = amountOk ? round2(paid - expected) : 0;
  const pct = amountOk && expected > 0 ? (diff / expected) * 100 : null;
  const differs = amountOk && Math.abs(diff) > 0.005;
  const seriesVariable = item.amountMode === "variable" && item.recurring;

  async function submit(event) {
    event?.preventDefault();
    if (!amountOk) { setError("Informe o valor pago (maior que zero)."); return; }
    if (dateError) { setError(dateError); return; }
    setBusy(true);
    setError("");
    const message = await onConfirm(item, { paidDate: date, paidAmount: amount });
    if (message) { setError(message); setBusy(false); }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Marcar como paga"
      description={`${item.description} · vence em ${formatDate(item.dueDate)}`}
      className="ui-sheet-modal"
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="health-pay-form" loading={busy} disabled={!amountOk || Boolean(dateError)}>Confirmar pagamento</Button>
        </div>
      )}
    >
      <form id="health-pay-form" onSubmit={submit} className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-card bg-mist px-4 py-3">
          <div>
            <p className="text-sm font-medium text-ink-2">Valor previsto</p>
            {item.amountMode === "variable" && <p className="text-xs text-muted">estimado pelo último pagamento</p>}
          </div>
          <p className="text-lg font-bold tabular-nums text-ink">{formatMoney(expected)}</p>
        </div>

        <TextInput label="Valor efetivamente pago (R$)" value={amount} onChange={setAmount} inputMode="decimal" autoComplete="off" onFocus={(e) => e.target.select()} error={amount && !amountOk ? "Informe um valor maior que zero." : ""} required />

        <div aria-live="polite">
          {differs && (
            <p className={cx("flex items-start gap-2 rounded-control px-3 py-2 text-sm font-medium", diff > 0 ? "bg-warning-soft text-warning" : "bg-info-soft text-info")}>
              {diff > 0 ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
              <span>
                {formatMoney(Math.abs(diff))} {diff > 0 ? "acima" : "abaixo"} do previsto{pct !== null ? ` (${diff > 0 ? "+" : "−"}${fmtNumber(Math.abs(pct))}%)` : ""}.
                {" "}O lucro e o caixa usam o valor pago.
              </span>
            </p>
          )}
        </div>

        <TextInput label="Data do pagamento" type="date" value={date} onChange={setDate} max={today} error={dateError} required />

        {seriesVariable && (
          <p className="flex items-start gap-2 rounded-control border border-line px-3 py-2 text-sm text-ink-2">
            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
            O valor pago passa a ser a referência do próximo mês.
          </p>
        )}

        {error && <p className="rounded-control border border-danger-line bg-danger-soft px-3 py-2 text-sm font-medium text-danger" role="alert">{error}</p>}
      </form>
    </Sheet>
  );
}

function RescheduleSheet({ item, today, onClose, onConfirm }) {
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!item) return;
    setDate(item.dueDate < today ? today : item.dueDate);
    setError("");
    setBusy(false);
  }, [item, today]);

  if (!item) return <Sheet open={false} onClose={onClose} title="Reagendar conta" className="ui-sheet-modal" />;

  async function submit(event) {
    event?.preventDefault();
    if (!date) { setError("Informe a nova data de vencimento."); return; }
    setBusy(true);
    setError("");
    const message = await onConfirm(item, date);
    if (message) { setError(message); setBusy(false); }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Reagendar conta"
      description={`${item.description} · vencimento atual ${formatDate(item.dueDate)}`}
      className="ui-sheet-modal"
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="health-reschedule-form" loading={busy} disabled={!date}>Reagendar</Button>
        </div>
      )}
    >
      <form id="health-reschedule-form" onSubmit={submit} className="space-y-4">
        <TextInput label="Novo vencimento" type="date" value={date} onChange={setDate} required hint="Só muda a data desta conta. Reagendar não paga nada." />
        {error && <p className="rounded-control border border-danger-line bg-danger-soft px-3 py-2 text-sm font-medium text-danger" role="alert">{error}</p>}
      </form>
    </Sheet>
  );
}

/* ---------- Nova conta / Editar conta (gaveta no desktop, tela cheia no celular) ---------- */

const NATURE_HELP = {
  fixed: "Recorrente: aluguel, água, energia, internet, Claude, GPT… Os meses seguintes são previstos automaticamente.",
  variable: "Pontual: galão d'água, café, papel higiênico, computador, mouse, manutenção… Não repete por padrão.",
  extraordinary: "Gasto incomum e isolado (reforma, equipamento grande). Não entra no custo mensal de referência."
};

function ExpenseSheet({ form, setForm, today, onSave }) {
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const open = Boolean(form);
  const formId = form?.id || "";

  useEffect(() => {
    if (open) { setErrors({}); setFormError(""); setBusy(false); }
  }, [open, formId]);

  if (!form) return <Sheet open={false} onClose={() => setForm(null)} title="Nova conta" className="ui-sheet-full" />;
  if (form.mode === "spend") return <SpendSheet form={form} setForm={setForm} today={today} onSave={onSave} />;

  const editing = Boolean(form.id);
  function patch(field, value) {
    setForm((current) => {
      if (!current) return current;
      const next = { ...current, [field]: value };
      if (field === "expenseType") next.natureTouched = true;
      // Natureza segue a repetição enquanto a pessoa não escolheu uma (recorrente = fixa; única = variável).
      if (field === "isRecurring" && !current.id && !current.natureTouched) next.expenseType = value ? "fixed" : "variable";
      return next;
    });
    if (errors[field]) setErrors((current) => ({ ...current, [field]: "" }));
  }

  function validate() {
    const found = {};
    if (!form.description.trim()) found.description = "Informe a descrição da conta.";
    const amount = parseMoney(form.amount);
    if (!(Number.isFinite(amount) && amount > 0)) found.amount = "Informe um valor maior que zero.";
    const dateField = form.wasRecurring ? "effectiveFrom" : "expenseDate";
    if (!form[dateField]) found[dateField] = form.wasRecurring ? "Informe a partir de quando a mudança vale." : "Informe o vencimento: ele define quando a conta aparece como a vencer ou vencida.";
    if (form.isRecurring && form.recurrenceEndDate && form.expenseDate && form.recurrenceEndDate < form.expenseDate) found.recurrenceEndDate = "O encerramento não pode ser anterior ao vencimento.";
    if (form.showPaid && !editing) {
      if (form.paidAmount && !(parseMoney(form.paidAmount) > 0)) found.paidAmount = "Informe um valor pago maior que zero.";
      if (form.paidDate && form.paidDate > today) found.paidDate = "A data do pagamento não pode ser futura.";
    }
    setErrors(found);
    return Object.keys(found).length === 0;
  }

  async function submit(event) {
    event?.preventDefault();
    setFormError("");
    if (!validate()) return;
    setBusy(true);
    const message = await onSave(form);
    if (message) { setFormError(message); setBusy(false); }
  }

  const variable = form.amountMode === "variable";

  return (
    <Sheet
      open
      onClose={() => setForm(null)}
      title={editing ? "Editar conta" : "Nova conta"}
      description={editing ? form.description : "Cadastre uma conta a pagar da empresa."}
      className="ui-sheet-full"
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button>
          <Button type="submit" form="health-expense-form" loading={busy}>{editing ? "Salvar alterações" : "Salvar conta"}</Button>
        </div>
      )}
    >
      <form id="health-expense-form" onSubmit={submit} className="space-y-4" noValidate>
        <TextInput label="Descrição" value={form.description} onChange={(v) => patch("description", v)} placeholder="Ex.: Aluguel da sala" error={errors.description} required autoComplete="off" />
        <SelectInput label="Categoria" value={form.category} onChange={(v) => patch("category", v)} options={OPERATING_EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))} />

        <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
          <TextInput label={form.isRecurring && variable ? "Valor previsto (R$)" : "Valor (R$)"} value={form.amount} onChange={(v) => patch("amount", v)} inputMode="decimal" placeholder="0,00" error={errors.amount} required autoComplete="off" />
          {form.wasRecurring ? (
            <TextInput label="Mudança vale a partir de" type="date" value={form.effectiveFrom || ""} onChange={(v) => patch("effectiveFrom", v)} error={errors.effectiveFrom} required />
          ) : (
            <TextInput label={form.isRecurring ? "Primeiro vencimento" : "Vencimento"} type="date" value={form.expenseDate} onChange={(v) => patch("expenseDate", v)} error={errors.expenseDate} required />
          )}
        </div>
        {form.wasRecurring && (
          <p className="text-sm text-ink-2">A alteração vale <strong className="text-ink">somente a partir da data acima</strong>: meses anteriores, pagamentos já confirmados e relatórios históricos ficam como estão.</p>
        )}

        <fieldset>
          <legend className="mb-1.5 block text-sm font-medium text-ink">Repetição</legend>
          <div className="grid grid-cols-2 gap-1 rounded-control bg-navy/[0.06] p-1" role="radiogroup" aria-label="Repetição">
            {[{ value: false, label: "Única" }, { value: true, label: "Recorrente" }].map((option) => {
              const active = form.isRecurring === option.value;
              return (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={form.wasRecurring}
                  onClick={() => patch("isRecurring", option.value)}
                  className={cx(
                    "min-h-touch rounded-[8px] px-3 text-sm font-semibold transition-colors duration-150 ease-out-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed",
                    active ? "bg-white text-navy shadow-sm" : "text-ink-2 hover:text-navy disabled:hover:text-ink-2"
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {form.wasRecurring && <p className="mt-1.5 text-xs text-muted">Uma conta recorrente não volta a ser única: use &quot;Encerrar&quot; na lista de contas cadastradas.</p>}
        </fieldset>

        {form.isRecurring && (
          <div className="space-y-4 rounded-card border border-line bg-mist/60 p-3.5">
            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
              <SelectInput label="Periodicidade" value={form.recurrencePeriod || "monthly"} onChange={(v) => patch("recurrencePeriod", v)} options={RECURRENCE_PERIODS} />
              <TextInput label="Encerra em (opcional)" type="date" value={form.recurrenceEndDate || ""} onChange={(v) => patch("recurrenceEndDate", v)} error={errors.recurrenceEndDate} />
            </div>
            <fieldset>
              <legend className="mb-1.5 block text-sm font-medium text-ink">O valor muda todo mês?</legend>
              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2" role="radiogroup" aria-label="Modo do valor">
                {[
                  { value: "fixed", title: "Valor fixo", text: "Sempre o mesmo valor. Ex.: aluguel, internet." },
                  { value: "variable", title: "Valor variável", text: "Muda a cada mês. Ex.: energia, água. O que você pagar vira a previsão do mês seguinte." }
                ].map((option) => {
                  const active = form.amountMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => patch("amountMode", option.value)}
                      className={cx(
                        "min-h-touch rounded-card border bg-white p-3 text-left transition-[border-color,box-shadow] duration-150 ease-out-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                        active ? "border-navy ring-1 ring-navy" : "border-line hover:border-brand/40"
                      )}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                        <span className={cx("inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2", active ? "border-navy" : "border-faint")} aria-hidden="true">
                          {active && <span className="h-2 w-2 rounded-full bg-navy" />}
                        </span>
                        {option.title}
                      </span>
                      <span className="mt-1 block text-xs leading-4 text-ink-2">{option.text}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>
        )}

        <details className="group rounded-card border border-line" open={editing && form.note ? true : undefined}>
          <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-2 px-3.5 text-sm font-semibold text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
            Mais opções
            <span className="text-xs font-medium text-muted group-open:hidden">natureza do gasto e observação</span>
          </summary>
          <div className="space-y-4 border-t border-line p-3.5">
            <SelectInput label="Natureza do gasto" value={form.expenseType} onChange={(v) => patch("expenseType", v)} options={OPERATING_EXPENSE_TYPES} hint={NATURE_HELP[form.expenseType]} />
            <TextInput label="Observação (opcional)" value={form.note} onChange={(v) => patch("note", v)} autoComplete="off" />
          </div>
        </details>

        {!editing && (
          form.showPaid ? (
            <div className="space-y-4 rounded-card border border-success-line bg-success-soft/50 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-ink">Já foi paga: informe como foi o pagamento</p>
                <button type="button" onClick={() => patch("showPaid", false)} className="-my-2 min-h-touch shrink-0 px-1 text-sm font-semibold text-brand focus-visible:outline-none focus-visible:underline">Não foi paga</button>
              </div>
              <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
                <TextInput label="Valor pago (R$)" value={form.paidAmount} onChange={(v) => patch("paidAmount", v)} inputMode="decimal" placeholder={form.amount || "0,00"} error={errors.paidAmount} hint="Em branco = o valor previsto." autoComplete="off" />
                <TextInput label="Data do pagamento" type="date" value={form.paidDate || today} onChange={(v) => patch("paidDate", v)} max={today} error={errors.paidDate} />
              </div>
              <p className="text-xs text-ink-2">Vale para o primeiro vencimento. É o mesmo caminho de &quot;Marcar como paga&quot;.</p>
            </div>
          ) : (
            <button type="button" onClick={() => patch("showPaid", true)} className="min-h-touch text-sm font-semibold text-brand focus-visible:outline-none focus-visible:underline">Já foi paga?</button>
          )
        )}

        {formError && <p className="rounded-control border border-danger-line bg-danger-soft px-3 py-2 text-sm font-medium text-danger" role="alert">{formError}</p>}
      </form>
    </Sheet>
  );
}

/* ---------- Novo gasto (avulso, já pago) ---------- */

function SpendSheet({ form, setForm, today, onSave }) {
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  function patch(field, value) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: "" }));
  }

  async function submit(event) {
    event?.preventDefault();
    setFormError("");
    const found = {};
    if (!form.description.trim()) found.description = "Informe com o que foi o gasto.";
    const amount = parseMoney(form.amount);
    if (!(Number.isFinite(amount) && amount > 0)) found.amount = "Informe um valor maior que zero.";
    if (!form.expenseDate) found.expenseDate = "Informe a data do gasto.";
    else if (form.expenseDate > today) found.expenseDate = "A data do gasto não pode ser futura. Para algo que ainda vai vencer, use Nova conta.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    const message = await onSave(form);
    if (message) { setFormError(message); setBusy(false); }
  }

  return (
    <Sheet
      open
      onClose={() => setForm(null)}
      title="Novo gasto"
      description="Algo que a empresa já gastou, esporádico. Entra no custo do mês como pago."
      className="ui-sheet-full"
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button>
          <Button type="submit" form="health-spend-form" loading={busy}>Salvar gasto</Button>
        </div>
      )}
    >
      <form id="health-spend-form" onSubmit={submit} className="space-y-4" noValidate>
        <TextInput label="Com o que foi o gasto" value={form.description} onChange={(v) => patch("description", v)} placeholder="Ex.: Galão de água, café, manutenção" error={errors.description} required autoComplete="off" />
        <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
          <TextInput label="Valor (R$)" value={form.amount} onChange={(v) => patch("amount", v)} inputMode="decimal" placeholder="0,00" error={errors.amount} required autoComplete="off" />
          <TextInput label="Data do gasto" type="date" value={form.expenseDate} onChange={(v) => patch("expenseDate", v)} max={today} error={errors.expenseDate} required />
        </div>
        <SelectInput label="Categoria" value={form.category} onChange={(v) => patch("category", v)} options={OPERATING_EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))} />
        <TextInput label="Observação (opcional)" value={form.note} onChange={(v) => patch("note", v)} autoComplete="off" />
        <p className="text-xs text-ink-2">Gasto único: não se repete nos próximos meses. Para uma conta que vem todo mês, use <strong>Nova conta recorrente</strong>.</p>
        {formError && <p className="rounded-control border border-danger-line bg-danger-soft px-3 py-2 text-sm font-medium text-danger" role="alert">{formError}</p>}
      </form>
    </Sheet>
  );
}

/* ---------- contas cadastradas (gestão das séries: editar, encerrar, excluir) ---------- */

export function RegisteredExpenses({ acc }) {
  const { expenses, today } = acc;
  const [showAll, setShowAll] = useState(false);
  const [kind, setKind] = useState("all"); // all | fixed | variable

  const sorted = useMemo(() => [...expenses].sort((a, b) => {
    const activeA = a.isRecurring && (!a.recurrenceEndDate || a.recurrenceEndDate >= today) ? 1 : 0;
    const activeB = b.isRecurring && (!b.recurrenceEndDate || b.recurrenceEndDate >= today) ? 1 : 0;
    return activeB - activeA || b.expenseDate.localeCompare(a.expenseDate);
  }), [expenses, today]);
  // Fixas/recorrentes (aluguel, água, energia, internet, Claude, GPT…) × variáveis/pontuais (galão, café, mouse, manutenção…)
  const isFixedKind = (e) => e.expenseType === "fixed" || e.isRecurring;
  const counts = { all: sorted.length, fixed: sorted.filter(isFixedKind).length, variable: sorted.filter((e) => !isFixedKind(e)).length };
  const filtered = kind === "fixed" ? sorted.filter(isFixedKind) : kind === "variable" ? sorted.filter((e) => !isFixedKind(e)) : sorted;
  const visible = showAll ? filtered : filtered.slice(0, 12);

  return (
    <section className="rounded-card border border-line bg-white p-4 sm:p-5" aria-labelledby="health-registered-title">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="health-registered-title" className="text-lg font-semibold tracking-[-0.01em] text-navy">Contas cadastradas</h3>
          <p className="mt-0.5 max-w-2xl text-sm text-ink-2">Só viram pagas quando você marca como paga. Repasses (corretor, gestor) e nota fiscal não são cadastrados aqui: vêm de cada venda.</p>
        </div>
        <Button variant="secondary" onClick={acc.openNew}><Plus size={18} aria-hidden="true" /> Nova conta</Button>
      </div>

      {sorted.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1 rounded-control bg-navy/[0.06] p-1 sm:inline-flex" role="tablist" aria-label="Filtrar contas cadastradas">
          {[{ key: "all", label: "Todas" }, { key: "fixed", label: "Fixas/recorrentes" }, { key: "variable", label: "Variáveis/pontuais" }].map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={kind === tab.key}
              onClick={() => { setKind(tab.key); setShowAll(false); }}
              className={cx(
                "min-h-touch flex-1 rounded-[8px] px-3 text-sm font-semibold transition-colors duration-150 ease-out-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:flex-none",
                kind === tab.key ? "bg-white text-navy shadow-sm" : "text-ink-2 hover:text-navy"
              )}
            >
              {tab.label} <span className="tabular-nums">({counts[tab.key]})</span>
            </button>
          ))}
        </div>
      )}

      {!sorted.length ? (
        <EmptyState icon={CalendarDays} title="Nenhuma conta cadastrada" description="Cadastre aluguel, sistemas, anúncios etc. para ver lucro, caixa e projeções." className="py-8" />
      ) : (
        <ul className="divide-y divide-line">
          {visible.map((expense) => {
            const period = RECURRENCE_PERIODS.find((p) => p.value === expense.recurrencePeriod)?.label;
            const nature = OPERATING_EXPENSE_TYPES.find((t) => t.value === expense.expenseType)?.label;
            const ended = expense.isRecurring && expense.recurrenceEndDate && expense.recurrenceEndDate < today;
            const active = expense.isRecurring && !ended;
            const variableValue = expense.isRecurring && expense.amountMode === "variable";
            return (
              <li key={expense.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-ink">{expense.description}</p>
                  <p className="mt-0.5 text-sm leading-5 text-ink-2">
                    {expense.category} · {nature}
                    {expense.isRecurring ? ` · ${period}${ended ? ` (encerrada em ${formatDate(expense.recurrenceEndDate)})` : expense.recurrenceEndDate ? ` até ${formatDate(expense.recurrenceEndDate)}` : ""} desde ${formatDate(expense.expenseDate)}` : ` · ${formatDate(expense.expenseDate)}`}
                  </p>
                  {variableValue && <p className="mt-1"><Badge tone="info" icon={RefreshCw}>Valor variável</Badge></p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-base font-bold tabular-nums text-ink">{variableValue ? "≈ " : ""}{formatMoney(expense.amount)}</span>
                  <Menu
                    label={`Ações de ${expense.description}`}
                    trigger={<MoreHorizontal className="h-5 w-5" aria-hidden="true" />}
                    items={[
                      { label: "Editar", icon: Pencil, onSelect: () => acc.openEdit(expense) },
                      { label: "Encerrar recorrência", icon: StopCircle, onSelect: () => acc.endRecurrence(expense), hidden: !active },
                      { label: "Excluir", icon: Trash2, tone: "danger", separatorBefore: true, onSelect: () => acc.removeExpense(expense) }
                    ]}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length > 12 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 min-h-touch text-sm font-semibold text-brand focus-visible:outline-none focus-visible:underline">{showAll ? "Mostrar menos" : `Ver todas (${filtered.length})`}</button>
      )}
    </section>
  );
}
