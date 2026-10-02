"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Info, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  OPERATING_EXPENSE_CATEGORIES,
  OPERATING_EXPENSE_TYPES,
  RECURRENCE_PERIODS,
  addDays,
  collectExpenseEvents,
  computeHealth,
  monthLabel,
  monthRange
} from "@/lib/financial-health-core.mjs";
import { BrokerResultChart, EvolutionChart, formatMoney } from "@/components/FinancialHealthCharts";

const PERIOD_OPTIONS = [
  { value: "month", label: "Este mês" },
  { value: "lastMonth", label: "Mês anterior" },
  { value: "pick", label: "Escolher mês" },
  { value: "quarter", label: "Este trimestre" },
  { value: "year", label: "Este ano" },
  { value: "custom", label: "Personalizado" }
];

const LEVEL_STYLES = {
  healthy: { label: "Saudável", cls: "border-success-line bg-success-soft text-success" },
  attention: { label: "Atenção", cls: "border-warning-line bg-warning-soft text-warning" },
  critical: { label: "Crítico", cls: "border-danger-line bg-danger-soft text-danger" }
};

const EMPTY_FORM = {
  id: "",
  description: "",
  category: "Outros",
  expenseType: "variable",
  amount: "",
  expenseDate: "",
  isRecurring: false,
  recurrencePeriod: "monthly",
  recurrenceEndDate: "",
  note: ""
};

