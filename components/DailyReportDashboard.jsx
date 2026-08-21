"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileCheck2,
  Filter,
  Handshake,
  RefreshCw,
  TrendingUp,
  Users
} from "lucide-react";

const PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last7", label: "7 dias" },
  { value: "last30", label: "30 dias" },
  { value: "custom", label: "Personalizado" }
];

const METRIC_CARDS = [
  {
    key: "newRegistrations",
    title: "Novos cadastros",
    description: "Clientes que entraram no funil",
    icon: Users,
    tone: "blue"
  },
  {
    key: "awaitingDocumentation",
    title: "Aguardando documentação",
    description: "Clientes aguardando envio",
    icon: Clock,
    tone: "amber"
  },
  {
    key: "documentsPending",
    title: "Documentação pendente",
    description: "Documentos recebidos com ajustes",
    icon: FileCheck2,
    tone: "slate"
  },
  {
    key: "sentForApproval",
    title: "Enviados para aprovação",
    description: "Clientes em análise",
    icon: TrendingUp,
    tone: "blue"
  },
  {
    key: "approved",
    title: "Aprovados",
    description: "Créditos aprovados",
    icon: CheckCircle2,
    tone: "green"
  },
  {
    key: "rejected",
    title: "Reprovados",
    description: "Créditos não aprovados",
    icon: AlertCircle,
    tone: "red"
  }
];

const SALES_CARD = {
  key: "salesCompleted",
  title: "Vendas realizadas",
  description: "Clientes com venda concluída",
  icon: Handshake,
  tone: "green"
};

const TONE_CLASSES = {
  blue: "border-blue-100 bg-blue-50 text-blue-700",
  amber: "border-amber-100 bg-amber-50 text-amber-700",
  slate: "border-slate-100 bg-slate-50 text-slate-700",
  green: "border-emerald-100 bg-emerald-50 text-emerald-700",
  red: "border-red-100 bg-red-50 text-red-700"
};

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

