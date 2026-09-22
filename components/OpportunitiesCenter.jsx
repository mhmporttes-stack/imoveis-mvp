"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw, ChevronDown, ChevronUp, Phone } from "lucide-react";
import { buildWhatsAppUrl, toWhatsAppDigits } from "@/lib/phone-utils";
import OpportunityDetailPanel from "@/components/OpportunityDetailPanel";

const STAGE_OPTIONS = [
  { key: "service", label: "Atendimento" },
  { key: "simulation", label: "Simulação" },
  { key: "documentation", label: "Aguardando documentação" },
  { key: "approval", label: "Aguardando aprovação" },
  { key: "approved", label: "Cliente aprovado" },
  { key: "meeting", label: "Reunião" }
];

const QUICK_FILTERS = [
  { key: "all", label: "Todas", filters: {} },
  { key: "hot", label: "🔥 Muito quentes", filters: { category: "hot" } },
  { key: "high", label: "Alta oportunidade", filters: { category: "high" } },
  { key: "approved", label: "Aprovados", filters: { tag: "approved_no_meeting" } },
  { key: "followup", label: "Follow-up", filters: { tag: "meeting_done" } },
  { key: "reactivation", label: "Reativação", filters: { category: "reactivation" } },
  { key: "no_activity", label: "Sem atividade futura", filters: { tag: "no_future_activity" } }
];

const EMPTY_FILTERS = { category: "", stage: "", responsibleUserId: "", tag: "", minPriority: "", hasFutureActivity: "" };

