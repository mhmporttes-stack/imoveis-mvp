"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Calculator,
  CalendarDays,
  CheckCircle2,
  Handshake,
  MessageCircle,
  RefreshCw,
  TrendingUp,
  Users
} from "lucide-react";

const PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "last7", label: "7 dias" },
  { value: "month", label: "Este mês" },
  { value: "custom", label: "Personalizado" }
];

const KPI_CARDS = [
  { key: "newClients", title: "Novos clientes", icon: Users, tone: "blue", href: "/admin/simulacoes" },
  { key: "prospecting", title: "Prospecções", icon: MessageCircle, tone: "amber", href: "/admin/prospeccao" },
  { key: "service", title: "Em atendimento", icon: Handshake, tone: "blue", href: "/admin/simulacoes?status=in_service" },
  { key: "simulation", title: "Simulações", icon: Calculator, tone: "slate", href: "/admin/simulacoes?statusGroup=simulation" },
  { key: "approval", title: "Aprovações", icon: TrendingUp, tone: "green", href: "/admin/simulacoes?status=approved" },
  { key: "sale", title: "Vendas", icon: CheckCircle2, tone: "green", href: "/admin/simulacoes?statusGroup=sale" }
];

const TONE_CLASSES = {
  blue: "border-blue-100 bg-blue-50 text-blue-700",
  amber: "border-amber-100 bg-amber-50 text-amber-700",
  slate: "border-slate-100 bg-slate-50 text-slate-700",
  green: "border-emerald-100 bg-emerald-50 text-emerald-700",
  red: "border-red-100 bg-red-50 text-red-700"
};

const ATTENTION_ITEMS = [
  { key: "overdueActivities", emoji: "🔴", label: "atividades atrasadas", href: "/admin/calendario" },
  { key: "awaitingAction", emoji: "🟠", label: "clientes aguardando ação", href: "/admin/simulacoes?pending=1" },
  { key: "staleContact", emoji: "🟡", label: "clientes sem contato há +3 dias", href: "/admin/simulacoes?staleContact=1" },
  { key: "noFutureActivity", emoji: "🔵", label: "clientes sem atividade futura", href: "/admin/simulacoes?noFutureActivity=1" }
];

const MEDALS = ["🥇", "🥈", "🥉"];

