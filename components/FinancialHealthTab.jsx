"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronDown, Info, OctagonAlert, Settings2 } from "lucide-react";
import { computeHealth, monthLabel, monthRange } from "@/lib/financial-health-core.mjs";
import { BrokerResultChart, EvolutionChart, formatMoney } from "@/components/FinancialHealthCharts";
import { AccountsPanel, RegisteredExpenses, useHealthAccounts } from "@/components/FinancialHealthAccounts";
import { SelectInput, Tag, TextInput, fmtNumber, formatDate, round2, useHealthToast } from "@/components/FinancialHealthUi";
import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import { cx } from "@/components/ui/cx";

// Aba "Saúde" (só admin geral — montada por AdminFinancialDashboard apenas quando o servidor entrega `health`).
// Ordem da tela: cabeçalho enxuto → 3 números (Resultado, Caixa, Expectativa) → Contas a pagar → indicadores
// → análise → histórico → contas cadastradas. Fórmulas: lib/financial-health-core.mjs + docs/FINANCEIRO_SAUDE.md.

const PERIOD_OPTIONS = [
  { value: "month", label: "Este mês" },
  { value: "lastMonth", label: "Mês anterior" },
  { value: "pick", label: "Escolher mês" },
  { value: "quarter", label: "Este trimestre" },
  { value: "year", label: "Este ano" },
  { value: "custom", label: "Personalizado" }
];

const LEVEL_STYLES = {
  healthy: { label: "Saudável", icon: CheckCircle2, cls: "bg-success-soft text-success ring-success-line" },
  attention: { label: "Atenção", icon: AlertTriangle, cls: "bg-warning-soft text-warning ring-warning-line" },
  critical: { label: "Crítico", icon: OctagonAlert, cls: "bg-danger-soft text-danger ring-danger-line" }
};

