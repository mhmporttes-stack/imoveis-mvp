"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";

const PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "last7", label: "7 dias" },
  { value: "month", label: "Este mês" },
  { value: "custom", label: "Personalizado" }
];

const KPI_ITEMS = [
  { key: "newClients", label: "Novos clientes", href: (id) => `/admin/simulacoes?responsibleUserId=${id}` },
  { key: "prospecting", label: "Prospecções", href: () => "/admin/prospeccao" },
  { key: "service", label: "Atendimentos", href: (id) => `/admin/simulacoes?status=in_service&responsibleUserId=${id}` },
  { key: "simulation", label: "Simulações", href: (id) => `/admin/simulacoes?statusGroup=simulation&responsibleUserId=${id}` },
  { key: "approval", label: "Aprovações", href: (id) => `/admin/simulacoes?status=approved&responsibleUserId=${id}` },
  { key: "sale", label: "Vendas", href: (id) => `/admin/simulacoes?statusGroup=sale&responsibleUserId=${id}` },
  { key: "completedActivities", label: "Atividades concluídas", href: null },
  { key: "overdueActivities", label: "Atividades atrasadas", href: () => "/admin/calendario" },
  { key: "awaitingAction", label: "Clientes aguardando ação", href: (id) => `/admin/simulacoes?pending=1&responsibleUserId=${id}` }
];

export default function BrokerPerformanceDetail({ brokerId, brokerName, initialOverview, initialError = "" }) {
  const [period, setPeriod] = useState(initialOverview?.range?.period || "today");
  const [startDate, setStartDate] = useState(initialOverview?.range?.startDate || "");
  const [endDate, setEndDate] = useState(initialOverview?.range?.endDate || "");
  const [overview, setOverview] = useState(initialOverview);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    if (initialOverview) loadOverview(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, startDate, endDate]);

  const broker = overview?.broker || null;
  const funnel = overview?.funnel || [];

  async function loadOverview(signal) {
    setLoading(true);
    setError("");

    const params = new URLSearchParams({ period, brokerId });
    if (period === "custom") {
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
    }

    try {
      const response = await fetch(`/api/performance-overview?${params.toString()}`, { signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar o desempenho do corretor.");
      setOverview(payload.overview);
    } catch (requestError) {
      if (requestError.name !== "AbortError") {
        setError(requestError.message || "Não foi possível carregar o desempenho do corretor.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  return (
    <section className="container-page space-y-6">
      <div className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">{brokerName}</p>
            <h2 className="mt-2 text-3xl font-extrabold text-navy md:text-4xl">
              {overview?.range?.label || "Desempenho individual"}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => loadOverview()}
            disabled={loading}
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border border-navy/15 bg-white px-4 text-sm font-extrabold text-navy transition hover:border-brand disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Atualizar
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Período">
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
      </div>

      {error && (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-4">
        {KPI_ITEMS.map((item) => {
          const value = broker ? broker[item.key] : 0;
          const content = (
            <>
              <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-slate-500">{item.label}</p>
              <p className="mt-3 text-3xl font-extrabold text-navy">{formatInteger(value)}</p>
            </>
          );

          if (!item.href) {
            return (
              <div key={item.key} className="rounded-[22px] border border-navy/10 bg-white p-4 shadow-soft">
                {content}
              </div>
            );
          }

          return (
            <Link
              key={item.key}
              href={item.href(brokerId)}
              className="rounded-[22px] border border-navy/10 bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-md"
            >
              {content}
            </Link>
          );
        })}
      </div>

      {broker && (
        <article className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
          <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Pontuação</p>
          <h3 className="mt-2 text-2xl font-extrabold text-navy">De onde vieram os {formatInteger(broker.points)} pontos</h3>

          <div className="mt-6 space-y-2">
            {(broker.pointsBreakdown || []).map((entry) => (
              <div key={entry.key} className="flex items-center justify-between gap-3 rounded-2xl border border-navy/5 px-4 py-3 text-sm">
                <span className="font-bold text-navy">{formatInteger(entry.count)} {entry.label.toLowerCase()}</span>
                <span className="font-extrabold text-brand">{formatInteger(entry.points)} pts</span>
              </div>
            ))}
            {broker.manualAdjustmentPoints !== 0 && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-navy/5 px-4 py-3 text-sm">
                <span className="font-bold text-navy">Ajustes manuais</span>
                <span className={`font-extrabold ${broker.manualAdjustmentPoints >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                  {broker.manualAdjustmentPoints >= 0 ? "+" : ""}{formatInteger(broker.manualAdjustmentPoints)} pts
                </span>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-navy px-4 py-3 text-sm text-white">
              <span className="font-black uppercase tracking-[0.1em]">Total</span>
              <span className="font-black">{formatInteger(broker.points)} pts</span>
            </div>
          </div>
        </article>
      )}

      <article className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
        <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Funil individual</p>
        <h3 className="mt-2 text-2xl font-extrabold text-navy">Atendimentos → Simulações → Aprovações → Vendas</h3>

        <div className="mt-6 space-y-4">
          {funnel
            .filter((stage) => ["service", "simulation", "approval", "sale"].includes(stage.key))
            .map((stage, index, list) => {
              const max = Math.max(...list.map((entry) => entry.value), 1);
              return (
                <div key={stage.key} className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-extrabold text-navy">{stage.label}</span>
                    <span className="font-extrabold text-brand">
                      {formatInteger(stage.value)}
                      {index > 0 && (
                        <span className="ml-2 text-slate-500">
                          ({stage.conversion === null || stage.conversion === undefined ? "—" : formatPercent(stage.conversion)})
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-blue-50">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-navy to-brand transition-all"
                      style={{ width: `${Math.max(6, (stage.value / max) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      </article>
    </section>
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

function formatInteger(value) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatPercent(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}
