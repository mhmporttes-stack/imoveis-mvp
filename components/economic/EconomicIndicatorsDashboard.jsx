"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Tabs from "@/components/ui/Tabs";
import { buttonClasses } from "@/components/ui/Button";
import { BarChart, LineChart, SERIES_COLORS } from "@/components/economic/EconomicCharts";
import {
  ECON_CATEGORIES,
  ECON_INDICATORS,
  CORRECTION_CODES,
  compareLatest,
  directionTone,
  formatValue,
  indicatorByCode,
  labelMonth,
  referenceLabel
} from "@/lib/economic-indicators-core.mjs";

// Tela "Indicadores Econômicos" (dono, 2026-10-29 — ECON-1). Dados iniciais vêm do servidor (banco); o histórico dos
// gráficos é buscado sob demanda. Nada aqui chama fonte externa nem o Supabase direto.

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const PCT = (v, d = 2) => `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v)}%`;

const FRESHNESS = {
  ok: null,
  stale: { text: "Desatualizado", className: "border-line bg-mist text-muted" },
  error: { text: "Falha na atualização", className: "border-warning-line bg-warning-soft text-warning" },
  empty: { text: "Aguardando 1ª coleta", className: "border-line bg-mist text-muted" }
};

function formatDateTime(value) {
  return value ? DATE_TIME.format(new Date(value)) : "—";
}

const TONE_CLASS = { good: "text-success", bad: "text-danger", neutral: "text-ink-2" };

function Direction({ direction, code = "", className = "h-4 w-4" }) {
  // IPCA/INCC (dono, 2026-10-29): queda verde, alta vermelha. Demais indicadores: seta neutra.
  const tone = TONE_CLASS[directionTone(code, direction)];
  if (direction === "up") return <ArrowUpRight aria-label="alta" className={`${className} ${tone}`} />;
  if (direction === "down") return <ArrowDownRight aria-label="queda" className={`${className} ${tone}`} />;
  if (direction === "stable") return <ArrowRight aria-label="estável" className={`${className} text-muted`} />;
  return null;
}

function IndicatorCard({ item }) {
  const indicator = indicatorByCode(item.code);
  const badge = FRESHNESS[item.freshness];
  const change = item.latest && item.previous ? compareLatest(indicator, [item.previous, item.latest]) : null;
  return (
    <Card padding="sm" className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-extrabold text-ink">{indicator.name}</h3>
          <p className="truncate text-2xs text-muted" title={indicator.description}>{indicator.description}</p>
        </div>
        {badge ? <span className={`shrink-0 rounded-full border px-2 py-0.5 text-2xs font-bold ${badge.className}`}>{badge.text}</span> : null}
      </div>
      {item.latest ? (
        <>
          <p className="flex items-baseline gap-1.5">
            <span className="text-xl font-black text-ink">{formatValue(indicator, item.latest.value)}</span>
            {change ? <Direction direction={change.direction} code={item.code} /> : null}
            <span className="text-xs text-muted">{indicator.kind === "monthly_rate" ? "no mês" : ""}</span>
          </p>
          <p className="text-xs text-muted">Referência: <b className="text-ink-2">{item.latest.label}</b>{item.previous ? <> · anterior {formatValue(indicator, item.previous.value)}</> : null}</p>
          {indicator.kind === "monthly_rate" ? (
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div><dt className="text-muted">No ano</dt><dd className="font-bold text-ink">{item.ytd === null ? "—" : PCT(item.ytd)}</dd></div>
              <div><dt className="text-muted">12 meses</dt><dd className="font-bold text-ink">{item.twelveMonths === null ? "—" : PCT(item.twelveMonths)}</dd></div>
            </dl>
          ) : null}
        </>
      ) : (
        <p className="py-2 text-sm text-muted">Ainda sem dado gravado.</p>
      )}
      <p className="mt-auto pt-1 text-2xs text-faint">Fonte: {indicator.sourceLabel} · atualizado em {formatDateTime(item.lastSuccessAt)}</p>
    </Card>
  );
}