export default function FinancialHealthTab({ sales = [], initialExpenses = [], initialOccurrences = [], initialSettings = {}, eligibleBrokers = [], today }) {
  const [expenses, setExpenses] = useState(initialExpenses);
  const [occurrences, setOccurrences] = useState(initialOccurrences);
  const [settings, setSettings] = useState(initialSettings);
  const [period, setPeriod] = useState("month");
  const [pickedMonth, setPickedMonth] = useState(today.slice(0, 7));
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notify, toastElement] = useHealthToast();

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
  const acc = useHealthAccounts({ expenses, occurrences, today, range: health.range, onExpensesChange: setExpenses, onOccurrencesChange: setOccurrences, notify });

  // Todos os corretores elegíveis aparecem no gráfico, inclusive com R$ 0,00 no período. Só apresentação:
  // o resultado de cada um continua vindo de health.byBroker (cálculo inalterado).
  const brokerRows = useMemo(() => {
    const norm = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const rows = health.byBroker.map((row) => ({ ...row }));
    const matches = (row, user) => row.key === user.id || (user.email && row.key === user.email) || norm(row.name) === norm(user.name);
    for (const user of eligibleBrokers) {
      if (!user?.name || rows.some((row) => matches(row, user))) continue;
      rows.push({ key: `eligible-${user.id}`, name: user.name, agencyResult: 0, grossReceived: 0, repasses: 0, otherCosts: 0, salesCount: 0 });
    }
    return rows.sort((a, b) => b.agencyResult - a.agencyResult || a.name.localeCompare(b.name, "pt-BR"));
  }, [health.byBroker, eligibleBrokers]);

  const fullMonth = health.range.start.slice(8) === "01" && monthRange(health.range.start).end === health.range.end;
  const vsLabel = fullMonth ? "vs mês anterior" : "vs período anterior";
  const periodTitle = fullMonth ? monthLabel(health.range.start) : `${formatDate(health.range.start)} a ${formatDate(health.range.end)}`;

  return (
    <div className="space-y-5">
      {/* 1. Cabeçalho enxuto */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-brand">Saúde financeira</p>
          <h2 className="mt-0.5 text-[26px] font-bold leading-8 tracking-[-0.02em] text-navy sm:text-[30px] sm:leading-9">{periodTitle}</h2>
        </div>
        <div className={cx("grid gap-3", period === "custom" ? "grid-cols-2 sm:w-[520px]" : period === "pick" ? "grid-cols-2 sm:w-[360px]" : "sm:w-[220px]")}>
          <SelectInput label="Período" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} className={period === "custom" ? "col-span-2" : ""} />
          {period === "pick" && <TextInput label="Mês" type="month" value={pickedMonth} onChange={setPickedMonth} />}
          {period === "custom" && (
            <>
              <TextInput label="Data inicial" type="date" value={customStart} onChange={setCustomStart} />
              <TextInput label="Data final" type="date" value={customEnd} onChange={setCustomEnd} />
            </>
          )}
        </div>
      </header>

      {/* 2 e 3. Faixa de 3 números + Contas a pagar. Desktop: 3 cartões lado a lado e as contas abaixo.
          Celular: Resultado, depois Contas a pagar ("o que pago agora?"), depois Caixa e Expectativa. */}
      <div className="grid gap-x-3 gap-y-4 lg:grid-cols-[1.15fr_1fr_1fr] lg:gap-y-5">
        <section aria-label="Resultado líquido" className="order-1 flex flex-col"><ResultCard summary={summary} changes={changes} vsLabel={vsLabel} /></section>
        <section aria-label="Caixa" className="order-3 flex flex-col lg:order-2"><CashCard health={health} settings={settings} onConfigure={() => setSettingsOpen(true)} /></section>
        <section aria-label="Expectativa do mês" className="order-4 flex flex-col lg:order-3"><ExpectationCard health={health} /></section>
        <div className="order-2 min-w-0 lg:order-4 lg:col-span-3"><AccountsPanel acc={acc} periodLabel={periodTitle} /></div>
      </div>

      {/* 6. Indicadores secundários + como o mês fecha */}
      <Panel title="Indicadores do período" subtitle={`${periodTitle} · só o que de fato entrou e saiu`}>
        <dl className="divide-y divide-line">
          <IndicatorRow title="Comissão recebida" value={formatMoney(summary.revenueGross)} tag="Recebido" delta={changes.revenue} vsLabel={vsLabel} sub="Comissão bruta efetivamente recebida" />
          <IndicatorRow title="Repasses" value={formatMoney(summary.repasses)} tag="Realizado" delta={changes.repasses} vsLabel={vsLabel} inverse sub="Corretor, gestor e outros participantes da venda. Não são despesas operacionais." />
          <IndicatorRow title="Nota fiscal" value={formatMoney(summary.invoice)} tag="Realizado" delta={changes.invoice} vsLabel={vsLabel} inverse sub="Despesa fiscal de cada venda (percentual próprio) sobre a comissão recebida." />
          <IndicatorRow title="Despesas operacionais" value={formatMoney(summary.operatingTotal)} tag="Realizado" delta={changes.operating} vsLabel={vsLabel} inverse
            sub={`Pagas: da empresa ${formatMoney(summary.operatingExpenses)} + ligadas a vendas ${formatMoney(summary.saleExpenses)}. Previstas não entram.`} />
        </dl>
        <details className="group mt-3 rounded-card border border-line">
          <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-semibold text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
            <span>Como o mês fecha <span className="font-medium text-muted">· realizado × previsto</span></span>
            <ChevronDown className="h-4 w-4 transition-transform duration-150 ease-out-ui group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
          <div className="border-t border-line p-4">
            <ExpectationBlock health={health} />
          </div>
        </details>
      </Panel>

      {/* 6. Análise: 2 colunas no desktop, empilhada no celular */}
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Panel title="Ponto de equilíbrio" subtitle="Quanto precisa entrar para cobrir a operação do período">
          <BreakEvenBlock be={health.breakEven} />
        </Panel>

        <Panel title="Apontamentos financeiros" subtitle="Fato, apontamento e recomendação — nenhuma despesa é julgada sem evidência">
          <Insights items={health.insights} />
          {(health.dataQuality.undatedReceived > 0 || health.dataQuality.undatedExpected > 0) && (
            <p className="mt-3 flex items-start gap-2 rounded-control border border-warning-line bg-warning-soft px-3 py-2 text-sm font-medium text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Dados incompletos: {health.dataQuality.undatedReceived} recebimento(s) marcado(s) como recebido e {health.dataQuality.undatedExpected} previsto(s) sem data não entram nos cálculos por período.
            </p>
          )}
        </Panel>

        <Panel title="Resultado da imobiliária por corretor" subtitle="Parte da imobiliária nas comissões efetivamente recebidas no período">
          <BrokerResultChart rows={brokerRows} />
          <p className="mt-3 text-sm leading-5 text-ink-2">Não é VGV nem comissão bruta: é o que sobra para a imobiliária depois de repasses, despesas da venda, nota e comissões de corretor/gestor. Despesas operacionais da empresa não são atribuídas a corretor.</p>
        </Panel>

        <Panel title="Evolução financeira" subtitle={`${monthLabel(health.evolution.previousMonth.start, false)} × ${monthLabel(health.evolution.currentMonth.start, false)} × projeção`}>
          <EvolutionChart evolution={health.evolution} previousLabel={monthLabel(health.evolution.previousMonth.start, false)} currentLabel={monthLabel(health.evolution.currentMonth.start, false)} />
        </Panel>
      </div>

      <Panel title="Histórico mensal" subtitle="Últimos 6 meses — receita, despesas, lucro, margem e caixa">
        <HistoryList rows={health.history} cashConfigured={health.cashConfigured} />
      </Panel>

      {/* Contas cadastradas: editar, encerrar, excluir */}
      <RegisteredExpenses acc={acc} />

      {/* `contents`: janelas e aviso ficam fora do espaçamento entre seções (space-y) */}
      <div className="contents">
        <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Configuração do caixa" description="O sistema nunca inventa saldo: informe o saldo real do caixa na data inicial.">
          <SettingsForm
            settings={settings}
            onSaved={(next) => { setSettings(next); setSettingsOpen(false); notify("Configuração de caixa salva."); }}
            onCancel={() => setSettingsOpen(false)}
          />
        </Sheet>

        {acc.sheets}
        {toastElement}
      </div>
    </div>
  );
}