export default function FinancialHealthTab({ sales = [], initialExpenses = [], initialOccurrences = [], initialSettings = {}, today }) {
  const [expenses, setExpenses] = useState(initialExpenses);
  const [occurrences, setOccurrences] = useState(initialOccurrences);
  const [settings, setSettings] = useState(initialSettings);
  const [period, setPeriod] = useState("month");
  const [pickedMonth, setPickedMonth] = useState(today.slice(0, 7));
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [feedback, setFeedback] = useState({ tone: "", text: "" });

  const effective = useMemo(() => {
    if (period === "pick") {
      const range = monthRange(`${pickedMonth || today.slice(0, 7)}-01`);
      return { period: "custom", custom: range };
    }
    return { period, custom: { start: customStart, end: customEnd } };
  }, [period, pickedMonth, customStart, customEnd, today]);

  const health = useMemo(
    () => computeHealth({ sales, expenses, overrides: occurrences, settings, today, period: effective.period, custom: effective.custom }),
    [sales, expenses, occurrences, settings, today, effective]
  );

  const { summary, changes } = health;
  const fullMonth = health.range.start.slice(8) === "01" && monthRange(health.range.start).end === health.range.end;
  const vsLabel = fullMonth ? "vs mês anterior" : "vs período anterior";
  const periodTitle = fullMonth ? monthLabel(health.range.start) : `${formatDate(health.range.start)} a ${formatDate(health.range.end)}`;
  const coverage = health.reserve.coverageMonths;
  const levelStyle = health.reserve.level ? LEVEL_STYLES[health.reserve.level] : null;

  return (
    <div className="space-y-6">
      <section className="premium-card p-4 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-brand">Saúde financeira</p>
            <h2 className="mt-1.5 text-2xl font-black text-navy md:text-3xl">{periodTitle}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">Realizado, previsto e estimado sempre separados. Fórmulas em <code>docs/FINANCEIRO_SAUDE.md</code>.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:w-[460px]">
            <Select label="Período" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
            {period === "pick" && <Field label="Mês" type="month" value={pickedMonth} onChange={setPickedMonth} />}
            {period === "custom" && (
              <>
                <Field label="Data inicial" type="date" value={customStart} onChange={setCustomStart} />
                <Field label="Data final" type="date" value={customEnd} onChange={setCustomEnd} />
              </>
            )}
          </div>
        </div>
      </section>

      {feedback.text && (
        <p className={`rounded-2xl border px-4 py-3 text-sm font-bold ${feedback.tone === "error" ? "border-danger-line bg-danger-soft text-danger" : "border-success-line bg-success-soft text-success"}`} role="status">{feedback.text}</p>
      )}

      {/* Indicadores principais */}
      <section aria-label="Indicadores principais" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi title="Comissão recebida" value={formatMoney(summary.revenueGross)} tag="Recebido" delta={changes.revenue} vsLabel={vsLabel} hint="Receita da imobiliária: comissão bruta efetivamente recebida" />
        <Kpi title="Repasses" value={formatMoney(summary.repasses)} tag="Realizado" delta={changes.repasses} vsLabel={vsLabel} inverse hint="Corretor, gestor e outros participantes da venda. Não são despesas operacionais." />
        <Kpi title="Nota fiscal" value={formatMoney(summary.invoice)} tag="Realizado" delta={changes.invoice} vsLabel={vsLabel} inverse hint="Despesa fiscal de cada venda (percentual próprio) sobre a comissão recebida" />
        <Kpi title="Despesas operacionais" value={formatMoney(summary.operatingTotal)} tag="Realizado" delta={changes.operating} vsLabel={vsLabel} inverse
          hint={`Pagas: da empresa ${formatMoney(summary.operatingExpenses)} + ligadas a vendas ${formatMoney(summary.saleExpenses)}. Previstas não entram.`} />
        <Kpi title="Resultado líquido" value={formatMoney(summary.profit)} tag="Realizado" delta={changes.profit} vsLabel={vsLabel} negative={summary.profit < 0} hint="Comissão − repasses − nota fiscal − despesas operacionais pagas" />
        <Kpi title="Margem" value={summary.marginPercent === null ? "—" : `${fmtNumber(summary.marginPercent)}%`} tag="Realizado"
          deltaPoints={changes.marginDeltaPoints} vsLabel={vsLabel} hint="Resultado líquido ÷ comissão recebida" />
        <Kpi title="Caixa" value={health.cash === null ? "Não config." : formatMoney(health.cash)} tag="Realizado" negative={health.cash !== null && health.cash < 0}
          hint={health.cash === null ? "Configure o saldo inicial do caixa abaixo." : `Saldo inicial de ${formatDate(settings.openingCashDate)} + entradas − saídas`} />
        <Kpi title="Expectativa do mês" value={health.expectation.available ? formatMoney(health.expectation.result) : "—"} tag="Previsto"
          hint={health.expectation.available ? `Resultado projetado de ${monthLabel(health.expectation.monthStart, false)}` : "Sem projeção: o período selecionado não inclui o mês atual."} />
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        {/* Expectativa */}
        <Card title="Expectativa do mês" subtitle="Comissão − repasses − nota fiscal − despesas, com realizado e previsto separados">
          <ExpectationBlock health={health} />
        </Card>

        {/* Caixa e reserva */}
        <Card title="Caixa e reserva de segurança" subtitle="Critérios matemáticos e configuráveis">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Metric label="Caixa atual" value={health.cash === null ? "Não configurado" : formatMoney(health.cash)} />
            <Metric label="Reserva recomendada" value={health.operatingCost.value > 0 ? formatMoney(health.reserve.recommended) : "—"} sub={`${fmtNumber(health.reserve.reserveMonths)} meses do custo operacional`} />
            <Metric label="Cobertura" value={coverage === null ? "—" : `${fmtNumber(coverage)} meses`} sub={levelStyle ? undefined : "Precisa de caixa e despesas cadastrados"} />
          </div>
          {levelStyle && (
            <p className={`mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-wide ${levelStyle.cls}`}>
              {levelStyle.label}
              <span className="font-bold normal-case tracking-normal">
                {health.reserve.level === "healthy" ? `cobertura ≥ ${fmtNumber(health.reserve.reserveMonths)} meses` : health.reserve.level === "attention" ? `entre ${fmtNumber(health.reserve.criticalMonths)} e ${fmtNumber(health.reserve.reserveMonths)} meses` : `cobertura ≤ ${fmtNumber(health.reserve.criticalMonths)} mês`}
              </span>
            </p>
          )}
          <p className="mt-3 text-xs leading-5 text-muted">
            Custo operacional mensal de referência: <strong className="text-navy">{formatMoney(health.operatingCost.value)}</strong> (maior entre a média dos 3 últimos meses fechados — {formatMoney(health.operatingCost.average3m)} — e as despesas recorrentes ativas — {formatMoney(health.operatingCost.recurring)}). Despesas extraordinárias não entram.
          </p>
          <SettingsForm settings={settings} onSaved={(next) => { setSettings(next); setFeedback({ tone: "success", text: "Configuração de caixa salva." }); }} onError={(text) => setFeedback({ tone: "error", text })} />
        </Card>

        {/* Ponto de equilíbrio */}
        <Card title="Ponto de equilíbrio" subtitle="Quanto precisa entrar para cobrir a operação do período">
          <BreakEvenBlock be={health.breakEven} />
        </Card>

        {/* Resultado por corretor */}
        <Card title="Resultado da imobiliária por corretor" subtitle="Parte da imobiliária nas comissões efetivamente recebidas no período">
          <BrokerResultChart rows={health.byBroker} />
          <p className="mt-3 text-xs leading-5 text-muted">Não é VGV nem comissão bruta: é o que sobra para a imobiliária depois de repasses, despesas da venda, nota e comissões de corretor/gestor. Despesas operacionais da empresa não são atribuídas a corretor.</p>
        </Card>
      </div>

      {/* Evolução */}
      <Card title="Evolução financeira" subtitle={`${monthLabel(health.evolution.previousMonth.start, false)} × ${monthLabel(health.evolution.currentMonth.start, false)} × projeção`}>
        <EvolutionChart evolution={health.evolution} previousLabel={monthLabel(health.evolution.previousMonth.start, false)} currentLabel={monthLabel(health.evolution.currentMonth.start, false)} />
      </Card>

      {/* Histórico */}
      <Card title="Histórico mensal" subtitle="Últimos 6 meses — comparação de receita, despesas, lucro, margem e caixa">
        <HistoryTable rows={health.history} cashConfigured={health.cashConfigured} />
      </Card>

      {/* Apontamentos */}
      <Card title="Apontamentos financeiros" subtitle="Fato → apontamento → recomendação (nenhuma despesa é julgada sem evidência)">
        <Insights items={health.insights} />
        {(health.dataQuality.undatedReceived > 0 || health.dataQuality.undatedExpected > 0) && (
          <p className="mt-3 rounded-xl border border-warning-line bg-warning-soft px-3 py-2 text-xs font-bold text-warning">
            Dados incompletos: {health.dataQuality.undatedReceived} recebimento(s) marcado(s) como recebido e {health.dataQuality.undatedExpected} previsto(s) sem data não entram nos cálculos por período.
          </p>
        )}
      </Card>

      {/* Despesas */}
      <ExpensesSection
        expenses={expenses}
        occurrences={occurrences}
        today={today}
        onChange={setExpenses}
        onOccurrencesChange={setOccurrences}
        onFeedback={(tone, text) => setFeedback({ tone, text })}
      />
    </div>
  );
}