export default function OpportunitiesCenter({ initialData, canSeeTeam }) {
  const [data, setData] = useState(initialData);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [activeQuickFilter, setActiveQuickFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("priority");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const searchTimer = useRef(null);
  const isFirstRender = useRef(true);

  const fetchData = useCallback(async (overrides = {}) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const nextFilters = overrides.filters ?? filters;
      const nextSearch = overrides.search ?? search;
      const nextSort = overrides.sort ?? sort;
      const nextPage = overrides.page ?? page;

      if (nextFilters.category) params.set("category", nextFilters.category);
      if (nextFilters.stage) params.set("stage", nextFilters.stage);
      if (nextFilters.responsibleUserId) params.set("responsibleUserId", nextFilters.responsibleUserId);
      if (nextFilters.tag) params.set("tag", nextFilters.tag);
      if (nextFilters.minPriority) params.set("minPriority", nextFilters.minPriority);
      if (nextFilters.hasFutureActivity) params.set("hasFutureActivity", nextFilters.hasFutureActivity);
      if (nextSearch) params.set("search", nextSearch);
      params.set("sort", nextSort);
      params.set("page", String(nextPage));

      const response = await fetch(`/api/admin/opportunities?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar oportunidades.");
      setData(payload);
      setLastUpdated(new Date());
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [filters, search, sort, page]);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sort, page]);

  function handleSearchChange(value) {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);
      fetchData({ search: value, page: 1 });
    }, 350);
  }

  function applyQuickFilter(quick) {
    setActiveQuickFilter(quick.key);
    setPage(1);
    setFilters((current) => ({ ...EMPTY_FILTERS, ...quick.filters }));
  }

  function applyCardFilter(patch) {
    setActiveQuickFilter("");
    setPage(1);
    setFilters({ ...EMPTY_FILTERS, ...patch });
  }

  function updateAdvancedFilter(patch) {
    setActiveQuickFilter("");
    setPage(1);
    setFilters((current) => ({ ...current, ...patch }));
  }

  async function refetchCurrentView() {
    await fetchData();
  }

  async function handleQuickWhatsApp(item) {
    const value = item.phoneNormalized;
    const whatsapp = buildWhatsAppUrl(value);
    if (!whatsapp || !toWhatsAppDigits(value)) { alert("Este cliente não possui um WhatsApp válido."); return; }
    const whatsappWindow = window.open("about:blank", "_blank");
    try {
      const response = await fetch(`/api/simulation-registrations/${item.id}/whatsapp-contact`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Não foi possível registrar o contato.");
      if (whatsappWindow) { whatsappWindow.opener = null; whatsappWindow.location.href = whatsapp; }
      await refetchCurrentView();
    } catch (error) {
      if (whatsappWindow) whatsappWindow.close();
      alert(error.message);
    }
  }

  const { page: pageData, top = [], cards = {}, byBroker, gaps } = data || {};
  const items = pageData?.items || [];

  return (
    <div className="container-page space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-line bg-white p-4 shadow-soft">
        <p className="text-sm font-bold text-muted">
          {loading ? <span className="inline-flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" />Atualizando...</span> : `Atualizado às ${lastUpdated.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
        </p>
        <button type="button" onClick={() => fetchData()} className="premium-button-secondary"><RefreshCw className="h-4 w-4" />Atualizar</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard emoji="🔥" label="Muito quentes" value={cards.hot} onClick={() => applyCardFilter({ category: "hot" })} />
        <SummaryCard emoji="✅" label="Aprovados sem reunião" value={cards.approvedNoMeeting} onClick={() => applyCardFilter({ tag: "approved_no_meeting" })} />
        <SummaryCard emoji="💬" label="Voltaram a responder" value={cards.recentResponse} onClick={() => applyCardFilter({ tag: "recent_response" })} />
        <SummaryCard emoji="⚠️" label="Sem atividade futura" value={cards.noFutureActivity} onClick={() => applyCardFilter({ tag: "no_future_activity" })} />
      </div>

      <div className="rounded-[28px] border border-line bg-white p-4 shadow-soft">
        <div className="flex flex-wrap gap-2">
          {QUICK_FILTERS.map((quick) => (
            <button
              key={quick.key}
              type="button"
              onClick={() => applyQuickFilter(quick)}
              className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${activeQuickFilter === quick.key ? "bg-navy text-white" : "border border-line text-navy hover:bg-mist"}`}
            >
              {quick.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Buscar por nome ou telefone"
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
            className="flex-1 min-w-[220px] rounded-lg border border-line p-2.5 text-sm"
          />
          <button type="button" onClick={() => setShowAdvanced((current) => !current)} className="premium-button-secondary">
            Filtros avançados{showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>

        {showAdvanced ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-bold text-navy">Etapa
              <select className="mt-1 w-full rounded-lg border border-line p-2 text-sm" value={filters.stage} onChange={(event) => updateAdvancedFilter({ stage: event.target.value })}>
                <option value="">Todas</option>
                {STAGE_OPTIONS.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
              </select>
            </label>
            {canSeeTeam && byBroker ? (
              <label className="text-xs font-bold text-navy">Corretor
                <select className="mt-1 w-full rounded-lg border border-line p-2 text-sm" value={filters.responsibleUserId} onChange={(event) => updateAdvancedFilter({ responsibleUserId: event.target.value })}>
                  <option value="">Todos</option>
                  {byBroker.map((broker) => <option key={broker.brokerId} value={broker.brokerId}>{broker.brokerName}</option>)}
                </select>
              </label>
            ) : null}
            <label className="text-xs font-bold text-navy">Score mínimo
              <input type="number" min="0" max="100" className="mt-1 w-full rounded-lg border border-line p-2 text-sm" value={filters.minPriority} onChange={(event) => updateAdvancedFilter({ minPriority: event.target.value })} />
            </label>
            <label className="text-xs font-bold text-navy">Atividade futura
              <select className="mt-1 w-full rounded-lg border border-line p-2 text-sm" value={filters.hasFutureActivity} onChange={(event) => updateAdvancedFilter({ hasFutureActivity: event.target.value })}>
                <option value="">Todos</option>
                <option value="true">Com atividade futura</option>
                <option value="false">Sem atividade futura</option>
              </select>
            </label>
          </div>
        ) : null}
      </div>

      {canSeeTeam && (byBroker?.length || gaps?.length) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {byBroker?.length ? (
            <div className="rounded-[28px] border border-line bg-white p-5 shadow-soft">
              <p className="text-sm font-black uppercase tracking-wide text-navy">Oportunidades por corretor</p>
              <div className="mt-3 space-y-2">
                {byBroker.map((broker) => (
                  <button key={broker.brokerId} type="button" onClick={() => updateAdvancedFilter({ responsibleUserId: broker.brokerId })} className="flex w-full items-center justify-between rounded-xl border border-line px-4 py-2 text-left hover:bg-mist">
                    <span className="font-bold text-navy">{broker.brokerName}</span>
                    <span className="text-sm font-black text-brand">{broker.critical} críticas</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {gaps?.length ? (
            <div className="rounded-[28px] border border-line bg-white p-5 shadow-soft">
              <p className="text-sm font-black uppercase tracking-wide text-navy">Gargalos da equipe</p>
              <div className="mt-3 space-y-2">
                {gaps.map((gap) => (
                  <button key={gap.key} type="button" onClick={() => applyCardFilter({ tag: gap.key === "approved_no_meeting" ? "approved_no_meeting" : gap.key === "awaiting_documentation" ? "awaiting_documentation" : gap.key === "meeting_no_follow_up" ? "meeting_done" : "no_future_activity" })} className="flex w-full items-center justify-between rounded-xl border border-line px-4 py-2 text-left hover:bg-mist">
                    <span className="font-bold text-navy">{gap.label}</span>
                    <span className="text-sm font-black text-brand">{gap.count}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <p className="text-lg font-black text-navy">Suas melhores oportunidades de hoje</p>
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {top.map((item) => (
            <TopOpportunityCard key={item.id} item={item} onOpen={() => setSelectedClientId(item.id)} onWhatsApp={() => handleQuickWhatsApp(item)} />
          ))}
          {!top.length ? <p className="text-sm text-muted">Nenhuma oportunidade encontrada agora.</p> : null}
        </div>
      </div>

      <div>
        <p className="text-lg font-black text-navy">Todas as oportunidades</p>

        <div className="mt-3 hidden overflow-x-auto rounded-2xl border border-line bg-white md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-mist text-xs font-black uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Etapa</th>
                <th className="px-4 py-3 cursor-pointer" onClick={() => setSort("score")}>Score</th>
                <th className="px-4 py-3">Principal motivo</th>
                <th className="px-4 py-3">Próxima ação</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="cursor-pointer border-t border-line hover:bg-mist" onClick={() => setSelectedClientId(item.id)}>
                  <td className="px-4 py-3 font-bold text-navy">{item.fullName}</td>
                  <td className="px-4 py-3 text-muted">{STAGE_OPTIONS.find((stage) => stage.key === item.stage)?.label || "Prospecção"}</td>
                  <td className="px-4 py-3 font-black text-navy">{item.priority}{item.categoryEmoji}</td>
                  <td className="px-4 py-3 text-muted">{item.reasons[0] || "—"}</td>
                  <td className="px-4 py-3 text-brand font-bold">{item.recommendedAction.label}</td>
                </tr>
              ))}
              {!items.length ? <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">Nenhuma oportunidade encontrada.</td></tr> : null}
            </tbody>
          </table>
        </div>

        <div className="mt-3 space-y-3 md:hidden">
          {items.map((item) => (
            <MobileOpportunityCard key={item.id} item={item} onOpen={() => setSelectedClientId(item.id)} onWhatsApp={() => handleQuickWhatsApp(item)} />
          ))}
          {!items.length ? <p className="text-sm text-muted">Nenhuma oportunidade encontrada.</p> : null}
        </div>

        {pageData ? (
          <div className="mt-4 flex items-center justify-between">
            <button type="button" disabled={pageData.page <= 1} onClick={() => setPage((current) => current - 1)} className="premium-button-secondary disabled:opacity-40">Anterior</button>
            <p className="text-sm font-bold text-muted">Página {pageData.page} de {pageData.totalPages} ({pageData.total} no total)</p>
            <button type="button" disabled={pageData.page >= pageData.totalPages} onClick={() => setPage((current) => current + 1)} className="premium-button-secondary disabled:opacity-40">Próxima</button>
          </div>
        ) : null}
      </div>

      {selectedClientId ? (
        <OpportunityDetailPanel clientId={selectedClientId} onClose={() => setSelectedClientId("")} onActionCompleted={refetchCurrentView} />
      ) : null}
    </div>
  );
}

function SummaryCard({ emoji, label, value, onClick }) {
  return (
    <button type="button" onClick={onClick} className="rounded-2xl border border-line bg-white p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg">
      <p className="text-2xl font-black text-navy">{emoji} {value ?? 0}</p>
      <p className="mt-1 text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
    </button>
  );
}

function TopOpportunityCard({ item, onOpen, onWhatsApp }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onOpen} className="text-left font-black text-navy hover:text-brand">{item.fullName}</button>
        <span className="text-xl font-black text-navy">{item.priority} {item.categoryEmoji}</span>
      </div>
      <p className="mt-1 text-xs font-bold uppercase text-muted">{item.categoryLabel}</p>
      <p className="mt-3 text-xs font-black uppercase text-muted">Por que está aqui</p>
      <p className="text-sm text-navy">{item.reasons[0] || "—"}</p>
      <p className="mt-3 text-xs font-black uppercase text-muted">Próxima ação</p>
      <p className="text-sm font-bold text-brand">{item.recommendedAction.label}</p>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onWhatsApp} className="premium-button-primary flex-1 justify-center">WhatsApp</button>
        <button type="button" onClick={onOpen} className="premium-button-secondary flex-1 justify-center">Abrir cliente</button>
      </div>
    </div>
  );
}

function MobileOpportunityCard({ item, onOpen, onWhatsApp }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
      <div className="flex items-center justify-between">
        <span className="text-2xl font-black text-navy">{item.priority} {item.categoryEmoji}</span>
      </div>
      <button type="button" onClick={onOpen} className="mt-1 text-left font-black text-navy">{item.fullName}</button>
      <p className="text-sm text-muted">{item.reasons[0] || "—"}</p>
      <p className="mt-2 text-xs font-black uppercase text-muted">Próxima ação</p>
      <p className="text-sm font-bold text-brand">{item.recommendedAction.label}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onWhatsApp} className="premium-button-primary flex-1 justify-center min-h-11">WhatsApp</button>
        <a href={`tel:${item.phoneNormalized}`} className="premium-button-secondary min-h-11 justify-center px-4"><Phone className="h-4 w-4" /></a>
      </div>
    </div>
  );
}