function Section({ title, note, children }) {
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-base font-extrabold text-ink">{title}</h2>
        {note ? <p className="text-xs text-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function IndicatorGrid({ items }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map((item) => <IndicatorCard key={item.code} item={item} />)}</div>;
}

// ---------- Comparativo de bancos ----------
function BankRates({ bankRates }) {
  const modalities = bankRates?.modalities || [];
  const [modality, setModality] = useState(() => modalities.find((m) => /mercado - Prefixado$/.test(m.modality))?.modality || modalities[0]?.modality || "");
  const current = modalities.find((m) => m.modality === modality);
  return (
    <Card title="Taxas médias de financiamento imobiliário por instituição" note={bankRates?.month ? `Período: ${labelMonth(bankRates.month.slice(0, 7))}` : null}>
      <p className="mb-3 rounded-chip border border-line bg-mist px-3 py-2 text-xs text-ink-2">
        Médias de mercado informadas pelas instituições ao Banco Central (taxa média ao ano das operações contratadas no período, pessoa física).
        <b> Não é a taxa oferecida a um cliente</b> — a taxa de cada cliente depende de renda, prazo, programa e relacionamento com o banco.
      </p>
      {modalities.length ? (
        <>
          <label className="mb-3 grid gap-1 text-xs font-bold text-ink">
            Modalidade
            <select className="admin-input" value={modality} onChange={(event) => setModality(event.target.value)}>
              {modalities.map((m) => <option key={m.modality} value={m.modality}>{m.modality}</option>)}
            </select>
          </label>
          <BarChart items={(current?.items || []).map((row) => ({ key: row.cnpj8, label: row.institution, value: Number(row.rate_year), text: `${PCT(Number(row.rate_year))} a.a.${row.rate_month !== null ? ` · ${PCT(Number(row.rate_month))} a.m.` : ""}` }))} />
        </>
      ) : (
        <EmptyState title="Sem taxas gravadas ainda" description="Os dados aparecem depois da primeira coleta diária." />
      )}
      <p className="mt-3 text-2xs text-faint">Fonte: Banco Central do Brasil — Taxas de juros por instituição financeira (serviço Olinda). {bankRates?.lastSuccessAt ? `Atualizado em ${formatDateTime(bankRates.lastSuccessAt)}.` : ""}{bankRates?.lastError ? " Última tentativa de atualização falhou; mostrando o último dado válido." : ""}</p>
    </Card>
  );
}

// ---------- Gráficos ----------
const PERIODS = [{ value: "12m", label: "12 meses" }, { value: "5y", label: "5 anos" }, { value: "custom", label: "Personalizado" }];

function periodRange(period, custom) {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (period === "custom") return { from: custom.from ? `${custom.from}-01` : null, to: custom.to ? `${custom.to}-28` : null };
  const from = new Date(today);
  from.setMonth(from.getMonth() - (period === "5y" ? 60 : 12));
  return { from: iso(from), to: iso(today) };
}

function Charts() {
  const [primary, setPrimary] = useState("ipca");
  const [compare, setCompare] = useState([]);
  const [period, setPeriod] = useState("12m");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [state, setState] = useState({ loading: true, error: "", series: {} });
  const unit = indicatorByCode(primary).unit;
  const comparable = ECON_INDICATORS.filter((i) => i.code !== primary && i.unit === unit);
  const codes = useMemo(() => [primary, ...compare.filter((c) => indicatorByCode(c).unit === unit)].slice(0, 4), [primary, compare, unit]);
  const range = periodRange(period, custom);
  const key = `${codes.join(",")}|${range.from}|${range.to}`;

  useEffect(() => {
    if (period === "custom" && (!range.from || !range.to)) return undefined;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: "" }));
    const params = new URLSearchParams({ codes: codes.join(",") });
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    fetch(`/api/admin/economic-indicators/series?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Não foi possível carregar o histórico.");
        setState({ loading: false, error: "", series: payload.series || {} });
      })
      .catch((error) => {
        if (error.name !== "AbortError") setState({ loading: false, error: error.message, series: {} });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const series = codes.map((code, i) => {
    const indicator = indicatorByCode(code);
    return { code, name: indicator.name, unitLabel: indicator.unit, color: SERIES_COLORS[i], points: (state.series[code] || []).map((row) => ({ date: row.reference_date, value: Number(row.value), label: referenceLabel(indicator, row.reference_date, row.reference_label) })) };
  });
  const primaryIndicator = indicatorByCode(primary);

  return (
    <Card title="Histórico" note="Passe o dedo ou o mouse sobre o gráfico para ver cada valor.">
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-bold text-ink">
          Indicador
          <select className="admin-input" value={primary} onChange={(event) => { setPrimary(event.target.value); setCompare([]); }}>
            {ECON_INDICATORS.map((i) => <option key={i.code} value={i.code}>{i.name}</option>)}
          </select>
        </label>
        <fieldset className="grid gap-1 text-xs font-bold text-ink">
          <legend>Comparar com (mesma unidade, até 3)</legend>
          <div className="flex flex-wrap gap-2 pt-1">
            {comparable.length ? comparable.map((i) => (
              <label key={i.code} className="inline-flex items-center gap-1 font-semibold text-ink-2">
                <input type="checkbox" checked={compare.includes(i.code)} disabled={!compare.includes(i.code) && compare.length >= 3} onChange={(event) => setCompare((list) => (event.target.checked ? [...list, i.code] : list.filter((c) => c !== i.code)))} />
                {i.name}
              </label>
            )) : <span className="font-normal text-muted">Nenhum outro indicador com a mesma unidade.</span>}
          </div>
        </fieldset>
      </div>
      <Tabs options={PERIODS} value={period} onChange={setPeriod} label="Período do gráfico" size="sm" />
      {period === "custom" ? (
        <div className="mt-2 flex flex-wrap gap-3">
          <label className="grid gap-1 text-xs font-bold text-ink">De<input type="month" className="admin-input" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-bold text-ink">Até<input type="month" className="admin-input" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></label>
        </div>
      ) : null}
      <div className="mt-3" aria-busy={state.loading}>
        {state.error ? <p className="py-8 text-center text-sm text-warning">{state.error}</p> : state.loading ? <div className="h-[260px] animate-pulse rounded-card bg-mist" /> : (
          <LineChart
            series={series}
            formatDate={(d) => referenceLabel(primaryIndicator.frequency === "daily" ? { frequency: "monthly" } : primaryIndicator, d)}
            formatValue={(v, axis, code) => (unit === "R$" ? BRL.format(v).replace(/,\d{2}$/, "") : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: axis ? 2 : code === "tr" ? 4 : 2 }).format(v)}%`)}
          />
        )}
      </div>
    </Card>
  );
}