export default function PerformanceOverviewDashboard({ initialOverview, initialError = "" }) {
  const [period, setPeriod] = useState(initialOverview?.range?.period || "month");
  const [startDate, setStartDate] = useState(initialOverview?.range?.startDate || "");
  const [endDate, setEndDate] = useState(initialOverview?.range?.endDate || "");
  const [overview, setOverview] = useState(initialOverview);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [expandedBrokerId, setExpandedBrokerId] = useState("");

  // Filtro exclusivo do bloco "Funil comercial": Todos os corretores (padrão,
  // reaproveita o overview já carregado), um corretor específico, ou um
  // conjunto arbitrário de corretores — não afeta KPIs, ranking ou equipe.
  const [funnelBrokerIds, setFunnelBrokerIds] = useState([]);
  const [funnelOverview, setFunnelOverview] = useState(null);
  const [funnelLoading, setFunnelLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    if (initialOverview) loadOverview(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, startDate, endDate]);

  useEffect(() => {
    const controller = new AbortController();
    if (funnelBrokerIds.length) loadFunnelOverview(controller.signal);
    else setFunnelOverview(null);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funnelBrokerIds, period, startDate, endDate]);

  const metrics = overview?.metrics || {};
  const attention = overview?.attention || {};
  const ranking = overview?.ranking || [];
  const team = overview?.team || [];
  const funnel = (funnelBrokerIds.length ? funnelOverview?.funnel : overview?.funnel) || [];
  const brokerOptions = useMemo(() => (
    team
      .map((row) => row.profile)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
  ), [team]);
  const periodQuery = useMemo(() => buildPeriodQuery(period, startDate, endDate), [period, startDate, endDate]);

  async function loadOverview(signal) {
    setLoading(true);
    setError("");

    const params = new URLSearchParams({ period });
    if (period === "custom") {
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
    }

    try {
      const response = await fetch(`/api/performance-overview?${params.toString()}`, { signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar o painel.");
      setOverview(payload.overview);
    } catch (requestError) {
      if (requestError.name !== "AbortError") {
        setError(requestError.message || "Não foi possível carregar o painel.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  async function loadFunnelOverview(signal) {
    setFunnelLoading(true);

    const params = new URLSearchParams({ period, brokerIds: funnelBrokerIds.join(",") });
    if (period === "custom") {
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
    }

    try {
      const response = await fetch(`/api/performance-overview?${params.toString()}`, { signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar o funil filtrado.");
      setFunnelOverview(payload.overview);
    } catch (requestError) {
      if (requestError.name !== "AbortError") {
        setError(requestError.message || "Não foi possível carregar o funil filtrado.");
      }
    } finally {
      if (!signal?.aborted) setFunnelLoading(false);
    }
  }

  function toggleFunnelBroker(brokerId) {
    setFunnelBrokerIds((current) => (
      current.includes(brokerId) ? current.filter((id) => id !== brokerId) : [...current, brokerId]
    ));
  }

  return (
    <section className="container-page space-y-6">
      <div className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Visão geral</p>
            <h2 className="mt-2 text-3xl font-extrabold text-navy md:text-4xl">
              {overview?.range?.label || "Painel de desempenho"}
            </h2>
            <p className="mt-2 max-w-3xl text-base text-slate-600">
              Como a equipe trabalhou, como está o funil comercial e onde agir agora.
            </p>
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
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Período do painel">
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {KPI_CARDS.map((card) => (
          <KpiCard key={card.key} card={card} value={metrics[card.key]} />
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.65fr_1fr]">
        <article className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
          <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Ranking da equipe</p>
          <h3 className="mt-2 text-2xl font-extrabold text-navy">Quem mais produziu no período</h3>

          <div className="mt-6 space-y-3">
            {!ranking.length && (
              <p className="rounded-2xl bg-blue-50 p-4 text-sm font-bold text-slate-600">
                Nenhum corretor com atividade neste período.
              </p>
            )}
            {ranking.map((row, index) => (
              <div key={row.profile.id} className="rounded-2xl border border-navy/10 transition hover:border-brand">
                <div className="flex items-center justify-between gap-4 p-4">
                  <Link
                    href={`/admin/desempenho/corretor/${row.profile.id}?${periodQuery}`}
                    className="flex min-w-0 items-center gap-3 hover:bg-blue-50/40"
                  >
                    <span className="text-2xl leading-none">{MEDALS[index] || `${index + 1}º`}</span>
                    <div className="min-w-0">
                      <p className="font-extrabold text-navy">{row.profile.name}</p>
                      <p className="text-xs font-bold text-slate-500">
                        {row.newClients} novos clientes · {row.prospecting} prospecções · {row.simulation} simulações · {row.sale} vendas
                      </p>
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setExpandedBrokerId((current) => (current === row.profile.id ? "" : row.profile.id))}
                    className="whitespace-nowrap rounded-full px-2 text-lg font-black text-brand underline decoration-dotted underline-offset-4"
                  >
                    {formatInteger(row.points)} pts
                  </button>
                </div>
                {expandedBrokerId === row.profile.id && <PointsBreakdown row={row} />}
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
          <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Precisa de atenção</p>
          <h3 className="mt-2 text-2xl font-extrabold text-navy">Situações para agir agora</h3>

          <div className="mt-6 space-y-3">
            {ATTENTION_ITEMS.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="flex items-center justify-between gap-3 rounded-2xl border border-navy/10 p-4 transition hover:border-brand hover:bg-blue-50/40"
              >
                <span className="flex items-center gap-3 text-sm font-extrabold text-navy">
                  <span className="text-lg leading-none">{item.emoji}</span>
                  {item.label}
                </span>
                <span className="text-xl font-black text-navy">{formatInteger(attention[item.key])}</span>
              </Link>
            ))}
          </div>
        </article>
      </div>

      <article className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Funil comercial</p>
            <h3 className="mt-2 text-2xl font-extrabold text-navy">Fluxo dos clientes no período</h3>
          </div>
          <CalendarDays className="text-brand" size={22} />
        </div>

        {brokerOptions.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">Corretores:</span>
            <button
              type="button"
              onClick={() => setFunnelBrokerIds([])}
              className={`min-h-8 rounded-full border px-3 text-xs font-extrabold transition ${
                funnelBrokerIds.length === 0
                  ? "border-brand bg-blue-50 text-brand"
                  : "border-navy/10 bg-white text-navy hover:border-brand"
              }`}
            >
              Todos
            </button>
            {brokerOptions.map((broker) => {
              const selected = funnelBrokerIds.includes(broker.id);
              return (
                <button
                  key={broker.id}
                  type="button"
                  onClick={() => toggleFunnelBroker(broker.id)}
                  className={`min-h-8 rounded-full border px-3 text-xs font-extrabold transition ${
                    selected
                      ? "border-brand bg-brand text-white"
                      : "border-navy/10 bg-white text-navy hover:border-brand"
                  }`}
                >
                  {broker.name}
                </button>
              );
            })}
            {funnelLoading && <span className="text-xs font-bold text-slate-400">Atualizando…</span>}
          </div>
        )}

        <FunnelChart funnel={funnel} />
      </article>

      <article className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
        <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Equipe</p>
        <h3 className="mt-2 text-2xl font-extrabold text-navy">Desempenho por corretor no período</h3>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {team.map((row) => (
            <BrokerCard key={row.profile.id} row={row} periodQuery={periodQuery} />
          ))}
          {!team.length && (
            <p className="rounded-2xl bg-blue-50 p-4 text-sm font-bold text-slate-600 sm:col-span-2 xl:col-span-3">
              Nenhum corretor ativo encontrado.
            </p>
          )}
        </div>
      </article>
    </section>
  );
}

function KpiCard({ card, value }) {
  const Icon = card.icon;
  return (
    <Link
      href={card.href}
      className={`rounded-[22px] border bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-md ${TONE_CLASSES[card.tone]?.split(" ")[0] || "border-navy/10"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-extrabold uppercase tracking-[0.1em] text-slate-500">{card.title}</span>
        <span className={`grid size-9 place-items-center rounded-xl border ${TONE_CLASSES[card.tone]}`}>
          <Icon size={16} />
        </span>
      </div>
      <p className="mt-3 text-3xl font-extrabold text-navy">{formatInteger(value)}</p>
    </Link>
  );
}

function PointsBreakdown({ row }) {
  const breakdown = (row.pointsBreakdown || []).filter((entry) => entry.count > 0 || entry.points !== 0);

  return (
    <div className="border-t border-navy/10 bg-blue-50/30 p-4">
      <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-brand">Pontuação — {row.profile.name}</p>
      <div className="mt-3 space-y-1.5 text-sm">
        {breakdown.map((entry) => (
          <div key={entry.key} className="flex items-center justify-between gap-3">
            <span className="font-bold text-navy">
              {formatInteger(entry.count)} {entry.label.toLowerCase()}
            </span>
            <span className="font-extrabold text-brand">{formatInteger(entry.points)} pts</span>
          </div>
        ))}
        {!breakdown.length && <p className="text-slate-500">Nenhuma atividade pontuada neste período.</p>}
        {row.manualAdjustmentPoints !== 0 && (
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-navy">Ajustes manuais</span>
            <span className={`font-extrabold ${row.manualAdjustmentPoints >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {row.manualAdjustmentPoints >= 0 ? "+" : ""}{formatInteger(row.manualAdjustmentPoints)} pts
            </span>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between border-t border-navy/10 pt-2">
          <span className="font-black uppercase tracking-[0.08em] text-navy">Total</span>
          <span className="font-black text-navy">{formatInteger(row.points)} pts</span>
        </div>
      </div>
    </div>
  );
}

function BrokerCard({ row, periodQuery }) {
  const overdue = row.overdueActivities > 0;
  return (
    <article className="rounded-2xl border border-navy/10 p-4">
      <p className="text-sm font-extrabold uppercase tracking-[0.08em] text-navy">{row.profile.name}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold text-slate-600">
        <span>{formatInteger(row.newClients)} novos clientes</span>
        <span>{formatInteger(row.prospecting)} prospecções</span>
        <span>{formatInteger(row.awaitingAction)} aguardando ação</span>
        <span className={overdue ? "font-extrabold text-red-700" : "text-emerald-700"}>
          {formatInteger(row.overdueActivities)} atrasadas
        </span>
      </div>
      <Link
        href={`/admin/desempenho/corretor/${row.profile.id}?${periodQuery}`}
        className="mt-4 inline-flex min-h-9 items-center justify-center rounded-full border border-navy/15 bg-white px-4 text-xs font-extrabold text-navy transition hover:border-brand hover:text-brand"
      >
        Ver desempenho
      </Link>
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

// Tons do azul institucional (navy -> brand -> claro), do topo (mais escuro)
// até o fundo do funil (mais claro). As duas últimas camadas usam texto navy
// em vez de branco para manter contraste sobre o azul claro.
const FUNNEL_LAYER_COLORS = [
  { bg: "#0A2E52", text: "text-white" },
  { bg: "#0D3B66", text: "text-white" },
  { bg: "#14508C", text: "text-white" },
  { bg: "#1769D1", text: "text-white" },
  { bg: "#6FA8E6", text: "text-navy" },
  { bg: "#B7D8F7", text: "text-navy" }
];
const FUNNEL_MIN_WIDTH_PERCENT = 30;

// Larguras (em % da coluna do funil) que delimitam o topo/fundo de cada camada
// — só definem a SILHUETA (etapas nunca somem visualmente), os números e as
// conversões continuam vindo 100% dos dados reais.
function getFunnelBoundaries(count) {
  if (!count) return [];
  const step = (100 - FUNNEL_MIN_WIDTH_PERCENT) / count;
  return Array.from({ length: count + 1 }, (_, index) => 100 - step * index);
}

function FunnelChart({ funnel }) {
  const boundaries = useMemo(() => getFunnelBoundaries(funnel.length), [funnel.length]);
  if (!funnel.length) return null;

  return (
    <div className="mt-6 grid grid-cols-1 gap-y-4 sm:grid-cols-[minmax(88px,1fr)_minmax(0,3.2fr)_minmax(64px,0.8fr)] sm:items-center sm:gap-x-5 sm:gap-y-2.5">
      <span className="hidden sm:block" aria-hidden="true" />
      <span className="hidden sm:block" aria-hidden="true" />
      <p className="hidden text-right text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-400 sm:block">
        Conversão
      </p>

      {funnel.map((stage, index) => {
        const topWidth = boundaries[index];
        const bottomWidth = boundaries[index + 1];
        const insetTop = (100 - topWidth) / 2;
        const insetBottom = (100 - bottomWidth) / 2;
        const color = FUNNEL_LAYER_COLORS[index] || FUNNEL_LAYER_COLORS[FUNNEL_LAYER_COLORS.length - 1];
        const hasConversion = stage.conversion !== null && stage.conversion !== undefined;
        const conversionLabel = index === 0 ? "Base" : (hasConversion ? formatPercent(stage.conversion) : "—");

        return (
          <Link key={stage.key} href={buildFunnelStageHref(stage.key)} className="group contents">
            <span className="text-sm font-extrabold text-navy transition group-hover:text-brand">
              {stage.label}
            </span>

            <span className="relative flex h-[64px] items-center justify-center sm:h-[70px]">
              <span
                className="absolute inset-0 flex items-center justify-center transition duration-300 group-hover:brightness-110"
                style={{
                  backgroundColor: color.bg,
                  clipPath: `polygon(${insetTop}% 0, ${100 - insetTop}% 0, ${100 - insetBottom}% 100%, ${insetBottom}% 100%)`
                }}
              >
                <span className={`text-xl font-black tracking-tight sm:text-2xl ${color.text}`}>
                  {formatInteger(stage.value)}
                </span>
              </span>
            </span>

            <span className="flex items-center justify-between sm:flex-col sm:items-end sm:justify-center">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400 sm:hidden">Conversão</span>
              <span
                className="text-base font-black text-navy"
                title="Conversão da etapa anterior"
              >
                {conversionLabel}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function buildFunnelStageHref(key) {
  if (key === "clients") return "/admin/simulacoes";
  if (key === "service") return "/admin/simulacoes?status=in_service";
  if (key === "simulation") return "/admin/simulacoes?statusGroup=simulation";
  if (key === "documentation") return "/admin/simulacoes?statusGroup=documentation";
  if (key === "approval") return "/admin/simulacoes?status=approved";
  if (key === "sale") return "/admin/simulacoes?statusGroup=sale";
  return "/admin/simulacoes";
}

function buildPeriodQuery(period, startDate, endDate) {
  const params = new URLSearchParams({ period });
  if (period === "custom") {
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
  }
  return params.toString();
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