export default function DailyReportDashboard({
  adminProfiles = [],
  canFilterBrokers = false,
  initialReport,
  initialError = ""
}) {
  const [period, setPeriod] = useState(initialReport?.range?.period || "today");
  const [startDate, setStartDate] = useState(initialReport?.range?.startDate || "");
  const [endDate, setEndDate] = useState(initialReport?.range?.endDate || "");
  const [selectedBrokerIds, setSelectedBrokerIds] = useState([]);
  const [report, setReport] = useState(initialReport);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [presentationMode, setPresentationMode] = useState(false);
  const brokerOptions = useMemo(() => (
    adminProfiles
      .filter((profile) => profile?.id && profile.status !== "inactive")
      .map((profile) => ({
        id: profile.id,
        name: profile.name || profile.email || "Corretor"
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
  ), [adminProfiles]);

  useEffect(() => {
    const controller = new AbortController();
    if (initialReport) loadReport(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, startDate, endDate, selectedBrokerIds]);

  const metrics = report?.metrics || {};
  const funnel = report?.funnel || [];
  const timeline = report?.timeline || [];

  async function loadReport(signal) {
    setLoading(true);
    setError("");

    const params = new URLSearchParams({ period });
    if (period === "custom") {
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
    }
    if (selectedBrokerIds.length) params.set("brokerIds", selectedBrokerIds.join(","));

    try {
      const response = await fetch(`/api/daily-report?${params.toString()}`, { signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar o relatório.");
      setReport(payload.report);
    } catch (requestError) {
      if (requestError.name !== "AbortError") {
        setError(requestError.message || "Não foi possível carregar o relatório.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  return (
    <section className="container-page space-y-6">
      <div
        className={`rounded-[28px] border p-5 shadow-soft transition-colors md:p-7 ${
          presentationMode
            ? "border-brand/30 bg-gradient-to-br from-navy to-[#184a84] text-white"
            : "border-navy/10 bg-white"
        }`}
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className={`text-xs font-extrabold uppercase tracking-[0.35em] ${presentationMode ? "text-blue-100" : "text-brand"}`}>
              Painel diário
            </p>
            <h2 className={`mt-2 text-3xl font-extrabold md:text-4xl ${presentationMode ? "text-white" : "text-navy"}`}>
              {report?.range?.title || "Relatório diário"}
            </h2>
            <p className={`mt-2 max-w-3xl text-base ${presentationMode ? "text-white/75" : "text-slate-600"}`}>
              Acompanhe cadastros, documentação, aprovações e conversões com dados reais do Supabase.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPresentationMode((current) => !current)}
              aria-pressed={presentationMode}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-extrabold transition ${
                presentationMode
                  ? "border-white/25 bg-white text-navy"
                  : "border-navy/15 bg-white text-navy hover:border-brand"
              }`}
            >
              <BarChart3 size={16} />
              {presentationMode ? "Sair da apresentação" : "Modo apresentação"}
            </button>
            <button
              type="button"
              onClick={() => loadReport()}
              disabled={loading}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-navy/15 bg-white px-4 text-sm font-extrabold text-navy transition hover:border-brand disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              Atualizar
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Período do relatório">
            {PERIODS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPeriod(option.value)}
                className={`min-h-11 rounded-full border px-4 text-sm font-extrabold transition ${
                  period === option.value
                    ? "border-brand bg-blue-50 text-brand"
                    : "border-navy/10 bg-white text-navy hover:border-brand"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {period === "custom" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <DateField label="Início" value={startDate} onChange={setStartDate} />
              <DateField label="Final" value={endDate} onChange={setEndDate} />
            </div>
          )}
        </div>

        {canFilterBrokers && brokerOptions.length > 0 && (
          <div className={`mt-5 rounded-3xl border p-4 ${presentationMode ? "border-white/20 bg-white/10" : "border-navy/10 bg-blue-50/50"}`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className={`text-xs font-extrabold uppercase tracking-[0.25em] ${presentationMode ? "text-blue-100" : "text-brand"}`}>
                  Corretores
                </p>
                <p className={`mt-1 text-sm font-bold ${presentationMode ? "text-white/75" : "text-slate-600"}`}>
                  Escolha um, vários ou todos os corretores para calcular o relatório.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBrokerIds([])}
                className={`min-h-10 rounded-full border px-4 text-sm font-extrabold transition ${
                  selectedBrokerIds.length === 0
                    ? "border-brand bg-white text-brand"
                    : "border-navy/10 bg-white text-navy hover:border-brand"
                }`}
              >
                Todos os corretores
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {brokerOptions.map((broker) => {
                const selected = selectedBrokerIds.includes(broker.id);

                return (
                  <button
                    key={broker.id}
                    type="button"
                    onClick={() => setSelectedBrokerIds((current) => (
                      current.includes(broker.id)
                        ? current.filter((id) => id !== broker.id)
                        : [...current, broker.id]
                    ))}
                    className={`min-h-10 rounded-full border px-4 text-sm font-extrabold transition ${
                      selected
                        ? "border-brand bg-brand text-white"
                        : "border-navy/10 bg-white text-navy hover:border-brand"
                    }`}
                  >
                    {broker.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      {presentationMode && (
        <div className="rounded-[28px] border border-brand/15 bg-white p-5 shadow-soft md:p-6">
          <p className="text-xs font-extrabold uppercase tracking-[0.3em] text-brand">Apresentação ativa</p>
          <p className="mt-2 text-lg font-extrabold text-navy">
            Visual limpo para compartilhar o desempenho sem exibir nomes de clientes.
          </p>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.05fr_1.95fr]">
        <article className="flex min-h-[260px] items-center justify-center rounded-[28px] border border-brand/15 bg-gradient-to-br from-navy to-[#184a84] p-6 text-center text-white shadow-soft md:p-8">
          <div>
            <h3 className="text-7xl font-black leading-none md:text-8xl">{formatInteger(metrics.newRegistrations)}</h3>
            <p className="mt-5 text-sm font-extrabold uppercase tracking-[0.35em] text-white/80 md:text-base">
              Cadastros realizados
            </p>
          </div>
        </article>

        <div className="grid gap-4 sm:grid-cols-2">
          {METRIC_CARDS.map((metric) => (
            <MetricCard key={metric.key} metric={metric} value={metrics[metric.key]} />
          ))}
          <MetricCard metric={SALES_CARD} value={metrics.salesCompleted} className="sm:col-span-2" />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Funil</p>
              <h3 className="mt-2 text-2xl font-extrabold text-navy">Evolução do atendimento</h3>
            </div>
            <Filter className="text-brand" size={22} />
          </div>

          <div className="mt-6 space-y-4">
            {funnel.map((item, index) => {
              const previous = funnel[index - 1]?.value;
              const conversion = index === 0 ? null : divideOrNull(item.value, previous);
              const max = Math.max(...funnel.map((entry) => entry.value), 1);

              return (
                <div key={item.key} className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-extrabold text-navy">{item.label}</span>
                    <span className="font-extrabold text-brand">
                      {formatInteger(item.value)}
                      {conversion !== null && <span className="ml-2 text-slate-500">({formatPercent(conversion)})</span>}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-blue-50">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-navy to-brand transition-all"
                      style={{ width: `${Math.max(6, (item.value / max) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
          <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Conversões</p>
          <h3 className="mt-2 text-2xl font-extrabold text-navy">Taxas principais</h3>
          <div className="mt-6 space-y-3">
            <ConversionRow label="Cadastro para documentação" value={report?.conversions?.documentation} />
            <ConversionRow label="Documentação para análise" value={report?.conversions?.approvalSubmission} />
            <ConversionRow label="Análise para aprovação" value={report?.conversions?.approval} />
          </div>
        </article>
      </div>

      {!presentationMode && (
        <article className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Linha do tempo</p>
              <h3 className="mt-2 text-2xl font-extrabold text-navy">Movimentos do período</h3>
            </div>
            <CalendarDays className="text-brand" size={22} />
          </div>

          <div className="mt-6 space-y-3">
            {!timeline.length && (
              <p className="rounded-2xl bg-blue-50 p-4 text-sm font-bold text-slate-600">
                Nenhum movimento encontrado neste período.
              </p>
            )}

            {timeline.map((event) => (
              <div key={event.id} className="flex flex-col gap-2 rounded-2xl border border-navy/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-extrabold text-navy">{event.title}</p>
                  <p className="text-sm text-slate-600">{event.clientName}</p>
                  {event.changedBy && <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{event.changedBy}</p>}
                </div>
                <time className="text-sm font-bold text-slate-500">{formatDateTime(event.occurredAt)}</time>
              </div>
            ))}
          </div>
        </article>
      )}

    </section>
  );
}

function MetricCard({ metric, value, className = "" }) {
  const Icon = metric.icon;

  return (
    <article className={`rounded-[24px] border border-navy/10 bg-white p-5 shadow-soft ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-extrabold text-navy">{metric.title}</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">{metric.description}</p>
        </div>
        <span className={`grid size-11 place-items-center rounded-2xl border ${TONE_CLASSES[metric.tone]}`}>
          <Icon size={20} />
        </span>
      </div>
      <p className="mt-5 text-4xl font-extrabold text-navy">{formatInteger(value)}</p>
    </article>
  );
}

function DateField({ label, value, onChange }) {
  return (
    <label className="text-sm font-extrabold text-navy">
      {label}
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 min-h-11 rounded-2xl border border-navy/15 px-4 text-sm text-navy outline-none focus:border-brand focus:ring-4 focus:ring-brand/15"
      />
    </label>
  );
}

function ConversionRow({ label, value }) {
  const percentage = value === null || value === undefined ? null : value;
  const improved = percentage !== null && percentage >= 0.5;

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-navy/10 p-4">
      <span className="text-sm font-extrabold text-navy">{label}</span>
      <span className="inline-flex items-center gap-2 text-sm font-extrabold text-brand">
        {percentage === null ? "Sem base" : formatPercent(percentage)}
        {percentage !== null && (improved ? <ArrowUp size={16} /> : <ArrowDown size={16} />)}
      </span>
    </div>
  );
}

function formatInteger(value) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatPercent(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatDateTime(value) {
  if (!value) return "";
  return DATE_TIME_FORMATTER.format(new Date(value));
}

function divideOrNull(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator;
}