// ---------- Calculadora ----------
function CorrectionCalculator() {
  const [form, setForm] = useState({ amount: "", indicator: "ipca", startMonth: "", endMonth: "" });
  const [state, setState] = useState({ loading: false, error: "", result: null });

  async function submit(event) {
    event.preventDefault();
    setState({ loading: true, error: "", result: null });
    try {
      const response = await fetch("/api/admin/economic-indicators/correction", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, amount: Number(String(form.amount).replace(/\./g, "").replace(",", ".")) }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível calcular.");
      setState({ loading: false, error: "", result: payload });
    } catch (error) {
      setState({ loading: false, error: error.message, result: null });
    }
  }

  const r = state.result;
  return (
    <Card title="Calculadora de correção monetária" note="Usa só a série oficial gravada no CRM.">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4 sm:items-end">
        <label className="grid gap-1 text-xs font-bold text-ink">Valor (R$)<input inputMode="decimal" className="admin-input" placeholder="100.000,00" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required /></label>
        <label className="grid gap-1 text-xs font-bold text-ink">Índice
          <select className="admin-input" value={form.indicator} onChange={(e) => setForm((f) => ({ ...f, indicator: e.target.value }))}>
            {CORRECTION_CODES.map((code) => <option key={code} value={code}>{indicatorByCode(code).name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-bold text-ink">Mês inicial<input type="month" className="admin-input" value={form.startMonth} onChange={(e) => setForm((f) => ({ ...f, startMonth: e.target.value }))} required /></label>
        <label className="grid gap-1 text-xs font-bold text-ink">Mês final<input type="month" className="admin-input" value={form.endMonth} onChange={(e) => setForm((f) => ({ ...f, endMonth: e.target.value }))} required /></label>
        <button type="submit" disabled={state.loading} className={buttonClasses({ className: "sm:col-span-4 sm:justify-self-start" })}>{state.loading ? "Calculando…" : "Calcular"}</button>
      </form>
      {state.error ? <p className="mt-3 rounded-chip border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning">{state.error}</p> : null}
      {r ? (
        <div className="mt-4 grid gap-3">
          {r.warnings?.map((w) => <p key={w} className="rounded-chip border border-line bg-mist px-3 py-2 text-xs text-ink-2">{w}</p>)}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><dt className="text-xs text-muted">Valor original</dt><dd className="font-black text-ink">{BRL.format(r.amount)}</dd></div>
            <div><dt className="text-xs text-muted">Fator acumulado</dt><dd className="font-black text-ink">{new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 6 }).format(r.factor)} ({PCT(r.percent)})</dd></div>
            <div><dt className="text-xs text-muted">Correção</dt><dd className="font-black text-ink">{BRL.format(r.correction)}</dd></div>
            <div><dt className="text-xs text-muted">Valor atualizado</dt><dd className="font-black text-ink">{BRL.format(r.updated)}</dd></div>
          </dl>
          <p className="text-xs text-muted">
            Metodologia: multiplica (1 + variação do mês) de cada mês de {labelMonth(r.startMonth)} a {labelMonth(r.endMonth)}, inclusive ({r.months.length} meses), e aplica o fator ao valor.
            Correção monetária só repõe a inflação do índice escolhido — <b>não é juros</b> nem rendimento.
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer font-bold text-ink-2">Meses usados</summary>
            <ul className="mt-2 grid grid-cols-3 gap-1 sm:grid-cols-6">
              {r.months.map((m) => <li key={m.month} className="rounded-chip bg-mist px-2 py-1">{labelMonth(m.month)}: {PCT(m.rate)}</li>)}
            </ul>
          </details>
        </div>
      ) : null}
    </Card>
  );
}

// ---------- Impacto imobiliário + O que mudou ----------
const IMPACT = [
  { title: "Financiamento", text: "Selic e CDI influenciam o custo do dinheiro para os bancos; as taxas médias de financiamento imobiliário mostram o que o mercado praticou. Saldo de financiamentos com correção pela TR acompanha a TR mensal." },
  { title: "Poder de compra", text: "Inflação (IPCA/INPC) acima do reajuste da renda reduz o que sobra no orçamento. Desemprego e renda média real ajudam a acompanhar a capacidade de pagamento das famílias." },
  { title: "Custo da construção", text: "INCC-DI e INCC-M medem o custo de materiais e mão de obra da construção. Contratos de imóvel na planta costumam prever correção do saldo por um desses índices durante a obra (confira o índice de cada contrato)." },
  { title: "Mercado e contratos", text: "IGP-M é usado em muitos contratos de aluguel; IPCA em outros. O PIB trimestral mostra o ritmo da atividade econômica." }
];

function WhatChanged({ whatChanged }) {
  const groups = [
    { key: "up", title: "Altas", icon: "up" },
    { key: "down", title: "Quedas", icon: "down" },
    { key: "stable", title: "Sem mudança", icon: "stable" }
  ];
  const any = groups.some((g) => whatChanged?.[g.key]?.length);
  return (
    <Card title="O que mudou na economia?" note="Último dado divulgado comparado com o anterior de cada indicador.">
      {any ? (
        <div className="grid gap-4 md:grid-cols-3">
          {groups.map((g) => (
            <div key={g.key}>
              <h3 className="mb-2 flex items-center gap-1 text-sm font-extrabold text-ink"><Direction direction={g.icon} />{g.title}</h3>
              <ul className="grid gap-1.5 text-xs text-ink-2">
                {(whatChanged[g.key] || []).map((item) => (
                  <li key={item.code} className="rounded-chip border border-line px-2.5 py-1.5">
                    {item.relevant ? <span className="mr-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-2xs font-bold text-accent-text">Relevante</span> : null}
                    {item.text}
                  </li>
                ))}
                {!(whatChanged[g.key] || []).length ? <li className="text-muted">Nenhum.</li> : null}
              </ul>
            </div>
          ))}
        </div>
      ) : <EmptyState title="Sem comparação ainda" description="Precisa de pelo menos dois dados de cada indicador." />}
      <p className="mt-3 text-2xs text-faint">Texto montado só a partir dos números oficiais gravados; não indica causa nem previsão.</p>
    </Card>
  );
}

// ---------- Preferências de alerta ----------
function AlertPreferences() {
  const [state, setState] = useState({ loading: true, error: "", preferences: [], readOnly: false });
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    fetch("/api/admin/economic-indicators/preferences")
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Não foi possível carregar.");
        setState({ loading: false, error: "", preferences: payload.preferences || [], readOnly: payload.readOnly });
      })
      .catch((error) => setState((s) => ({ ...s, loading: false, error: error.message })));
  }, []);

  async function toggle(code, enabled) {
    setState((s) => ({ ...s, preferences: s.preferences.map((p) => (p.code === code ? { ...p, enabled } : p)) }));
    const response = await fetch("/api/admin/economic-indicators/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, enabled }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setState((s) => ({ ...s, error: payload.error || "Não foi possível salvar.", preferences: s.preferences.map((p) => (p.code === code ? { ...p, enabled: !enabled } : p)) }));
    else setState((s) => ({ ...s, error: "", preferences: payload.preferences }));
  }

  return (
    <Card title="Meus alertas econômicos" note="Avisos na Central de Alertas (Informativo) quando sai um dado novo.">
      {state.loading ? <div className="h-16 animate-pulse rounded-card bg-mist" /> : state.readOnly ? (
        <p className="text-sm text-muted">Em &quot;Alterar conta&quot; as preferências de outra pessoa não podem ser mudadas.</p>
      ) : (
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {state.preferences.map((p) => (
            <label key={p.code} className="inline-flex items-center gap-2 text-sm font-semibold text-ink-2">
              <input type="checkbox" checked={p.enabled} onChange={(e) => toggle(p.code, e.target.checked)} />
              {p.name}
            </label>
          ))}
        </div>
      )}
      {state.error ? <p className="mt-2 text-xs text-warning">{state.error}</p> : null}
    </Card>
  );
}

