"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Calculator,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  FileCheck,
  Handshake,
  Info,
  MessageCircle,
  RefreshCw,
  Search,
  TrendingUp,
  Users
} from "lucide-react";
import Avatar from "@/components/Avatar";
import { readViewerData, saveViewerData } from "@/components/chat-view-cache";
import { PERFORMANCE_CACHE_NAME } from "@/components/panel-cache-names";
import scene from "@/components/scenes/scenes.module.css";
import SceneCount from "@/components/scenes/SceneCount";
import { sceneIndex, sceneStaggerProps, useSceneInView } from "@/components/scenes/useSceneInView";

const PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "last7", label: "7 dias" },
  { value: "month", label: "Este mês" },
  { value: "custom", label: "Personalizado" }
];

const KPI_CARDS = [
  { key: "prospecting", title: "Prospecções", icon: MessageCircle, tone: "amber", href: "/admin/prospeccao" },
  { key: "newClients", title: "Novos clientes", icon: Users, tone: "blue", href: "/admin/simulacoes" },
  { key: "service", title: "Em atendimento", icon: Handshake, tone: "blue", href: "/admin/simulacoes?status=in_service" },
  { key: "simulation", title: "Simulações", icon: Calculator, tone: "slate", href: "/admin/simulacoes?statusGroup=simulation" },
  { key: "approvalPending", title: "Documentações completas / Aguardando aprovação", icon: FileCheck, tone: "amber", href: "/admin/simulacoes?statusGroup=approval" },
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

const TREND_GRANULARITIES = [
  { value: "day", label: "Dia a dia" },
  { value: "week", label: "Semana a semana" },
  { value: "month", label: "Mês a mês" }
];
// Tempos das cenas desta tela (pedido do dono, 2026-10-22) — próprios, não mexem em --mm-motion-*.
// Cards da Visão geral: saltinho curto em cascata. Funil: uma etapa por vez, de cima para baixo, número contando.
// Histórico: uma linha por vez, ritmo para dar para acompanhar, seta de variação no fim de cada uma.
const KPI_SCENE = { stepMs: 90, durationMs: 620, rise: 14, hop: 5 };
const FUNNEL_SCENE = { stepMs: 200, durationMs: 640, rise: 12, hop: 5 };
const FUNNEL_COUNT_MS = 650;
const TREND_SCENE = { stepMs: 150, durationMs: 600, rise: 12, hop: 5 };
// Funil e histórico ficam dentro de blocos que entram por rolagem (1,1 s): a cena começa com o bloco quase no lugar.
const BLOCK_SCENE_DELAY_MS = 300;

const TREND_COLORS = ["#2563eb", "#16a34a", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#dc2626", "#65a30d"];

export default function PerformanceOverviewDashboard({ initialOverview, initialError = "", viewerKey = "" }) {
  // Números já guardados nesta conta (pré-carregados ou da visita anterior): a tela abre com eles e atualiza em seguida.
  const [cachedOverview] = useState(() => (initialOverview ? null : readViewerData(viewerKey, PERFORMANCE_CACHE_NAME)));
  const startOverview = initialOverview || cachedOverview;
  const [period, setPeriod] = useState(startOverview?.range?.period || "month");
  const [startDate, setStartDate] = useState(startOverview?.range?.startDate || "");
  const [endDate, setEndDate] = useState(startOverview?.range?.endDate || "");
  const [overview, setOverview] = useState(startOverview);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [expandedBrokerId, setExpandedBrokerId] = useState("");

  // Filtro exclusivo do bloco "Funil comercial": Todos os corretores (padrão,
  // reaproveita o overview já carregado), um corretor específico, ou um
  // conjunto arbitrário de corretores — não afeta KPIs, ranking ou equipe.
  const [funnelBrokerIds, setFunnelBrokerIds] = useState([]);
  const [funnelOverview, setFunnelOverview] = useState(null);
  const [funnelLoading, setFunnelLoading] = useState(false);

  // Ranking histórico (pedido do dono, 2026-09-29): filtro de corretor próprio
  // (não reaproveita funnelBrokerIds — trocar quem aparece no funil não deveria
  // mexer no gráfico de tendência, e vice-versa).
  const [trendGranularity, setTrendGranularity] = useState("month");
  const [trendBrokerIds, setTrendBrokerIds] = useState([]);
  const [trend, setTrend] = useState(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState("");

  // O servidor já carregou initialOverview para o período/data padrão — sem
  // essa guarda, este efeito refaz a mesma consulta inteira (todas as
  // queries do painel) assim que a página termina de montar, dobrando à toa
  // o trabalho no banco e o tempo até a tela ficar "pronta" a cada acesso.
  // Refetch continua acontecendo normalmente quando o usuário troca período/data.
  const isFirstOverviewRender = useRef(true);
  // Guarda os números do período padrão para a próxima vez (mesma memória por conta do Chat; some ao sair/trocar de conta).
  useEffect(() => {
    if (overview && overview.range?.period === "month") saveViewerData(viewerKey, PERFORMANCE_CACHE_NAME, overview);
  }, [viewerKey, overview]);
  useEffect(() => {
    const controller = new AbortController();
    if (isFirstOverviewRender.current) {
      isFirstOverviewRender.current = false;
      // Com números guardados: atualiza em segundo plano, sem "carregando" (a tela já está preenchida).
      if (!initialOverview) loadOverview(controller.signal, { silent: Boolean(cachedOverview) });
    } else {
      loadOverview(controller.signal);
    }
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

  useEffect(() => {
    const controller = new AbortController();
    loadTrend(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendGranularity, trendBrokerIds]);

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
  // Cenas: tocam ao entrar na tela e de novo quando chega outro período (ou outro filtro), nunca numa atualização
  // silenciosa do mesmo período.
  const rangeKey = `${overview?.range?.startDate || ""}|${overview?.range?.endDate || ""}`;
  const funnelSceneKey = `${rangeKey}|${funnelBrokerIds.join(",")}|${funnel.length}`;
  const kpiRef = useRef(null);
  const kpiPhase = useSceneInView(kpiRef, { replayKey: overview ? rangeKey : "" });

  async function loadOverview(signal, { silent = false } = {}) {
    if (!silent) setLoading(true);
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
      if (requestError.name !== "AbortError" && !silent) {
        setError(requestError.message || "Não foi possível carregar o painel.");
      }
    } finally {
      if (!signal?.aborted && !silent) setLoading(false);
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

  async function loadTrend(signal) {
    setTrendLoading(true);
    setTrendError("");

    const params = new URLSearchParams({ granularity: trendGranularity });
    if (trendBrokerIds.length) params.set("brokerIds", trendBrokerIds.join(","));

    try {
      const response = await fetch(`/api/performance-overview/trend?${params.toString()}`, { signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar o histórico.");
      setTrend(payload.trend);
    } catch (requestError) {
      if (requestError.name !== "AbortError") {
        setTrendError(requestError.message || "Não foi possível carregar o histórico.");
      }
    } finally {
      if (!signal?.aborted) setTrendLoading(false);
    }
  }


  return (
    <section className="container-page space-y-6">
      <div className="rounded-panel border border-navy/10 bg-white p-4 shadow-soft md:p-7">
        {/* Celular: título à esquerda e "Atualizar" à direita na mesma linha
            (economiza uma linha inteira); do md para cima, layout original. */}
        <div className="flex items-start justify-between gap-3 md:flex-col md:items-stretch md:gap-5 lg:flex-row lg:items-center">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-brand md:tracking-[0.35em]">Visão geral</p>
            <h2 className="mt-1 text-2xl font-extrabold text-navy md:mt-2 md:text-4xl">
              {overview?.range?.label || "Painel de desempenho"}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-600 md:mt-2 md:text-base">
              Como a equipe trabalhou, como está o funil comercial e onde agir agora.
            </p>
          </div>

          <button
            type="button"
            onClick={() => loadOverview()}
            disabled={loading}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 self-start rounded-full border border-navy/15 bg-white px-3 text-sm font-extrabold md:gap-2 md:px-4 text-navy transition hover:border-brand disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Atualizar
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3 md:mt-6 md:gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex gap-1.5 md:flex-wrap md:gap-2" role="tablist" aria-label="Período do painel">
            {PERIODS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPeriod(option.value)}
                className={`min-h-11 flex-1 whitespace-nowrap rounded-full border px-1.5 text-[13px] font-extrabold transition md:flex-none md:px-4 md:text-sm ${
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
            <div className="grid grid-cols-2 gap-2 md:gap-3">
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

      {/* data-no-reveal: os cards têm a própria cena (saltinho em cascata), sem somar com a entrada por rolagem. */}
      <div ref={kpiRef} data-no-reveal {...sceneStaggerProps(kpiPhase, { ...KPI_SCENE, className: "grid gap-4 sm:grid-cols-2 lg:grid-cols-4" })}>
        {KPI_CARDS.map((card, index) => (
          <KpiCard key={card.key} card={card} value={metrics[card.key]} index={index} />
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.65fr_1fr]">
        <article className="rounded-panel border border-navy/10 bg-white p-5 shadow-soft md:p-7">
          <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Ranking da equipe</p>
          <h3 className="mt-2 text-2xl font-extrabold text-navy">Quem mais produziu no período</h3>

          <div className="mt-6 space-y-3">
            {/* 1ª abertura sem números guardados: "carregando" (botão Atualizar girando), não "nenhum". */}
            {!ranking.length && overview && (
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
                    <span className="relative shrink-0">
                      <Avatar name={row.profile.name} photoUrl={row.profile.photoUrl} size={40} />
                      {MEDALS[index] ? (
                        <span className="absolute -bottom-1 -right-1 text-base leading-none">{MEDALS[index]}</span>
                      ) : (
                        <span className="absolute -bottom-1 -right-1 rounded-full bg-white px-1 text-[10px] font-black text-muted shadow">{index + 1}º</span>
                      )}
                    </span>
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

        <article className="rounded-panel border border-navy/10 bg-white p-5 shadow-soft md:p-7">
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

      <article className="rounded-panel border border-navy/10 bg-white p-5 shadow-soft md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Ranking histórico</p>
            <h3 className="mt-2 text-2xl font-extrabold text-navy">Quem está melhorando (ou piorando)</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {brokerOptions.length > 0 && (
              <BrokerFilterDropdown
                brokers={brokerOptions}
                loading={trendLoading}
                selectedIds={trendBrokerIds}
                onChange={setTrendBrokerIds}
              />
            )}
            <TrendingUp className="text-brand" size={22} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Granularidade do histórico">
          {TREND_GRANULARITIES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTrendGranularity(option.value)}
              className={`min-h-9 rounded-full border px-4 text-xs font-extrabold transition ${
                trendGranularity === option.value
                  ? "border-brand bg-blue-50 text-brand"
                  : "border-navy/10 bg-white text-navy hover:border-brand"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {trendError && (
          <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{trendError}</p>
        )}

        <TeamTrendChart trend={trend} loading={trendLoading} />
      </article>

      <article className="rounded-panel border border-navy/10 bg-white p-5 shadow-soft md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Funil comercial</p>
            <h3 className="mt-2 text-2xl font-extrabold text-navy">Fluxo dos clientes no período</h3>
          </div>
          <div className="flex items-center gap-3">
            {brokerOptions.length > 0 && (
              <BrokerFilterDropdown
                brokers={brokerOptions}
                loading={funnelLoading}
                selectedIds={funnelBrokerIds}
                onChange={setFunnelBrokerIds}
              />
            )}
            {/* Período aplicado ao funil (pedido do dono, 2026-10-11), ao lado do calendário. */}
            <span className="inline-flex items-center gap-1.5 text-sm font-extrabold text-navy">
              <CalendarDays className="shrink-0 text-brand" size={22} aria-hidden="true" />
              {formatRangeLabel(overview?.range)}
            </span>
          </div>
        </div>

        <FunnelChart funnel={funnel} range={overview?.range} replayKey={funnelSceneKey} />
      </article>

      <article className="rounded-panel border border-navy/10 bg-white p-5 shadow-soft md:p-7">
        <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Equipe</p>
        <h3 className="mt-2 text-2xl font-extrabold text-navy">Desempenho por corretor no período</h3>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {team.map((row) => (
            <BrokerCard key={row.profile.id} row={row} periodQuery={periodQuery} />
          ))}
          {!team.length && overview && (
            <p className="rounded-2xl bg-blue-50 p-4 text-sm font-bold text-slate-600 sm:col-span-2 xl:col-span-3">
              Nenhum corretor ativo encontrado.
            </p>
          )}
        </div>
      </article>
    </section>
  );
}

function KpiCard({ card, value, index = 0 }) {
  const Icon = card.icon;
  return (
    <Link
      href={card.href}
      style={sceneIndex(index)}
      className={`${scene.item} rounded-panel border bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-md ${TONE_CLASSES[card.tone]?.split(" ")[0] || "border-navy/10"}`}
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

// Filtro compacto de corretores do Funil comercial: um único botão (com
// resumo da seleção) que abre um painel com busca + checkboxes — substitui a
// lista de chips, que cresceria demais com muitos corretores.
function BrokerFilterDropdown({ brokers, selectedIds, onChange, loading }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredBrokers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return brokers;
    return brokers.filter((broker) => broker.name.toLowerCase().includes(query));
  }, [brokers, search]);

  const summaryLabel = selectedIds.length === 0
    ? "Todos os corretores"
    : selectedIds.length === 1
      ? (brokers.find((broker) => broker.id === selectedIds[0])?.name || "1 corretor")
      : `${selectedIds.length} corretores selecionados`;

  function toggleBroker(brokerId) {
    onChange(selectedIds.includes(brokerId) ? selectedIds.filter((id) => id !== brokerId) : [...selectedIds, brokerId]);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-9 items-center gap-2 rounded-full border border-navy/15 bg-white px-3 text-xs font-extrabold text-navy transition hover:border-brand"
      >
        <span className="max-w-[160px] truncate sm:max-w-[220px]">{summaryLabel}</span>
        {loading ? <span className="text-slate-400">···</span> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-2xl border border-navy/10 bg-white p-3 shadow-[0_18px_48px_rgba(13,59,102,0.18)]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar corretor..."
              className="h-9 w-full rounded-xl border border-navy/10 bg-mist pl-8 pr-3 text-xs font-bold text-navy outline-none focus:border-brand"
            />
          </label>

          <button
            type="button"
            onClick={() => onChange([])}
            className={`mt-2 flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-left text-xs font-extrabold transition ${
              selectedIds.length === 0 ? "bg-blue-50 text-brand" : "text-navy hover:bg-mist"
            }`}
          >
            Todos os corretores
            {selectedIds.length === 0 && <span>✓</span>}
          </button>

          <div className="mt-1 max-h-56 overflow-y-auto">
            {filteredBrokers.map((broker) => {
              const selected = selectedIds.includes(broker.id);
              return (
                <button
                  key={broker.id}
                  type="button"
                  onClick={() => toggleBroker(broker.id)}
                  className={`flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-left text-xs font-bold transition ${
                    selected ? "bg-brand/10 text-brand" : "text-navy hover:bg-mist"
                  }`}
                >
                  <span className="truncate">{broker.name}</span>
                  {selected && <span>✓</span>}
                </button>
              );
            })}
            {!filteredBrokers.length && (
              <p className="px-2 py-2 text-xs font-semibold text-slate-400">Nenhum corretor encontrado.</p>
            )}
          </div>
        </div>
      )}
    </div>
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
        {row.dailyGoalBonusPoints > 0 && (
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-navy">Bônus Meta Diária (100%+)</span>
            <span className="font-extrabold text-emerald-700">+{formatInteger(row.dailyGoalBonusPoints)} pts</span>
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
      <div className="flex items-center gap-2.5">
        <Avatar name={row.profile.name} photoUrl={row.profile.photoUrl} size={32} />
        <p className="text-sm font-extrabold uppercase tracking-[0.08em] text-navy">{row.profile.name}</p>
      </div>
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
        className="mt-1.5 min-h-11 w-full min-w-0 rounded-2xl border border-navy/15 px-4 text-sm text-navy outline-none md:mt-2 md:w-auto focus:border-brand focus:ring-4 focus:ring-brand/15"
      />
    </label>
  );
}

// Tons do azul institucional (navy -> brand -> claro), do topo (mais escuro)
// até o fundo do funil (mais claro). As duas últimas camadas usam texto navy
// em vez de branco para manter contraste sobre o azul claro (cor inline: o
// fundo da camada não muda no modo escuro, então o texto também não pode mudar,
// e classes de cor — até hex arbitrário — são remapeadas pelo tema escuro).
const FUNNEL_LAYER_COLORS = [
  { bg: "#0A2E52", text: "text-white" },
  { bg: "#0D3B66", text: "text-white" },
  { bg: "#14508C", text: "text-white" },
  { bg: "#1769D1", text: "text-white" },
  { bg: "#6FA8E6", text: "", ink: "#0D3B66" },
  { bg: "#B7D8F7", text: "", ink: "#0D3B66" }
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

// Maior gargalo do período: a menor conversão entre etapas consecutivas
// (ignora a base "Prospecção", que não tem etapa anterior) — só um destaque
// informativo, sem alerta exagerado.
function findFunnelBottleneck(funnel) {
  let worst = null;
  for (let index = 1; index < funnel.length; index += 1) {
    const stage = funnel[index];
    if (stage.conversion === null || stage.conversion === undefined) continue;
    if (!worst || stage.conversion < worst.conversion) {
      worst = { from: funnel[index - 1].label, to: stage.label, conversion: stage.conversion };
    }
  }
  return worst;
}

// Gráfico de linhas (SVG puro, sem biblioteca de gráfico no projeto) da
// pontuação de cada corretor por bucket (dia/semana/mês) — vem pronto do
// servidor (getPerformanceTrend, mesmo motor de pontuação do resto do
// painel), este componente só desenha. Largura cresce com a quantidade de
// buckets (visão "dia a dia" fica larga de propósito) e rola horizontalmente
// em telas pequenas em vez de espremer os pontos.
// Variação de cada linha para a seta do fim: último período COMPLETO × o anterior (o período atual ainda está em
// andamento — compará-lo com um período inteiro mostraria "caiu" em todo começo de mês/semana/dia). Só subtrai
// pontos que o gráfico já mostra; nenhum cálculo de pontuação novo.
function getTrendDelta(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const last = Number(points[points.length - 2] || 0);
  const previous = Number(points[points.length - 3] || 0);
  return { last, previous, diff: last - previous };
}

function TrendDelta({ delta, index }) {
  if (!delta) return null;
  const { diff } = delta;
  const tone = diff > 0 ? scene.deltaUp : diff < 0 ? scene.deltaDown : scene.deltaFlat;
  const text = diff > 0 ? `▲ +${formatInteger(diff)}` : diff < 0 ? `▼ −${formatInteger(Math.abs(diff))}` : "= 0";
  const spoken = diff > 0 ? `subiu ${formatInteger(diff)} pontos` : diff < 0 ? `caiu ${formatInteger(Math.abs(diff))} pontos` : "sem variação";
  return (
    <span className={`${scene.theme} ${scene.delta} ${scene.pop} ${tone}`} style={sceneIndex(index)} title={`${formatInteger(delta.previous)} → ${formatInteger(delta.last)} pts`}>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}

function TeamTrendChart({ trend, loading }) {
  const buckets = trend?.buckets || [];
  const series = trend?.series || [];
  const sceneRef = useRef(null);
  // Cena nova a cada histórico carregado (granularidade/corretores diferentes).
  const trendKey = `${buckets[0]?.startDate || ""}|${buckets.length}|${series.map((line) => line.brokerId).join(",")}`;
  const phase = useSceneInView(sceneRef, { replayKey: buckets.length ? trendKey : "", delayMs: BLOCK_SCENE_DELAY_MS });

  if (!loading && !buckets.length) {
    return <p className="mt-6 rounded-2xl bg-blue-50 p-4 text-sm font-bold text-slate-600">Sem dados para montar o histórico ainda.</p>;
  }

  if (loading && !buckets.length) {
    return <p className="mt-6 text-sm font-bold text-slate-500">Carregando histórico…</p>;
  }

  const hasActivity = series.some((line) => line.points.some((value) => value > 0));
  const maxPoints = Math.max(1, ...series.flatMap((line) => line.points));
  const height = 240;
  const paddingLeft = 36;
  const paddingBottom = 28;
  const paddingTop = 12;
  const chartWidth = Math.max(560, buckets.length * 64);
  const plotWidth = chartWidth - paddingLeft - 12;
  const plotHeight = height - paddingTop - paddingBottom;
  const stepX = buckets.length > 1 ? plotWidth / (buckets.length - 1) : 0;
  const xFor = (index) => paddingLeft + stepX * index;
  const yFor = (value) => paddingTop + plotHeight - (value / maxPoints) * plotHeight;
  const gridFractions = [0, 0.25, 0.5, 0.75, 1];
  const baselineY = paddingTop + plotHeight;
  const closedLast = buckets.length >= 3 ? buckets[buckets.length - 2] : null;
  const closedPrevious = buckets.length >= 3 ? buckets[buckets.length - 3] : null;

  return (
    <div ref={sceneRef} {...sceneStaggerProps(phase, { ...TREND_SCENE, className: "mt-5" })}>
      <div className="overflow-x-auto">
        <svg width={chartWidth} height={height} viewBox={`0 0 ${chartWidth} ${height}`} role="img" aria-label="Pontuação da equipe ao longo do tempo">
          {gridFractions.map((fraction) => {
            const y = paddingTop + plotHeight * (1 - fraction);
            return (
              <g key={fraction}>
                <line x1={paddingLeft} x2={chartWidth - 12} y1={y} y2={y} stroke="#E2E8F0" strokeWidth={1} />
                <text x={paddingLeft - 8} y={y + 4} textAnchor="end" className="fill-slate-400" fontSize={10} fontWeight={700}>
                  {formatInteger(Math.round(maxPoints * fraction))}
                </text>
              </g>
            );
          })}

          {buckets.map((bucket, index) => (
            <text key={bucket.startDate} x={xFor(index)} y={height - 6} textAnchor="middle" className="fill-slate-500" fontSize={10} fontWeight={700}>
              {bucket.label}
            </text>
          ))}

          {series.map((line, seriesIndex) => {
            const color = TREND_COLORS[seriesIndex % TREND_COLORS.length];
            const path = line.points.map((value, index) => `${index === 0 ? "M" : "L"}${xFor(index)},${yFor(value)}`).join(" ");
            return (
              <g key={line.brokerId} className={scene.lineRise} style={sceneIndex(seriesIndex, { "--origin": `0px ${baselineY}px` })}>
                <path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                {line.points.map((value, index) => (
                  <circle key={index} cx={xFor(index)} cy={yFor(value)} r={3} fill={color}>
                    <title>{`${line.name} — ${buckets[index].label}: ${formatInteger(value)} pts`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      {!hasActivity && (
        <p className="mt-3 text-sm font-bold text-slate-500">Nenhuma atividade pontuada nesse período.</p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {series.map((line, seriesIndex) => (
          <span key={line.brokerId} className={`${scene.item} inline-flex items-center gap-2 rounded-full border border-navy/10 px-3 py-1 text-xs font-extrabold text-navy`} style={sceneIndex(seriesIndex)}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TREND_COLORS[seriesIndex % TREND_COLORS.length] }} />
            {line.name}
            <TrendDelta delta={getTrendDelta(line.points)} index={seriesIndex} />
          </span>
        ))}
        {!series.length && <p className="text-sm font-bold text-slate-500">Nenhum corretor ativo encontrado.</p>}
      </div>
      {series.length > 0 && closedLast && closedPrevious && (
        <p className="mt-2 text-xs font-semibold text-slate-500">
          Setas: {closedLast.label} comparado a {closedPrevious.label} (último período completo).
        </p>
      )}
    </div>
  );
}

// Nomes curtos das etapas: cabeçalho "Desde …", seletor e linha no celular
// (o nome completo continua na linha da etapa do computador).
const FUNNEL_SHORT_LABELS = {
  clients: "Prospecção",
  service: "Atendimento",
  simulation: "Simulação",
  documentation: "Documentação",
  approval: "Em aprovação",
  approved: "Aprovado",
  meeting: "Reunião",
  sale: "Venda"
};
const FUNNEL_BASE_STORAGE_KEY = "mm-desempenho-funil-base";
const FUNNEL_SHORT_PERIOD_DAYS = 30;

function readStoredFunnelBase() {
  try {
    return window.localStorage.getItem(FUNNEL_BASE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function storeFunnelBase(key) {
  try {
    window.localStorage.setItem(FUNNEL_BASE_STORAGE_KEY, key);
  } catch {
    // Aparelho sem armazenamento (modo privado etc.): a escolha só não fica lembrada.
  }
}

// Dias corridos do período (início e fim inclusos); null se o período não veio.
function countRangeDays(range) {
  const start = String(range?.startDate || "");
  const end = String(range?.endDate || start);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const diff = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Number.isFinite(diff) ? Math.round(diff / 86400000) + 1 : null;
}

function FunnelChart({ funnel, range, replayKey = "" }) {
  const boundaries = useMemo(() => getFunnelBoundaries(funnel.length), [funnel.length]);
  const bottleneck = useMemo(() => findFunnelBottleneck(funnel), [funnel]);
  // Base da coluna "Desde …" (pedido do dono, 2026-10-16): escolhida no seletor
  // ou tocando no nome da etapa; lembrada no aparelho. Só apresentação: divide
  // as contagens que já vêm prontas do servidor.
  const [baseKey, setBaseKey] = useState("");
  const [openTipKey, setOpenTipKey] = useState("");
  const sceneRef = useRef(null);
  const phase = useSceneInView(sceneRef, { replayKey: funnel.length ? replayKey : "", delayMs: BLOCK_SCENE_DELAY_MS });

  useEffect(() => {
    setBaseKey(readStoredFunnelBase());
  }, []);

  useEffect(() => {
    if (!openTipKey) return undefined;
    function close(event) {
      if (event.target instanceof Element && event.target.closest("[data-funnel-tip]")) return;
      setOpenTipKey("");
    }
    function onKey(event) {
      if (event.key === "Escape") setOpenTipKey("");
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [openTipKey]);

  if (!funnel.length) return null;

  const baseIndex = Math.max(0, funnel.findIndex((stage) => stage.key === baseKey));
  const base = funnel[baseIndex];
  const baseShortLabel = FUNNEL_SHORT_LABELS[base.key] || base.label;
  const baseValue = Number(base.value || 0);
  const rangeDays = countRangeDays(range);
  const isShortPeriod = rangeDays !== null && rangeDays < FUNNEL_SHORT_PERIOD_DAYS;

  function chooseBase(key) {
    setBaseKey(key);
    setOpenTipKey("");
    storeFunnelBase(key);
  }

  return (
    <>
    <div className="mt-4 flex items-center gap-2">
      <label htmlFor="funnel-base-select" className="shrink-0 text-xs font-bold text-slate-500">
        Conversão desde
      </label>
      <span className="relative inline-flex min-w-0">
        <select
          id="funnel-base-select"
          value={base.key}
          onChange={(event) => chooseBase(event.target.value)}
          className="min-h-9 w-auto max-w-full appearance-none rounded-full border border-navy/15 bg-white py-1 pl-3 pr-8 text-xs font-extrabold text-navy outline-none transition hover:border-brand focus:border-brand focus:ring-4 focus:ring-brand/15"
        >
          {funnel.map((stage) => (
            <option key={stage.key} value={stage.key}>{FUNNEL_SHORT_LABELS[stage.key] || stage.label}</option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
      </span>
    </div>

    <div
      ref={sceneRef}
      {...sceneStaggerProps(phase, {
        ...FUNNEL_SCENE,
        className: "mt-3 grid grid-cols-[minmax(80px,1fr)_minmax(0,1.8fr)_auto_auto] items-center gap-x-2 gap-y-1 sm:grid-cols-[minmax(120px,1fr)_minmax(0,3.2fr)_auto_auto] sm:gap-x-5 sm:gap-y-1.5"
      })}
    >
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <p
        className="min-w-[2.5rem] self-end text-right text-[9px] font-extrabold uppercase leading-tight tracking-[0.1em] text-slate-400 sm:min-w-[4.5rem] sm:text-[11px] sm:tracking-[0.14em]"
        title="Conversão de uma etapa para a seguinte"
      >
        <span className="sm:hidden">Etapa</span>
        <span className="hidden sm:inline">Etapa a etapa</span>
      </p>
      <p
        className="min-w-[2.75rem] self-end text-right text-[9px] font-extrabold uppercase leading-tight tracking-[0.04em] text-brand sm:min-w-[5.5rem] sm:text-[11px] sm:tracking-[0.14em]"
        title={`Quantos chegaram a cada etapa, em relação a ${base.label}`}
      >
        <span className="block sm:inline">Desde</span>{" "}
        <span className="block sm:inline">{baseShortLabel}</span>
      </p>

      {funnel.map((stage, index) => {
        const topWidth = boundaries[index];
        const bottomWidth = boundaries[index + 1];
        const insetTop = (100 - topWidth) / 2;
        const insetBottom = (100 - bottomWidth) / 2;
        const color = FUNNEL_LAYER_COLORS[index] || FUNNEL_LAYER_COLORS[FUNNEL_LAYER_COLORS.length - 1];
        const hasConversion = index > 0 && stage.conversion !== null && stage.conversion !== undefined;
        const stepLabel = hasConversion ? formatConversionPercent(stage.conversion) : "—";
        const previous = index > 0 ? funnel[index - 1] : null;
        const stepTitle = index === 0
          ? "Primeira etapa: não tem etapa anterior"
          : `${formatInteger(stage.value)} de ${formatInteger(previous.value)} (${previous.label})`;
        const isBase = index === baseIndex;
        const value = Number(stage.value || 0);
        const sinceRatio = index > baseIndex && baseValue > 0 ? value / baseValue : null;
        const sinceText = `${formatInteger(value)} de ${formatInteger(baseValue)}`;
        const tipOpen = openTipKey === stage.key;
        const rowStyle = sceneIndex(index);

        return (
          <div key={stage.key} className="contents">
            <button
              type="button"
              onClick={() => chooseBase(stage.key)}
              aria-pressed={isBase}
              title={isBase ? "Base da conversão" : `Calcular a conversão desde ${stage.label}`}
              style={rowStyle}
              className={`${scene.item} min-h-8 min-w-0 py-0.5 text-left text-[11px] font-extrabold leading-tight transition hover:text-brand sm:min-h-11 sm:text-sm sm:leading-normal ${
                isBase ? "text-brand" : "text-navy"
              }`}
            >
              {isBase && <span className="mr-1 hidden size-2 rounded-full bg-brand align-middle sm:inline-block" aria-hidden="true" />}
              <span className="sm:hidden">{FUNNEL_SHORT_LABELS[stage.key] || stage.label}</span>
              <span className="hidden sm:inline">{stage.label}</span>
            </button>

            <Link
              href={buildFunnelStageHref(stage.key)}
              style={rowStyle}
              className={`${scene.itemBar} group relative flex h-8 items-center justify-center sm:h-11`}
              aria-label={`${stage.label}: ${formatInteger(stage.value)} — ver clientes`}
            >
              <span
                className="absolute inset-0 flex items-center justify-center transition duration-300 group-hover:brightness-110"
                style={{
                  backgroundColor: color.bg,
                  clipPath: `polygon(${insetTop}% 0, ${100 - insetTop}% 0, ${100 - insetBottom}% 100%, ${insetBottom}% 100%)`
                }}
              >
                <span className={`text-xs font-black tabular-nums tracking-tight sm:text-lg ${color.text}`} style={color.ink ? { color: color.ink } : undefined}>
                  <SceneCount
                    value={stage.value}
                    phase={phase}
                    delayMs={index * FUNNEL_SCENE.stepMs + 120}
                    durationMs={FUNNEL_COUNT_MS}
                    format={formatInteger}
                  />
                </span>
              </span>
            </Link>

            <span className={`${scene.item} text-right text-[11px] font-black tabular-nums text-navy sm:text-sm`} style={rowStyle} title={stepTitle}>
              {stepLabel}
            </span>

            <span className={`${scene.item} text-right text-[11px] font-black tabular-nums sm:text-sm`} style={rowStyle}>
              {isBase ? (
                <span className="font-extrabold text-brand" title={`${base.label}: ${formatInteger(baseValue)}`}>Base</span>
              ) : sinceRatio === null ? (
                <span className="text-slate-400" title={index < baseIndex ? "Etapa antes da base" : "Base sem clientes no período"}>—</span>
              ) : (
                <span className="relative inline-block" data-funnel-tip>
                  <button
                    type="button"
                    onClick={() => setOpenTipKey(tipOpen ? "" : stage.key)}
                    aria-label={`${formatConversionPercent(sinceRatio)}: ${sinceText} desde ${base.label}`}
                    aria-expanded={tipOpen}
                    title={sinceText}
                    className="peer rounded px-0.5 text-brand underline decoration-brand/30 decoration-dotted underline-offset-4 outline-none transition hover:decoration-brand focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    {formatConversionPercent(sinceRatio)}
                  </button>
                  <span
                    role="tooltip"
                    className={`pointer-events-none absolute bottom-full right-0 z-10 mb-1.5 whitespace-nowrap rounded-lg border border-navy/10 bg-white px-2 py-1 text-[11px] font-extrabold text-navy shadow-soft sm:text-xs ${
                      tipOpen ? "block" : "hidden sm:peer-hover:block sm:peer-focus-visible:block"
                    }`}
                  >
                    {sinceText}
                  </span>
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
    {bottleneck && (
      <p className="mt-3 text-xs font-bold text-slate-500">
        <span className="font-extrabold uppercase tracking-[0.08em] text-amber-700">Maior gargalo</span>
        {" — "}{bottleneck.from} → {bottleneck.to}: <span className="font-extrabold text-navy">{formatConversionPercent(bottleneck.conversion)}</span> de conversão
      </p>
    )}
    {isShortPeriod && (
      <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold leading-snug text-slate-500">
        <Info size={14} className="mt-px shrink-0 text-slate-400" aria-hidden="true" />
        <span>
          Período curto: clientes recentes ainda não tiveram tempo de chegar às últimas etapas. Para ver a conversão total, use de 60 a 90 dias.
        </span>
      </p>
    )}
    </>
  );
}

function buildFunnelStageHref(key) {
  if (key === "clients") return "/admin/simulacoes";
  if (key === "service") return "/admin/simulacoes?status=in_service";
  if (key === "simulation") return "/admin/simulacoes?statusGroup=simulation";
  if (key === "documentation") return "/admin/simulacoes?statusGroup=documentation";
  if (key === "approval") return "/admin/simulacoes?statusGroup=approval";
  if (key === "approved") return "/admin/simulacoes?statusGroup=approved";
  if (key === "meeting") return "/admin/simulacoes?statusGroup=meeting";
  if (key === "sale") return "/admin/simulacoes?statusGroup=sale";
  return "/admin/simulacoes";
}

// "04/10 a 10/10" (mesmo ano) ou "10/10/2026" (um dia só); ano aparece quando o período cruza anos.
function formatRangeLabel(range) {
  const start = String(range?.startDate || "");
  const end = String(range?.endDate || start);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return "";
  const fmt = (value, withYear) => `${value.slice(8, 10)}/${value.slice(5, 7)}${withYear ? `/${value.slice(0, 4)}` : ""}`;
  if (start === end) return fmt(start, true);
  const crossYear = start.slice(0, 4) !== end.slice(0, 4);
  return `${fmt(start, crossYear)} a ${fmt(end, crossYear)}`;
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


// Uma casa decimal (pt-BR): 0,2% / 33,3%. 0% e 100% exatos sem decimal; valor
// positivo pequeno demais para aparecer vira "<0,1%" (nunca some como 0).
function formatConversionPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const ratio = Number(value);
  const tenths = Math.round(ratio * 1000);
  if (ratio > 0 && tenths === 0) return "<0,1%";
  if (tenths % 1000 === 0) return `${tenths / 10}%`;
  return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(tenths / 10)}%`;
}