/* ---------- blocos ---------- */

function ExpectationBlock({ health }) {
  const { expectation, currentSummary: c } = health;
  if (!expectation.available) {
    return <p className="rounded-2xl border border-dashed border-line bg-mist px-4 py-6 text-center text-sm font-bold text-muted">A expectativa considera o mês atual.</p>;
  }
  const projected = c.projected;
  const expectedResult = round(c.expectedGross - c.expectedRepasses - c.expectedInvoice - c.expectedOperating);
  const rows = [
    { label: "Comissão (receita)", real: c.revenueGross, planned: c.expectedGross, sign: 1,
      sub: [expectation.forecastIncluded > 0 ? `previsto inclui ${formatMoney(expectation.forecastIncluded)} da previsão de recebimento do saldo` : null, expectation.overdue > 0 ? `${formatMoney(expectation.overdue)} vencido` : null].filter(Boolean).join(" · ") || null },
    { label: "Repasses", real: c.repasses, planned: c.expectedRepasses, sign: -1, sub: "corretor, gestor e participantes" },
    { label: "Nota fiscal", real: c.invoice, planned: c.expectedInvoice, sign: -1 },
    { label: "Despesas operacionais", real: c.operatingTotal, planned: c.expectedOperating, sign: -1,
      sub: expectation.operatingOverdue > 0 ? `previstas incluem ${formatMoney(expectation.operatingOverdue)} vencidas aguardando confirmação` : null }
  ];
  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 text-xs font-black uppercase tracking-wide text-muted">
        <span />
        <span className="min-w-[92px] text-right"><Tag kind="Realizado" /></span>
        <span className="min-w-[92px] text-right"><Tag kind="Previsto" /></span>
      </div>
      <ul className="mt-1 divide-y divide-line">
        {rows.map((row) => (
          <li key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-3 py-2.5">
            <span className="text-sm text-muted">{row.sign < 0 ? "(−) " : ""}{row.label}{row.sub && <span className="block text-xs leading-4 text-brand">{row.sub}</span>}</span>
            <span className="min-w-[92px] text-right text-sm font-black text-navy">{formatMoney(row.real)}</span>
            <span className="min-w-[92px] text-right text-sm font-black text-brand">{formatMoney(row.planned)}</span>
          </li>
        ))}
        <li className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-2.5">
          <span className="text-sm font-black text-navy">= Resultado líquido</span>
          <span className={`min-w-[92px] text-right text-sm font-black ${c.profit < 0 ? "text-danger" : "text-navy"}`}>{formatMoney(c.profit)}</span>
          <span className={`min-w-[92px] text-right text-sm font-black ${expectedResult < 0 ? "text-danger" : "text-brand"}`}>{formatMoney(expectedResult)}</span>
        </li>
      </ul>
      <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl bg-blue-50 px-4 py-3">
        <span className="text-sm font-black text-navy">Resultado líquido projetado <span className="font-bold text-muted">(realizado + previsto)</span></span>
        <span className={`text-lg font-black ${projected.result < 0 ? "text-danger" : "text-navy"}`}>{formatMoney(projected.result)}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted">A coluna Previsto é o que ainda vai acontecer (recebimentos com data, previsão do saldo, despesas ainda não confirmadas) e nunca é somado ao Realizado nas colunas. Repasses e nota fiscal são apropriados proporcionalmente ao valor recebido.</p>
      {health.estimate && health.estimate.remaining > 0 && (
        <div className="mt-3 rounded-2xl border border-dashed border-brand/40 bg-blue-50/50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-black text-navy"><Tag kind="Estimado" /> Despesas variáveis ainda não lançadas</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            Pela média dos 3 meses anteriores ({formatMoney(health.estimate.average3m)}), podem surgir cerca de <strong className="text-navy">{formatMoney(health.estimate.remaining)}</strong> até o fim do mês.
            Com essa estimativa, o resultado seria <strong className="text-navy">{formatMoney(projected.result - health.estimate.remaining)}</strong>. A estimativa <u>não</u> está incluída no resultado projetado acima.
          </p>
        </div>
      )}
    </div>
  );
}