export default function EconomicIndicatorsDashboard({ initial = null, initialError = "" }) {
  if (!initial) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <EmptyState title="Indicadores Econômicos indisponíveis" description={initialError || "Tente de novo em instantes."} />
      </div>
    );
  }
  const byCategory = (category) => initial.indicators.filter((item) => indicatorByCode(item.code).category === category);
  const failing = initial.indicators.filter((item) => item.freshness === "error").length;
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 sm:px-6">
      <header>
        <h1 className="text-xl font-black text-ink">Indicadores Econômicos</h1>
        <p className="text-sm text-muted">Dados oficiais (Banco Central, IBGE e FGV via Banco Central), atualizados uma vez por dia. Índices mensais só mudam quando sai um mês novo.</p>
        {failing ? <p className="mt-2 rounded-chip border border-warning-line bg-warning-soft px-3 py-2 text-xs text-warning">{failing} indicador(es) com falha na última atualização — mostrando o último valor válido.</p> : null}
      </header>
      <Section title={ECON_CATEGORIES.inflation} note="Variação no mês, acumulado no ano e em 12 meses (juros compostos sobre as variações mensais oficiais). INCC e IGP-M são da FGV, republicados pelo Banco Central.">
        <IndicatorGrid items={byCategory("inflation")} />
      </Section>
      <Section title={ECON_CATEGORIES.interest}>
        <IndicatorGrid items={byCategory("interest")} />
        <BankRates bankRates={initial.bankRates} />
      </Section>
      <Section title={ECON_CATEGORIES.economy} note="PNAD Contínua (trimestre móvel) e Contas Nacionais Trimestrais do IBGE.">
        <IndicatorGrid items={byCategory("economy")} />
      </Section>
      <Section title="Gráficos e comparações">
        <Charts />
      </Section>
      <Section title="Impacto no mercado imobiliário">
        <WhatChanged whatChanged={initial.whatChanged} />
        <div className="grid gap-3 sm:grid-cols-2">
          {IMPACT.map((item) => <Card key={item.title} padding="sm" title={item.title}><p className="text-sm text-ink-2">{item.text}</p></Card>)}
        </div>
      </Section>
      <Section title="Ferramentas">
        <CorrectionCalculator />
        <AlertPreferences />
      </Section>
    </div>
  );
}
