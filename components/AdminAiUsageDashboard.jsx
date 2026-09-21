"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

const PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "month", label: "Mês atual" },
  { value: "all", label: "Tudo" }
];

export default function AdminAiUsageDashboard({ initialEntries, usdBrlRate = 5.3 }) {
  const [period, setPeriod] = useState("month");
  const entries = initialEntries || [];
  const toBrl = (usd) => formatBrl((usd || 0) * usdBrlRate);

  const filtered = useMemo(() => filterByPeriod(entries, period), [entries, period]);

  const summary = useMemo(() => {
    const success = filtered.filter((entry) => entry.success);
    const totalCost = success.reduce((acc, entry) => acc + entry.costUsd, 0);
    const totalInput = success.reduce((acc, entry) => acc + entry.inputTokens, 0);
    const totalOutput = success.reduce((acc, entry) => acc + entry.outputTokens, 0);
    const failedCount = filtered.length - success.length;
    return {
      totalCost,
      count: success.length,
      failedCount,
      avgCost: success.length ? totalCost / success.length : 0,
      totalInput,
      totalOutput
    };
  }, [filtered]);

  return (
    <section className="container-page space-y-6">
      <div className="rounded-[28px] border border-line bg-white p-6 shadow-soft">
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPeriod(option.value)}
              className={`rounded-full px-4 py-2 text-sm font-black ${period === option.value ? "bg-navy text-white" : "border border-line text-navy hover:bg-brand/10"}`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Gasto estimado no período" value={toBrl(summary.totalCost)} />
          <Card label="Análises concluídas" value={summary.count} />
          <Card label="Custo médio por análise" value={toBrl(summary.avgCost)} />
          <Card label="Falhas (sem cobrança estimada)" value={summary.failedCount} tone={summary.failedCount ? "danger" : "default"} />
        </div>
        <p className="mt-3 text-xs font-bold text-muted">
          Tokens no período: {summary.totalInput.toLocaleString("pt-BR")} de entrada · {summary.totalOutput.toLocaleString("pt-BR")} de saída. Valores convertidos de USD pela cotação fixa de R$ {usdBrlRate.toFixed(2)}/US$ (configurável via variável de ambiente USD_BRL_RATE) — o valor exato de cobrança, em dólar, é o do console.anthropic.com.
        </p>
      </div>

      <div className="overflow-x-auto rounded-[28px] border border-line bg-white shadow-soft">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-black uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Corretor</th>
              <th className="px-4 py-3">Tokens (in/out)</th>
              <th className="px-4 py-3">Cache</th>
              <th className="px-4 py-3">Custo estimado</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <tr key={entry.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3 font-bold text-navy">{formatDateTime(entry.createdAt)}</td>
                <td className="px-4 py-3">{entry.clientName || "—"}</td>
                <td className="px-4 py-3">{entry.brokerName || "—"}</td>
                <td className="px-4 py-3 text-xs text-muted">{entry.inputTokens.toLocaleString("pt-BR")} / {entry.outputTokens.toLocaleString("pt-BR")}</td>
                <td className="px-4 py-3 text-xs">
                  {entry.cacheReadTokens ? <span className="font-black text-emerald-700">{entry.cacheReadTokens.toLocaleString("pt-BR")} lidos</span> : entry.cacheCreationTokens ? <span className="text-muted">{entry.cacheCreationTokens.toLocaleString("pt-BR")} criados</span> : "—"}
                </td>
                <td className="px-4 py-3 font-black text-navy">{entry.success ? toBrl(entry.costUsd) : "—"}</td>
                <td className="px-4 py-3">
                  {entry.success ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-black text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Sucesso</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-black text-red-700" title={entry.errorMessage}><XCircle className="h-3.5 w-3.5" /> Falha</span>
                  )}
                </td>
              </tr>
            ))}
            {!filtered.length ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm font-bold text-muted">Nenhuma análise registrada neste período.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Card({ label, value, tone = "default" }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone === "danger" && value ? "border-red-200 bg-red-50" : "border-line"}`}>
      <p className="text-2xl font-black text-navy">{value}</p>
      <p className="text-xs font-bold text-muted">{label}</p>
    </div>
  );
}

function filterByPeriod(entries, period) {
  if (period === "all") return entries;
  const now = new Date();
  const start = new Date(now);
  if (period === "today") {
    start.setHours(0, 0, 0, 0);
  } else if (period === "7d") {
    start.setDate(start.getDate() - 7);
  } else if (period === "30d") {
    start.setDate(start.getDate() - 30);
  } else if (period === "month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }
  return entries.filter((entry) => new Date(entry.createdAt) >= start);
}

function formatBrl(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value || 0);
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}