/* ---------- faixa principal ---------- */

function HeroCard({ label, tag, children, action, className }) {
  return (
    <article className={cx("flex min-w-0 flex-1 flex-col rounded-card border border-line bg-white p-4 sm:p-5", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold text-ink-2">{label}</h3>
          {tag && <Tag kind={tag} />}
        </div>
        {action}
      </div>
      {children}
    </article>
  );
}

function ResultCard({ summary, changes, vsLabel }) {
  const negative = summary.profit < 0;
  const change = changes.profit;
  const points = changes.marginDeltaPoints;
  return (
    <HeroCard label="Resultado líquido" tag="Realizado" className="border-navy/20 bg-info-soft/30">
      <p className={cx("mt-2 truncate text-[32px] font-bold leading-10 tracking-[-0.02em] tabular-nums sm:text-[36px] sm:leading-[44px]", negative ? "text-danger" : "text-navy")}>{formatMoney(summary.profit)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-ink-2">Margem <strong className="font-semibold tabular-nums text-ink">{summary.marginPercent === null ? "—" : `${fmtNumber(summary.marginPercent)}%`}</strong>
          {points !== null && points !== 0 && <span className="ml-1 text-xs text-muted tabular-nums">({points > 0 ? "+" : "−"}{fmtNumber(Math.abs(points))} p.p.)</span>}
        </span>
        <Delta value={change} vsLabel={vsLabel} fallback="Sem base comparável" />
      </div>
      <p className="mt-auto pt-3 text-xs leading-4 text-muted max-sm:hidden">Comissão recebida − repasses − nota fiscal − despesas pagas.</p>
    </HeroCard>
  );
}

function CashCard({ health, settings, onConfigure }) {
  const levelStyle = health.reserve.level ? LEVEL_STYLES[health.reserve.level] : null;
  const coverage = health.reserve.coverageMonths;
  const configured = health.cash !== null;
  return (
    <HeroCard
      label="Caixa atual"
      tag="Realizado"
      action={configured ? (
        <button type="button" onClick={onConfigure} aria-label="Configuração do caixa" className="-m-1.5 inline-flex h-touch w-touch items-center justify-center rounded-control text-ink-2 transition-colors hover:bg-navy/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <Settings2 className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : null}
    >
      {configured ? (
        <>
          <p className={cx("mt-2 truncate text-[32px] font-bold leading-10 tracking-[-0.02em] tabular-nums", health.cash < 0 ? "text-danger" : "text-navy")}>{formatMoney(health.cash)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {levelStyle && (
              <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold ring-1 ring-inset", levelStyle.cls)}>
                <levelStyle.icon className="h-4 w-4" aria-hidden="true" />
                {levelStyle.label}
              </span>
            )}
            <span className="text-sm text-ink-2">{coverage === null ? "Cobertura indisponível" : <>cobre <strong className="font-semibold tabular-nums text-ink">{fmtNumber(coverage)} {coverage === 1 ? "mês" : "meses"}</strong> da operação</>}</span>
          </div>
          <p className="mt-auto pt-3 text-xs leading-4 text-muted">
            {health.operatingCost.value > 0 ? <>Reserva recomendada {formatMoney(health.reserve.recommended)} ({fmtNumber(health.reserve.reserveMonths)} meses). </> : "Cadastre contas para calcular a cobertura. "}
            Saldo inicial de {formatDate(settings.openingCashDate)}.
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-[22px] font-bold leading-8 tracking-[-0.01em] text-ink-2">Caixa não configurado</p>
          <p className="mt-1 text-sm leading-5 text-ink-2">Informe o saldo real do caixa para acompanhar a cobertura da operação.</p>
          <div className="mt-auto pt-3"><Button variant="secondary" onClick={onConfigure} className="max-sm:w-full"><Settings2 size={18} aria-hidden="true" /> Configurar caixa</Button></div>
        </>
      )}
      <details className="mt-3 text-xs leading-5 text-ink-2">
        <summary className="min-h-touch cursor-pointer list-none py-2.5 font-semibold text-brand focus-visible:outline-none focus-visible:underline [&::-webkit-details-marker]:hidden">Como a cobertura é calculada</summary>
        <p className="pb-1">Custo operacional mensal de referência: <strong className="text-ink">{formatMoney(health.operatingCost.value)}</strong> (maior entre a média dos 3 últimos meses fechados — {formatMoney(health.operatingCost.average3m)} — e as contas recorrentes ativas — {formatMoney(health.operatingCost.recurring)}). Gastos extraordinários não entram.</p>
      </details>
    </HeroCard>
  );
}

function ExpectationCard({ health }) {
  const { expectation, currentSummary: c } = health;
  if (!expectation.available) {
    return (
      <HeroCard label="Expectativa do mês" tag="Previsto">
        <p className="mt-2 text-[32px] font-bold leading-10 text-faint">—</p>
        <p className="mt-1 text-sm text-ink-2">A expectativa considera o mês atual.</p>
      </HeroCard>
    );
  }
  const realized = c.profit;
  const planned = round2(expectation.result - c.profit);
  const total = Math.abs(realized) + Math.abs(planned);
  const realizedShare = total > 0 ? (Math.abs(realized) / total) * 100 : 50;
  return (
    <HeroCard label="Expectativa do mês" tag="Previsto">
      <p className={cx("mt-2 truncate text-[32px] font-bold leading-10 tracking-[-0.02em] tabular-nums", expectation.result < 0 ? "text-danger" : "text-navy")}>{formatMoney(expectation.result)}</p>
      <p className="text-sm text-ink-2">Resultado projetado de {monthLabel(expectation.monthStart, false)}</p>
      <div className="mt-3" role="group" aria-label="Já realizado e ainda previsto">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-navy/[0.06]" aria-hidden="true">
          <span className="block h-full bg-navy" style={{ width: `${realizedShare}%` }} />
          <span className="block h-full flex-1 bg-info-line" />
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
          <div className="min-w-0">
            <dt className="flex items-center gap-1.5 text-xs text-ink-2"><span className="h-2 w-2 shrink-0 rounded-full bg-navy" aria-hidden="true" />Já realizado</dt>
            <dd className="truncate font-semibold tabular-nums text-ink">{formatMoney(realized)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-1.5 text-xs text-ink-2"><span className="h-2 w-2 shrink-0 rounded-full bg-info-line ring-1 ring-brand/40" aria-hidden="true" />Ainda previsto</dt>
            <dd className="truncate font-semibold tabular-nums text-ink">{formatMoney(planned)}</dd>
          </div>
        </dl>
      </div>
    </HeroCard>
  );
}

/* ---------- peças ---------- */

function Panel({ title, subtitle, children }) {
  return (
    <section className="min-w-0 rounded-card border border-line bg-white p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="text-lg font-semibold tracking-[-0.01em] text-navy">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Delta({ value, points = false, inverse = false, vsLabel, fallback = "" }) {
  if (value === null || value === undefined) return fallback ? <span className="text-xs text-muted">{fallback}</span> : null;
  if (value === 0) return <span className="text-xs text-muted">Estável {vsLabel}</span>;
  const up = value > 0;
  const good = inverse ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cx("inline-flex items-center gap-1 text-sm font-semibold tabular-nums", good ? "text-success" : "text-danger")}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {fmtNumber(Math.abs(value))}{points ? " p.p." : "%"} <span className="font-medium text-ink-2">{vsLabel}</span>
    </span>
  );
}

function IndicatorRow({ title, value, tag, delta, vsLabel, inverse = false, sub }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 py-3 md:grid-cols-[minmax(0,1fr)_9rem_13rem] md:items-center">
      <div className="min-w-0">
        <dt className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">{title}<Tag kind={tag} /></dt>
        <p className="mt-0.5 text-sm leading-5 text-ink-2">{sub}</p>
      </div>
      <dd className="text-right text-lg font-bold tabular-nums text-ink md:order-none">{value}</dd>
      <div className="col-span-2 md:col-span-1 md:text-right"><Delta value={delta} inverse={inverse} vsLabel={vsLabel} fallback="Sem base comparável" /></div>
    </div>
  );
}

function ExpectationBlock({ health }) {
  const { expectation, currentSummary: c } = health;
  if (!expectation.available) {
    return <p className="rounded-card border border-dashed border-line bg-mist px-4 py-6 text-center text-sm font-medium text-ink-2">A expectativa considera o mês atual.</p>;
  }
  const projected = c.projected;
  const expectedResult = round2(c.expectedGross - c.expectedRepasses - c.expectedInvoice - c.expectedOperating);
  const rows = [
    { label: "Comissão (receita)", real: c.revenueGross, planned: c.expectedGross, sign: 1,
      sub: [expectation.forecastIncluded > 0 ? `previsto inclui ${formatMoney(expectation.forecastIncluded)} da previsão de recebimento do saldo` : null, expectation.overdue > 0 ? `${formatMoney(expectation.overdue)} vencido` : null].filter(Boolean).join(" · ") || null },
    { label: "Repasses", real: c.repasses, planned: c.expectedRepasses, sign: -1, sub: "corretor, gestor e participantes" },
    { label: "Nota fiscal", real: c.invoice, planned: c.expectedInvoice, sign: -1 },
    { label: "Despesas operacionais", real: c.operatingTotal, planned: c.expectedOperating, sign: -1,
      sub: expectation.operatingOverdue > 0 ? `previstas incluem ${formatMoney(expectation.operatingOverdue)} vencidas aguardando confirmação` : null }
  ];
  const grid = "grid grid-cols-[minmax(0,1fr)_6.25rem_6.25rem] items-start gap-x-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]";
  return (
    <div>
      <div className={cx(grid, "items-center")}>
        <span />
        <span className="text-right"><Tag kind="Realizado" /></span>
        <span className="text-right"><Tag kind="Previsto" /></span>
      </div>
      <ul className="mt-1 divide-y divide-line">
        {rows.map((row) => (
          <li key={row.label} className={cx(grid, "py-2.5")}>
            <span className="text-sm text-ink-2">{row.sign < 0 ? "(−) " : ""}{row.label}{row.sub && <span className="block text-xs leading-4 text-brand">{row.sub}</span>}</span>
            <span className="text-right text-sm font-semibold tabular-nums text-ink">{formatMoney(row.real)}</span>
            <span className="text-right text-sm font-semibold tabular-nums text-brand">{formatMoney(row.planned)}</span>
          </li>
        ))}
        <li className={cx(grid, "items-center py-2.5")}>
          <span className="text-sm font-bold text-navy">= Resultado líquido</span>
          <span className={cx("text-right text-sm font-bold tabular-nums", c.profit < 0 ? "text-danger" : "text-navy")}>{formatMoney(c.profit)}</span>
          <span className={cx("text-right text-sm font-bold tabular-nums", expectedResult < 0 ? "text-danger" : "text-brand")}>{formatMoney(expectedResult)}</span>
        </li>
      </ul>
      <div className="mt-2 flex items-center justify-between gap-3 rounded-card bg-info-soft px-4 py-3">
        <span className="text-sm font-semibold text-navy">Resultado líquido projetado <span className="font-medium text-ink-2">(realizado + previsto)</span></span>
        <span className={cx("text-lg font-bold tabular-nums", projected.result < 0 ? "text-danger" : "text-navy")}>{formatMoney(projected.result)}</span>
      </div>
      <p className="mt-2 text-sm leading-5 text-ink-2">A coluna Previsto é o que ainda vai acontecer (recebimentos com data, previsão do saldo, contas ainda não pagas) e nunca é somada ao Realizado nas colunas. Repasses e nota fiscal são apropriados proporcionalmente ao valor recebido.</p>
      {health.estimate && health.estimate.remaining > 0 && (
        <div className="mt-3 rounded-card border border-dashed border-brand/40 bg-info-soft/50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-navy"><Tag kind="Estimado" /> Despesas variáveis ainda não lançadas</p>
          <p className="mt-1 text-sm leading-5 text-ink-2">
            Pela média dos 3 meses anteriores ({formatMoney(health.estimate.average3m)}), podem surgir cerca de <strong className="text-ink">{formatMoney(health.estimate.remaining)}</strong> até o fim do mês.
            Com essa estimativa, o resultado seria <strong className="text-ink">{formatMoney(projected.result - health.estimate.remaining)}</strong>. A estimativa <u>não</u> está incluída no resultado projetado acima.
          </p>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, sub }) {
  return (
    <div className="min-w-0 rounded-card bg-mist px-3.5 py-3">
      <p className="text-xs font-medium text-ink-2">{label}</p>
      <p className="mt-0.5 break-words text-lg font-bold tabular-nums text-navy">{value}</p>
      {sub && <p className="mt-0.5 text-xs leading-4 text-muted">{sub}</p>}
    </div>
  );
}

function BreakEvenBlock({ be }) {
  if (be.operatingNeeded <= 0) {
    return <p className="rounded-card border border-dashed border-line bg-mist px-4 py-6 text-center text-sm font-medium text-ink-2">Sem despesas operacionais no período — não há o que cobrir.</p>;
  }
  const useGross = be.grossNeeded !== null;
  const needed = useGross ? be.grossNeeded : be.operatingNeeded;
  const received = useGross ? be.grossReceived : be.netReceived;
  const gap = useGross ? be.grossGap : be.netGap;
  const pct = needed > 0 ? Math.min(100, Math.round((received / needed) * 100)) : 0;
  return (
    <div>
      <div className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-3">
        <Metric label="Ponto de equilíbrio" value={formatMoney(needed)} sub={useGross ? "receita bruta necessária" : "parte da imobiliária necessária"} />
        <Metric label="Recebido" value={formatMoney(received)} />
        <Metric label={gap > 0 ? "Falta" : "Meta atingida"} value={gap > 0 ? formatMoney(gap) : "Sim"} />
      </div>
      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-navy/[0.06]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso até o ponto de equilíbrio">
        <div className={cx("h-full rounded-full", gap > 0 ? "bg-brand" : "bg-success-strong")} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-right text-xs tabular-nums text-muted">{pct}% do ponto de equilíbrio</p>
      <p className="mt-2 text-sm leading-5 text-ink-2">
        Fórmula: despesas operacionais do período ({formatMoney(be.operatingNeeded)}, realizadas + previstas)
        {useGross ? <> ÷ margem de contribuição de {fmtNumber(be.contributionPercent)}% (parte da imobiliária ÷ comissão bruta recebida nos últimos 6 meses)</> : <>. Ainda não há recebimentos históricos para calcular a margem de contribuição; mostrando o valor líquido da imobiliária.</>}.
      </p>
    </div>
  );
}

function HistoryList({ rows, cashConfigured }) {
  const cashText = (row) => (row.cashEnd === null ? (cashConfigured ? "—" : "não configurado") : formatMoney(row.cashEnd));
  return (
    <div>
      {/* Celular: um cartão por mês */}
      <ul className="space-y-2.5 md:hidden">
        {rows.map((row) => (
          <li key={row.month} className={cx("rounded-card border p-3.5", row.isCurrent ? "border-brand/40 bg-info-soft/40" : "border-line")}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[15px] font-semibold text-navy">{row.label}{row.isCurrent && <span className="ml-2 rounded-chip bg-navy px-1.5 py-0.5 align-middle text-2xs font-semibold uppercase text-white">atual</span>}</p>
              <p className={cx("text-lg font-bold tabular-nums", row.profit < 0 ? "text-danger" : "text-navy")}>{formatMoney(row.profit)}</p>
            </div>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <div><dt className="text-xs text-ink-2">Receita</dt><dd className="font-semibold tabular-nums text-ink">{formatMoney(row.revenueGross)}</dd></div>
              <div><dt className="text-xs text-ink-2">Despesas</dt><dd className="font-semibold tabular-nums text-ink">{formatMoney(row.expenses)}</dd></div>
              <div><dt className="text-xs text-ink-2">Margem</dt><dd className="font-semibold tabular-nums text-ink">{row.marginPercent === null ? "—" : `${fmtNumber(row.marginPercent)}%`}</dd></div>
              <div><dt className="text-xs text-ink-2">Caixa no fim</dt><dd className="font-semibold tabular-nums text-ink">{cashText(row)}</dd></div>
            </dl>
            {row.projected && <p className="mt-2.5 text-xs text-ink-2">Projeção: realizado <strong className="tabular-nums text-ink">{formatMoney(row.profit)}</strong> · projetado <strong className="tabular-nums text-ink">{formatMoney(row.projected.result)}</strong></p>}
          </li>
        ))}
      </ul>

      {/* Desktop: tabela */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold text-ink-2">
              <th scope="col" className="py-2 pr-3 font-semibold">Mês</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Receita</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Despesas</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Lucro</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Margem</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Caixa no fim</th>
              <th scope="col" className="py-2 text-right font-semibold">Projeção × realizado</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((row) => (
              <tr key={row.month} className={cx("border-b border-line/70", row.isCurrent && "bg-info-soft/40")}>
                <th scope="row" className="whitespace-nowrap py-2.5 pr-3 text-left font-semibold text-navy" title={row.label}>{row.shortLabel}{row.isCurrent && <span className="ml-2 text-2xs font-semibold uppercase text-brand">atual</span>}</th>
                <td className="py-2.5 pr-3 text-right">{formatMoney(row.revenueGross)}</td>
                <td className="py-2.5 pr-3 text-right">{formatMoney(row.expenses)}</td>
                <td className={cx("py-2.5 pr-3 text-right font-semibold", row.profit < 0 ? "text-danger" : "text-navy")}>{formatMoney(row.profit)}</td>
                <td className="py-2.5 pr-3 text-right">{row.marginPercent === null ? "—" : `${fmtNumber(row.marginPercent)}%`}</td>
                <td className="py-2.5 pr-3 text-right">{cashText(row)}</td>
                <td className="py-2.5 text-right text-xs text-ink-2">
                  {row.projected ? <>realizado {formatMoney(row.profit)}<br />projetado {formatMoney(row.projected.result)}</> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-ink-2">A projeção só existe para o mês em andamento; meses encerrados mostram apenas o realizado.</p>
    </div>
  );
}

function Insights({ items }) {
  if (!items.length) {
    return <p className="rounded-card border border-dashed border-line bg-mist px-4 py-6 text-center text-sm font-medium text-ink-2">Sem apontamentos no período. Cadastre contas e recebimentos para que a análise apareça.</p>;
  }
  const style = {
    positive: { icon: CheckCircle2, cls: "border-success-line bg-success-soft", iconCls: "text-success" },
    attention: { icon: AlertTriangle, cls: "border-warning-line bg-warning-soft", iconCls: "text-warning" },
    critical: { icon: OctagonAlert, cls: "border-danger-line bg-danger-soft", iconCls: "text-danger" },
    info: { icon: Info, cls: "border-line bg-mist", iconCls: "text-brand" }
  };
  return (
    <ul className="space-y-2.5">
      {items.map((item) => {
        const s = style[item.level] || style.info;
        const Icon = s.icon;
        return (
          <li key={item.id} className={cx("rounded-card border px-3.5 py-3", s.cls)}>
            <div className="flex gap-3">
              <Icon size={18} className={cx("mt-0.5 shrink-0", s.iconCls)} aria-hidden="true" />
              <div className="min-w-0 space-y-1 text-sm leading-6">
                <p><strong className="font-semibold text-navy">Fato:</strong> <span className="text-ink">{item.fact}</span></p>
                {item.flag && <p><strong className="font-semibold text-navy">Apontamento:</strong> <span className="text-ink">{item.flag}</span></p>}
                {item.recommendation && <p><strong className="font-semibold text-navy">Recomendação:</strong> <span className="text-ink">{item.recommendation}</span></p>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SettingsForm({ settings, onSaved, onCancel }) {
  const [balance, setBalance] = useState(settings.openingCashBalance === null || settings.openingCashBalance === undefined ? "" : String(settings.openingCashBalance).replace(".", ","));
  const [date, setDate] = useState(settings.openingCashDate || "");
  const [reserve, setReserve] = useState(String(settings.reserveMonths ?? 3).replace(".", ","));
  const [critical, setCritical] = useState(String(settings.criticalMonths ?? 1).replace(".", ","));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/financeiro/saude", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openingCashBalance: balance, openingCashDate: date, reserveMonths: reserve, criticalMonths: critical })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar.");
      onSaved(payload.settings);
    } catch (caught) {
      setError(caught instanceof TypeError ? "Sem conexão com o servidor. Confira a internet e tente de novo." : caught.message || "Não foi possível salvar.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <p className="text-sm text-ink-2">Em branco = caixa não acompanhado. A cobertura compara o caixa com o custo mensal da operação.</p>
      <TextInput label="Saldo inicial (R$)" value={balance} onChange={setBalance} inputMode="decimal" placeholder="Ex.: 15000,00" autoComplete="off" />
      <TextInput label="Saldo válido desde" type="date" value={date} onChange={setDate} />
      <div className="grid grid-cols-2 gap-3">
        <TextInput label="Reserva desejada (meses)" value={reserve} onChange={setReserve} inputMode="decimal" />
        <TextInput label="Crítico até (meses)" value={critical} onChange={setCritical} inputMode="decimal" />
      </div>
      {error && <p className="rounded-control border border-danger-line bg-danger-soft px-3 py-2 text-sm font-medium text-danger" role="alert">{error}</p>}
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" loading={saving}>Salvar configuração</Button>
      </div>
    </form>
  );
}