function round(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function BreakEvenBlock({ be }) {
  if (be.operatingNeeded <= 0) {
    return <p className="rounded-2xl border border-dashed border-line bg-mist px-4 py-6 text-center text-sm font-bold text-muted">Sem despesas operacionais no período — não há o que cobrir.</p>;
  }
  const useGross = be.grossNeeded !== null;
  const needed = useGross ? be.grossNeeded : be.operatingNeeded;
  const received = useGross ? be.grossReceived : be.netReceived;
  const gap = useGross ? be.grossGap : be.netGap;
  const pct = needed > 0 ? Math.min(100, Math.round((received / needed) * 100)) : 0;
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="Ponto de equilíbrio" value={formatMoney(needed)} sub={useGross ? "receita bruta necessária" : "parte da imobiliária necessária"} />
        <Metric label="Recebido" value={formatMoney(received)} />
        <Metric label={gap > 0 ? "Falta" : "Meta atingida"} value={gap > 0 ? formatMoney(gap) : "✓"} />
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-blue-50" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso até o ponto de equilíbrio">
        <div className={`h-full rounded-full ${gap > 0 ? "bg-brand" : "bg-success-strong"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">
        Fórmula: despesas operacionais do período ({formatMoney(be.operatingNeeded)}, realizadas + previstas)
        {useGross ? <> ÷ margem de contribuição de {fmtNumber(be.contributionPercent)}% (parte da imobiliária ÷ comissão bruta recebida nos últimos 6 meses)</> : <>. Ainda não há recebimentos históricos para calcular a margem de contribuição; mostrando o valor líquido da imobiliária.</>}.
      </p>
    </div>
  );
}

function HistoryTable({ rows, cashConfigured }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[620px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-black uppercase tracking-wide text-muted">
            <th className="py-2 pr-3">Mês</th>
            <th className="py-2 pr-3 text-right">Receita</th>
            <th className="py-2 pr-3 text-right">Despesas</th>
            <th className="py-2 pr-3 text-right">Lucro</th>
            <th className="py-2 pr-3 text-right">Margem</th>
            <th className="py-2 pr-3 text-right">Caixa no fim</th>
            <th className="py-2 text-right">Projeção × realizado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.month} className={`border-b border-line/70 ${row.isCurrent ? "bg-blue-50/50" : ""}`}>
              <td className="whitespace-nowrap py-2.5 pr-3 font-black text-navy" title={row.label}>{row.shortLabel}{row.isCurrent && <span className="ml-2 text-[10px] font-black uppercase text-brand">atual</span>}</td>
              <td className="py-2.5 pr-3 text-right">{formatMoney(row.revenueGross)}</td>
              <td className="py-2.5 pr-3 text-right">{formatMoney(row.expenses)}</td>
              <td className={`py-2.5 pr-3 text-right font-black ${row.profit < 0 ? "text-danger" : "text-navy"}`}>{formatMoney(row.profit)}</td>
              <td className="py-2.5 pr-3 text-right">{row.marginPercent === null ? "—" : `${fmtNumber(row.marginPercent)}%`}</td>
              <td className="py-2.5 pr-3 text-right">{row.cashEnd === null ? (cashConfigured ? "—" : "não configurado") : formatMoney(row.cashEnd)}</td>
              <td className="py-2.5 text-right text-xs text-muted">
                {row.projected ? <>realizado {formatMoney(row.profit)}<br />projetado {formatMoney(row.projected.result)}</> : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">A projeção só existe para o mês em andamento; meses encerrados mostram apenas o realizado.</p>
    </div>
  );
}

function Insights({ items }) {
  if (!items.length) {
    return <p className="rounded-2xl border border-dashed border-line bg-mist px-4 py-6 text-center text-sm font-bold text-muted">Sem apontamentos no período. Cadastre despesas e recebimentos para que a análise apareça.</p>;
  }
  const style = {
    positive: { icon: CheckCircle2, cls: "border-success-line bg-success-soft", iconCls: "text-success" },
    attention: { icon: AlertTriangle, cls: "border-warning-line bg-warning-soft", iconCls: "text-warning" },
    critical: { icon: AlertTriangle, cls: "border-danger-line bg-danger-soft", iconCls: "text-danger" },
    info: { icon: Info, cls: "border-line bg-mist", iconCls: "text-brand" }
  };
  return (
    <ul className="space-y-2.5">
      {items.map((item) => {
        const s = style[item.level] || style.info;
        const Icon = s.icon;
        return (
          <li key={item.id} className={`rounded-2xl border px-4 py-3 ${s.cls}`}>
            <div className="flex gap-3">
              <Icon size={18} className={`mt-0.5 shrink-0 ${s.iconCls}`} aria-hidden />
              <div className="min-w-0 space-y-1 text-sm leading-6">
                <p><strong className="text-navy">Fato:</strong> <span className="text-ink">{item.fact}</span></p>
                {item.flag && <p><strong className="text-navy">Apontamento:</strong> <span className="text-ink">{item.flag}</span></p>}
                {item.recommendation && <p><strong className="text-navy">Recomendação:</strong> <span className="text-ink">{item.recommendation}</span></p>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SettingsForm({ settings, onSaved, onError }) {
  const [balance, setBalance] = useState(settings.openingCashBalance === null || settings.openingCashBalance === undefined ? "" : String(settings.openingCashBalance).replace(".", ","));
  const [date, setDate] = useState(settings.openingCashDate || "");
  const [reserve, setReserve] = useState(String(settings.reserveMonths ?? 3).replace(".", ","));
  const [critical, setCritical] = useState(String(settings.criticalMonths ?? 1).replace(".", ","));
  const [saving, setSaving] = useState(false);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/financeiro/saude", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openingCashBalance: balance, openingCashDate: date, reserveMonths: reserve, criticalMonths: critical })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar.");
      onSaved(payload.settings);
    } catch (error) {
      onError(error.message || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-4 rounded-2xl border border-line bg-mist p-4">
      <p className="text-sm font-black text-navy">Configuração do caixa</p>
      <p className="mt-0.5 text-xs leading-5 text-muted">O sistema nunca inventa saldo: informe o saldo real do caixa na data inicial. Em branco = caixa não acompanhado.</p>
      <div className="mt-3 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
        <Field label="Saldo inicial (R$)" value={balance} onChange={setBalance} inputMode="decimal" placeholder="Ex.: 15000,00" />
        <Field label="Saldo válido desde" type="date" value={date} onChange={setDate} />
        <Field label="Reserva desejada (meses)" value={reserve} onChange={setReserve} inputMode="decimal" />
        <Field label="Crítico até (meses)" value={critical} onChange={setCritical} inputMode="decimal" />
      </div>
      <button type="submit" disabled={saving} className="premium-button-primary mt-3 min-h-11 px-5">{saving ? "Salvando..." : "Salvar configuração"}</button>
    </form>
  );
}

function ExpensesSection({ expenses, occurrences, today, onChange, onOccurrencesChange, onFeedback }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
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

  function patch(field, value) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      // Nova despesa: fixa nasce recorrente (mensal); variável/extraordinária nasce pontual (não recorrente).
      if (field === "expenseType" && !current.id) {
        next.isRecurring = value === "fixed";
        if (value === "fixed" && !next.recurrencePeriod) next.recurrencePeriod = "monthly";
      }
      return next;
    });
  }

  // Recarrega despesas e confirmações (uma alteração de recorrente pode criar uma nova versão da série).
  async function reload() {
    const [expensesResponse, occurrencesResponse] = await Promise.all([fetch("/api/financeiro/saude/despesas"), fetch("/api/financeiro/saude/ocorrencias")]);
    const expensesPayload = await expensesResponse.json().catch(() => ({}));
    const occurrencesPayload = await occurrencesResponse.json().catch(() => ({}));
    if (expensesResponse.ok) onChange(expensesPayload.expenses || []);
    if (occurrencesResponse.ok) onOccurrencesChange(occurrencesPayload.occurrences || []);
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const editing = Boolean(form.id);
      const response = await fetch(editing ? `/api/financeiro/saude/despesas/${form.id}` : "/api/financeiro/saude/despesas", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, recurrenceEndDate: form.isRecurring ? form.recurrenceEndDate || null : null, effectiveFrom: form.effectiveFrom || undefined })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar a despesa.");
      if (editing && form.wasRecurring) await reload();
      else onChange(editing ? expenses.map((e) => (e.id === payload.id ? payload : e)) : [payload, ...expenses]);
      setForm(null);
      onFeedback("success", editing ? (form.wasRecurring ? `Despesa atualizada. A mudança vale a partir de ${formatDate(form.effectiveFrom || today)}; os meses anteriores foram preservados.` : "Despesa atualizada.") : "Despesa cadastrada.");
    } catch (error) {
      onFeedback("error", error.message || "Não foi possível salvar a despesa.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(expense) {
    const message = expense.isRecurring
      ? `Excluir "${expense.description}"? Isso remove TODOS os meses (passados e futuros) desta despesa recorrente. Para preservar o histórico, use "Encerrar" em vez de excluir.`
      : `Excluir "${expense.description}"?`;
    if (!confirm(message)) return;
    try {
      const response = await fetch(`/api/financeiro/saude/despesas/${expense.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível excluir.");
      onChange(expenses.filter((e) => e.id !== expense.id));
      onFeedback("success", "Despesa excluída.");
    } catch (error) {
      onFeedback("error", error.message || "Não foi possível excluir.");
    }
  }

  async function endRecurrence(expense) {
    const end = today < expense.expenseDate ? expense.expenseDate : today;
    if (!confirm(`Encerrar "${expense.description}" em ${formatDate(end)}? Os meses anteriores continuam no histórico e nenhum mês novo será cobrado.`)) return;
    try {
      const response = await fetch(`/api/financeiro/saude/despesas/${expense.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRecurring: true, recurrencePeriod: expense.recurrencePeriod, recurrenceEndDate: end })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível encerrar.");
      onChange(expenses.map((e) => (e.id === payload.id ? payload : e)));
      onFeedback("success", "Recorrência encerrada.");
    } catch (error) {
      onFeedback("error", error.message || "Não foi possível encerrar.");
    }
  }

  return (
    <Card
      title="Despesas operacionais da empresa"
      subtitle="Cadastradas como previstas; só viram pagas quando você confirma o pagamento. Repasses (corretor, gestor) e nota fiscal NÃO são cadastrados aqui: vêm de cada venda."
      action={!form && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setForm({ ...EMPTY_FORM, expenseType: "fixed", isRecurring: true, recurrencePeriod: "monthly", category: "Aluguel", expenseDate: today })} className="premium-button-primary inline-flex min-h-11 items-center gap-2 px-4 text-sm">
            <Plus size={16} /> Despesa fixa
          </button>
          <button type="button" onClick={() => setForm({ ...EMPTY_FORM, expenseType: "variable", isRecurring: false, expenseDate: today })} className="premium-button-secondary inline-flex min-h-11 items-center gap-2 px-4 text-sm">
            <Plus size={16} /> Despesa variável
          </button>
        </div>
      )}
    >
      {form && (
        <form onSubmit={submit} className="mb-5 rounded-2xl border border-line bg-mist p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-black text-navy">{form.id ? "Editar despesa" : "Nova despesa"}</p>
            <button type="button" onClick={() => setForm(null)} aria-label="Fechar formulário" className="rounded-full p-2 text-muted hover:bg-white"><X size={18} /></button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Descrição" value={form.description} onChange={(v) => patch("description", v)} placeholder="Ex.: Aluguel da sala" />
            <Select label="Categoria" value={form.category} onChange={(v) => patch("category", v)} options={OPERATING_EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))} />
            <div>
              <Select label="Tipo" value={form.expenseType} onChange={(v) => patch("expenseType", v)} options={OPERATING_EXPENSE_TYPES} />
              <p className="mt-1 text-xs leading-4 text-muted">
                {form.expenseType === "fixed" ? "Recorrente: aluguel, água, energia, internet, Claude, GPT… Cadastre uma vez; os meses seguintes são previstos automaticamente."
                  : form.expenseType === "variable" ? "Pontual: galão d'água, café, papel higiênico, computador, mouse, manutenção… Não repete por padrão."
                  : "Gasto incomum e isolado (reforma, equipamento grande). Não entra no custo mensal de referência."}
              </p>
            </div>
            <Field label="Valor (R$)" value={form.amount} onChange={(v) => patch("amount", v)} inputMode="decimal" placeholder="0,00" />
            {form.wasRecurring ? (
              <Field label="Aplicar a partir de" type="date" value={form.effectiveFrom || ""} onChange={(v) => patch("effectiveFrom", v)} />
            ) : (
              <Field label={form.isRecurring ? "Primeira ocorrência" : "Data prevista"} type="date" value={form.expenseDate} onChange={(v) => patch("expenseDate", v)} />
            )}
            <label className="flex min-h-12 items-center gap-3 self-end rounded-2xl border border-line bg-white px-4 text-sm font-black text-navy">
              <input type="checkbox" checked={form.isRecurring} disabled={form.wasRecurring} onChange={(e) => patch("isRecurring", e.target.checked)} className="h-5 w-5 accent-brand" />
              Recorrente
            </label>
            {form.isRecurring && (
              <>
                <Select label="Periodicidade" value={form.recurrencePeriod || "monthly"} onChange={(v) => patch("recurrencePeriod", v)} options={RECURRENCE_PERIODS} />
                <Field label="Encerra em (opcional)" type="date" value={form.recurrenceEndDate || ""} onChange={(v) => patch("recurrenceEndDate", v)} />
              </>
            )}
            <div className="sm:col-span-2 lg:col-span-3">
              <Field label="Observação (opcional)" value={form.note} onChange={(v) => patch("note", v)} />
            </div>
          </div>
          {form.wasRecurring && form.id && (
            <p className="mt-3 text-xs leading-5 text-muted">A alteração vale <strong className="text-navy">somente a partir da data acima</strong>: os meses anteriores, os pagamentos já confirmados e os relatórios históricos ficam como estão. Mudanças só na observação ou no encerramento não criam nova versão.</p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="submit" disabled={saving} className="premium-button-primary min-h-11 px-5">{saving ? "Salvando..." : "Salvar despesa"}</button>
            <button type="button" onClick={() => setForm(null)} className="premium-button-secondary min-h-11 px-5">Cancelar</button>
          </div>
        </form>
      )}

      <PaymentsToConfirm expenses={expenses} occurrences={occurrences} today={today} onOccurrencesChange={onOccurrencesChange} onFeedback={onFeedback} />

      {sorted.length > 0 && (
        <div className="mb-3 inline-flex max-w-full flex-wrap gap-1 rounded-full border border-line bg-white p-1" role="tablist" aria-label="Filtrar despesas">
          {[{ key: "all", label: "Todas" }, { key: "fixed", label: "Fixas/recorrentes" }, { key: "variable", label: "Variáveis/pontuais" }].map((tab) => (
            <button key={tab.key} type="button" role="tab" aria-selected={kind === tab.key} onClick={() => { setKind(tab.key); setShowAll(false); }}
              className={`min-h-9 rounded-full px-3 text-xs font-black ${kind === tab.key ? "bg-navy text-white" : "text-navy"}`}>
              {tab.label} ({counts[tab.key]})
            </button>
          ))}
        </div>
      )}

      {!sorted.length ? (
        <p className="rounded-2xl border border-dashed border-line bg-mist px-4 py-8 text-center text-sm font-bold text-muted">Nenhuma despesa cadastrada. Cadastre aluguel, sistemas, anúncios etc. para ver lucro, caixa e projeções.</p>
      ) : (
        <ul className="divide-y divide-line">
          {visible.map((expense) => {
            const period = RECURRENCE_PERIODS.find((p) => p.value === expense.recurrencePeriod)?.label;
            const type = OPERATING_EXPENSE_TYPES.find((t) => t.value === expense.expenseType)?.label;
            const ended = expense.isRecurring && expense.recurrenceEndDate && expense.recurrenceEndDate < today;
            const active = expense.isRecurring && !ended;
            return (
              <li key={expense.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-black text-navy">{expense.description}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted">
                    {expense.category} · {type}
                    {expense.isRecurring ? ` · ${period}${ended ? ` (encerrada em ${formatDate(expense.recurrenceEndDate)})` : expense.recurrenceEndDate ? ` até ${formatDate(expense.recurrenceEndDate)}` : ""} desde ${formatDate(expense.expenseDate)}` : ` · ${formatDate(expense.expenseDate)}`}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span className="text-base font-black text-navy">{formatMoney(expense.amount)}</span>
                  <span className="flex gap-1.5">
                    {active && <button type="button" onClick={() => endRecurrence(expense)} className="min-h-10 rounded-xl border border-line bg-white px-3 text-xs font-black text-navy hover:border-brand">Encerrar</button>}
                    <button type="button" aria-label={`Editar ${expense.description}`} onClick={() => setForm({ ...EMPTY_FORM, ...expense, amount: String(expense.amount).replace(".", ","), recurrenceEndDate: expense.recurrenceEndDate || "", recurrencePeriod: expense.recurrencePeriod || "monthly", wasRecurring: expense.isRecurring, effectiveFrom: expense.isRecurring ? today : "" })} className="inline-flex min-h-10 w-10 items-center justify-center rounded-xl border border-line bg-white text-navy hover:border-brand"><Pencil size={16} /></button>
                    <button type="button" aria-label={`Excluir ${expense.description}`} onClick={() => remove(expense)} className="inline-flex min-h-10 w-10 items-center justify-center rounded-xl border border-red-100 bg-white text-red-700 hover:bg-red-50"><Trash2 size={16} /></button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length > 12 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 text-sm font-black text-brand">{showAll ? "Mostrar menos" : `Ver todas (${filtered.length})`}</button>
      )}
    </Card>
  );
}

function PaymentsToConfirm({ expenses, occurrences, today, onOccurrencesChange, onFeedback }) {
  const [panel, setPanel] = useState(null); // { key, mode: "pay" | "reschedule", date, amount }
  const [busy, setBusy] = useState(false);
  const [showAllDue, setShowAllDue] = useState(false);

  const { due, paidRecent } = useMemo(() => {
    const all = collectExpenseEvents(expenses, { start: "2000-01-01", end: addDays(today, 45) }, today, occurrences);
    return {
      due: all.filter((e) => e.status === "planned").sort((a, b) => a.date.localeCompare(b.date)),
      paidRecent: all.filter((e) => e.status === "realized" && e.date >= addDays(today, -45)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)
    };
  }, [expenses, occurrences, today]);

  async function send(event, body, okText) {
    setBusy(true);
    try {
      const response = await fetch(`/api/financeiro/saude/despesas/${event.expenseId}/ocorrencias`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occurrenceDate: event.originalDate, ...body })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar.");
      onOccurrencesChange([...occurrences.filter((o) => !(o.expenseId === payload.expenseId && o.occurrenceDate === payload.occurrenceDate)), payload]);
      setPanel(null);
      onFeedback("success", okText);
    } catch (error) {
      onFeedback("error", error.message || "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  const keyOf = (e) => `${e.expenseId}|${e.originalDate}`;
  const visibleDue = showAllDue ? due : due.slice(0, 8);
  if (!due.length && !paidRecent.length) return null;

  return (
    <div className="mb-5 rounded-2xl border border-brand/25 bg-blue-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-black text-navy">Pagamentos a confirmar</p>
        <Tag kind="Previsto" />
      </div>
      <p className="mt-0.5 text-xs leading-5 text-muted">Despesa prevista só entra no lucro e no caixa depois que você confirma o pagamento. A data chegar não confirma.</p>

      {!due.length ? <p className="mt-3 text-sm font-bold text-muted">Nenhuma despesa prevista nos próximos 45 dias.</p> : (
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-white">
          {visibleDue.map((e) => {
            const key = keyOf(e);
            const open = panel?.key === key;
            const days = Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${e.date}T00:00:00Z`)) / 86400000);
            return (
              <li key={key} className="p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-black text-navy">{e.description}</p>
                    <p className="text-xs leading-5 text-muted">
                      {e.overdue ? <span className="font-black text-danger">Venceu há {days} {days === 1 ? "dia" : "dias"} ({formatDate(e.date)})</span> : e.date === today ? <span className="font-black text-warning">Vence hoje</span> : <>Vence em {formatDate(e.date)}</>}
                      {e.rescheduled && <> · reagendada (original {formatDate(e.originalDate)})</>} · {e.category}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                    <span className="font-black text-navy">{formatMoney(e.amount)}</span>
                    <span className="grid grid-cols-2 gap-1.5">
                      <button type="button" onClick={() => setPanel(open && panel.mode === "pay" ? null : { key, mode: "pay", date: today, amount: String(e.amount).replace(".", ",") })} className="min-h-10 rounded-xl bg-navy px-3 text-xs font-black leading-4 text-white">Confirmar pagamento</button>
                      <button type="button" onClick={() => setPanel(open && panel.mode === "reschedule" ? null : { key, mode: "reschedule", date: e.date < today ? today : e.date })} className="min-h-10 rounded-xl border border-line bg-white px-3 text-xs font-black text-navy hover:border-brand">Reagendar</button>
                    </span>
                  </div>
                </div>
                {open && panel.mode === "pay" && (
                  <div className="mt-3 grid gap-3 rounded-xl bg-mist p-3 min-[420px]:grid-cols-2">
                    <Field label="Data do pagamento" type="date" value={panel.date} onChange={(v) => setPanel({ ...panel, date: v })} />
                    <Field label="Valor pago (R$)" value={panel.amount} inputMode="decimal" onChange={(v) => setPanel({ ...panel, amount: v })} />
                    <div className="grid grid-cols-2 gap-2 min-[420px]:col-span-2">
                      <button type="button" disabled={busy} onClick={() => send(e, { action: "pay", paidDate: panel.date, paidAmount: panel.amount }, "Pagamento confirmado.")} className="premium-button-primary min-h-11 px-3 text-sm">{busy ? "Salvando..." : "Confirmar"}</button>
                      <button type="button" onClick={() => setPanel(null)} className="premium-button-secondary min-h-11 px-3 text-sm">Cancelar</button>
                    </div>
                  </div>
                )}
                {open && panel.mode === "reschedule" && (
                  <div className="mt-3 grid gap-3 rounded-xl bg-mist p-3 min-[420px]:grid-cols-2">
                    <Field label="Nova data prevista" type="date" value={panel.date} onChange={(v) => setPanel({ ...panel, date: v })} />
                    <div className="grid grid-cols-2 items-end gap-2">
                      <button type="button" disabled={busy} onClick={() => send(e, { action: "reschedule", rescheduledTo: panel.date }, "Despesa reagendada.")} className="premium-button-primary min-h-11 px-3 text-sm">{busy ? "Salvando..." : "Reagendar"}</button>
                      <button type="button" onClick={() => setPanel(null)} className="premium-button-secondary min-h-11 px-3 text-sm">Cancelar</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {due.length > 8 && <button type="button" onClick={() => setShowAllDue((v) => !v)} className="mt-2 text-sm font-black text-brand">{showAllDue ? "Mostrar menos" : `Ver todas (${due.length})`}</button>}

      {paidRecent.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-black text-navy">Pagas recentemente ({paidRecent.length})</summary>
          <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-white">
            {paidRecent.map((e) => (
              <li key={keyOf(e)} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-navy">{e.description}</p>
                  <p className="text-xs text-muted">Paga em {formatDate(e.date)} · {formatMoney(e.amount)}</p>
                </div>
                <button type="button" disabled={busy} onClick={() => { if (confirm(`Desfazer a confirmação de "${e.description}"? Ela volta a ser prevista.`)) send(e, { action: "undo" }, "Confirmação desfeita."); }} className="min-h-10 shrink-0 rounded-xl border border-line bg-white px-3 text-xs font-black text-navy hover:border-brand">Desfazer</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/* ---------- peças ---------- */

function Card({ title, subtitle, action, children }) {
  return (
    <section className="premium-card p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-black text-navy md:text-xl">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs leading-5 text-muted md:text-sm">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Kpi({ title, value, tag, delta, deltaPoints, vsLabel, inverse = false, negative = false, hint }) {
  const hasDelta = delta !== null && delta !== undefined;
  const hasPoints = deltaPoints !== null && deltaPoints !== undefined;
  const change = hasDelta ? delta : hasPoints ? deltaPoints : null;
  const up = change !== null && change > 0;
  const good = change === null ? null : inverse ? !up : up;
  return (
    <article className="premium-card flex min-w-0 flex-col p-3.5 md:p-4" title={hint}>
      <p className="text-[11px] font-black uppercase leading-4 tracking-[0.1em] text-brand">{title}</p>
      <p className={`mt-1.5 whitespace-nowrap text-[1.05rem] font-black leading-tight min-[400px]:text-xl xl:text-lg 2xl:text-2xl ${negative ? "text-danger" : "text-navy"}`}>{value}</p>
      <div className="mt-2"><Tag kind={tag} /></div>
      {change !== null && change !== 0 ? (
        <p className={`mt-1.5 flex items-start gap-1 text-xs font-bold leading-4 ${good ? "text-success" : "text-danger"}`}>
          {up ? <ArrowUpRight size={14} className="shrink-0" /> : <ArrowDownRight size={14} className="shrink-0" />}
          <span>{hasDelta ? `${fmtNumber(Math.abs(change))}%` : `${fmtNumber(Math.abs(change))} p.p.`} {vsLabel}</span>
        </p>
      ) : (
        <p className="mt-1.5 text-xs leading-4 text-muted">{hint && !hasDelta && !hasPoints ? <span className="line-clamp-3">{hint}</span> : change === 0 ? `Estável ${vsLabel}` : "Sem base comparável"}</p>
      )}
    </article>
  );
}

function Tag({ kind, compact = false }) {
  const map = {
    Realizado: "bg-blue-50 text-navy",
    Recebido: "bg-blue-50 text-navy",
    Previsto: "bg-white text-brand ring-1 ring-brand/40",
    Estimado: "bg-white text-muted ring-1 ring-dashed ring-muted/50"
  };
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${map[kind] || map.Realizado} ${compact ? "" : ""}`}>{kind}</span>;
}

function Metric({ label, value, sub }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-white px-4 py-3">
      <p className="text-[11px] font-black uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-1 break-words text-lg font-black text-navy">{value}</p>
      {sub && <p className="mt-0.5 text-xs leading-4 text-muted">{sub}</p>}
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "", inputMode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-sm font-black text-navy">{label}</span>
      <input type={type} value={value ?? ""} placeholder={placeholder} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} className="admin-input min-h-12 rounded-2xl" />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-sm font-black text-navy">{label}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="admin-input min-h-12 rounded-2xl">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

const NUMBER = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
function fmtNumber(value) {
  return NUMBER.format(Number(value || 0));
}

function formatDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
}
