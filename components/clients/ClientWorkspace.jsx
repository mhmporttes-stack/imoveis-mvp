"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Calculator, CalendarDays, ChevronLeft, ChevronRight, Inbox, Link2, MessageCircle, Search, SlidersHorizontal, Target, TriangleAlert, UserRoundPlus, UserSearch, X } from "lucide-react";
import NotificationHistoryButton from "@/components/alerts/NotificationHistoryButton";
import CooledClientsInbox from "@/components/cooled/CooledClientsInbox";
import SceneTransitionLink from "@/components/motion/SceneTransitionLink";
import { CountBadge } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import { inputClasses } from "@/components/ui/Field";
import Sheet from "@/components/ui/Sheet";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import { SHORTCUT_ICON_BUTTON } from "@/components/ui/shortcut-icon";
import { useCrmBadgeCounts } from "@/components/useCrmBadgeCounts";
import { useChatHidden } from "@/components/WhatsappAccessProvider";
import { CLIENT_STATUS, CLIENT_STATUS_FILTER_GROUPS, CLIENT_STATUS_META } from "@/lib/client-status";
import { formatMoneyBR } from "@/lib/simulation-list-utils";
import ClientCard from "./ClientCard";
import ClientSheet from "./ClientSheet";
import ProspectingRepliesPanel from "./ProspectingRepliesPanel";
import { PAGE_SIZE_OPTIONS, datePresetRange, formatDateRangeLabel } from "./client-format";
import { useClientList } from "./useClientList";

// Lista de clientes (/admin/simulacoes) — redesenho do Designer CRM,
// aprovado pelo dono em 2026-10-01. Toda a lógica vive em useClientList.
//   Hierarquia: 1) o que precisa de ação agora · 2) onde a carteira está no
//   funil · 3) os cards dos clientes (ClientCard), com o que se usa no dia a
//   dia · 4) a ficha do cliente numa gaveta para o secundário.
export default function ClientWorkspace(props) {
  const { canManageResponsibleUsers = false, canReturnAssignedProspecting = false, isOwner = false, brokerSimulationLink = "", showCooledInbox = false, showNotifications = false } = props;
  // No computador, "Clientes que esfriaram" e "Notificações" ficam nos atalhos do topo desta tela (dono, 2026-10-16); o
  // marcador abaixo esconde as cópias do cartão "Melhor do Dia" (só md+; no celular continuam lá, pois estes atalhos não existem).
  const movedShortcuts = showCooledInbox || showNotifications;
  useEffect(() => {
    if (!movedShortcuts) return undefined;
    document.body.dataset.shortcutsMoved = "true";
    return () => { delete document.body.dataset.shortcutsMoved; };
  }, [movedShortcuts]);
  const [notify, toastElement] = useToast();
  const [confirmAction, confirmElement] = useConfirm();
  const [openClientId, setOpenClientId] = useState("");
  const list = useClientList({ ...props, notify, confirmAction, pinClientId: openClientId });
  const badgeCounts = useCrmBadgeCounts();
  // Modo lista impressa (PRO-15, 2026-10-15): sem atalho do Chat enquanto o WhatsApp estiver desconectado.
  const chatHidden = useChatHidden();
  const [openFocus, setOpenFocus] = useState("");
  const openFicha = (clientId, focus = "") => {
    setOpenFocus(focus);
    setOpenClientId(clientId);
  };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const topRef = useRef(null);
  const goToPage = (nextPage) => {
    list.goToPage(nextPage);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const [repliesOpen, setRepliesOpen] = useState(false);

  // Vindo de outra tela (/admin/simulacoes?clientId=X): abre a ficha.
  // ?prospectingReplies=1 (menu de pendências, push): abre "Respostas da prospecção".
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const clientId = params.get("clientId");
    if (clientId) setOpenClientId(clientId);
    if (params.get("prospectingReplies") === "1") setRepliesOpen(true);
  }, []);

  const openClient = list.items.find((item) => item.id === openClientId) || null;
  const responsibleNameOf = (client) => list.responsibleProfileMap.get(client.registration?.responsibleUserId || "")?.name
    || client.lastAdminLabel
    || (client.registration?.pendingDistributionAt ? "Aguardando distribuição" : "Sem corretor");
  const responsibleProfileOf = (client) => list.responsibleProfileMap.get(client.registration?.responsibleUserId || "") || null;

  const { filters } = list;
  const extraFilterCount = [filters.responsibleUserId !== "all", filters.tagId !== "all", filters.staleContactOnly, filters.noFutureActivityOnly, Boolean(filters.dateFrom || filters.dateTo)].filter(Boolean).length;
  const chips = buildChips(filters, list);
  const anyFilter = chips.length > 0 || filters.statusGroup !== "all" || filters.status !== "all" || Boolean(filters.query);
  const pageStart = list.total ? (list.page - 1) * list.pageSize + 1 : 0;
  const pageEnd = list.total ? pageStart + list.items.length - 1 : 0;

  return (
    <section ref={topRef} className="container-page scroll-mt-4 pb-6" aria-labelledby="clientes-titulo">
      {/* 1. Cabeçalho */}
      {/* Celular (dono, 2026-10-12): sem o cabeçalho — título só para leitor de tela; "Novo cliente" e "Prospecção" ficam no
          menu "Mais" e "Meu link" ao lado da busca. A contagem total já aparece em "Todos" no funil. Desktop inalterado. */}
      <header className="max-sm:block sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:gap-y-3">
        {/* Contagem na mesma linha do título (dono, 2026-10-12: economizar espaço). */}
        <div className="flex min-w-0 items-baseline gap-2 max-sm:sr-only">
          <h1 id="clientes-titulo" className="text-[28px] font-semibold uppercase leading-[34px] tracking-[0.01em] text-navy">Clientes</h1>
          {/* Só o número (dono, 2026-10-12); o texto completo fica para leitor de tela. */}
          <p className="truncate text-sm text-ink-2 tabular-nums" aria-label={`${list.total} ${list.total === 1 ? "cliente" : "clientes"}${anyFilter ? " neste filtro" : ""}`}>
            {list.total}
          </p>
        </div>
        <div className="flex items-center gap-2 max-sm:hidden">
          {/* Atalhos para Meta Diária, Chat e Agenda: no desktop o menu do topo
              não mostra os subitens do grupo CRM/Clientes; no celular eles
              estão na barra inferior. */}
          <nav aria-label="Atalhos" className="mr-1 hidden items-center gap-1 md:flex">
            <SceneTransitionLink href="/admin/meta-diaria" direction="forward" aria-label="Meta Diária" title="Meta Diária" className={SHORTCUT}>
              <Target className="h-5 w-5" aria-hidden="true" />
            </SceneTransitionLink>
            {/* Simulador Caixa (dono, 2026-10-19): todos os perfis do painel; sem contador; entre a Meta e o Chat. */}
            <Link href="/admin/simulador-caixa" aria-label="Simulador Caixa" title="Simulador Caixa" className={SHORTCUT}>
              <Calculator className="h-5 w-5" aria-hidden="true" />
            </Link>
            {chatHidden ? null : (
              <Link href="/admin/chat" aria-label={`Chat${badgeCounts.chat ? ` (${badgeCounts.chat} não lidas)` : ""}`} title="Chat" className={SHORTCUT}>
                <MessageCircle className="h-5 w-5" aria-hidden="true" />
                <CountBadge count={badgeCounts.chat} className="absolute -right-1 -top-1 ring-2 ring-mist" label={`${badgeCounts.chat} mensagens não lidas`} />
              </Link>
            )}
            <Link href="/admin/calendario" aria-label={`Agenda${badgeCounts.agenda ? ` (${badgeCounts.agenda} pendentes)` : ""}`} title="Agenda" className={SHORTCUT}>
              <CalendarDays className="h-5 w-5" aria-hidden="true" />
              <CountBadge count={badgeCounts.agenda} className="absolute -right-1 -top-1 ring-2 ring-mist" label={`${badgeCounts.agenda} atividades pendentes`} />
            </Link>
            {showCooledInbox ? <CooledClientsInbox align="end" variant="shortcut" /> : null}
            {showNotifications ? <NotificationHistoryButton align="end" variant="shortcut" /> : null}
          </nav>
          {brokerSimulationLink ? (
            <Button variant="ghost" size="md" onClick={list.copyBrokerSimulationLink} className="hidden sm:inline-flex">
              <Link2 className="h-4 w-4" aria-hidden="true" /> Meu link
            </Button>
          ) : null}
          {brokerSimulationLink ? (
            <Button variant="secondary" size="icon" onClick={list.copyBrokerSimulationLink} className="sm:hidden" aria-label="Copiar meu link de simulação">
              <Link2 className="h-5 w-5" aria-hidden="true" />
            </Button>
          ) : null}
          <Button variant="secondary" href="/admin/prospeccao" className="hidden sm:inline-flex">
            <UserSearch className="h-4 w-4" aria-hidden="true" /> Prospecção
          </Button>
          <Button variant="secondary" size="icon" href="/admin/prospeccao" className="sm:hidden" aria-label="Prospecção">
            <UserSearch className="h-5 w-5" aria-hidden="true" />
          </Button>
          <Button href="/admin/simulacoes/nova" className="hidden sm:inline-flex">
            <UserRoundPlus className="h-4 w-4" aria-hidden="true" /> Novo cliente
          </Button>
          <Button href="/admin/simulacoes/nova" size="icon" className="sm:hidden" aria-label="Novo cliente">
            <UserRoundPlus className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>
      </header>

      {/* Os 4 cards "Para agir agora" (Pendentes, Novos atendimentos, Aguardando simulação, Respostas da prospecção)
          foram removidos para todos os perfis a pedido do dono (2026-10-12: "não os utilizo"). O painel de respostas
          da prospecção continua abrindo pelo link ?prospectingReplies=1 (menu de pendências e push). */}
      <ProspectingRepliesPanel
        open={repliesOpen}
        onClose={() => setRepliesOpen(false)}
        notify={notify}
        onChanged={() => list.fetchClients?.()}
        onOpenClient={(clientId) => { setRepliesOpen(false); openFicha(clientId); }}
      />

      {/* 3. Funil */}
      <PipelineStrip list={list} />

      {/* 4. Busca e filtros */}
      <div className="sticky top-[env(safe-area-inset-top)] z-20 -mx-3 mt-4 bg-mist/95 px-3 py-2 backdrop-blur sm:-mx-4 sm:px-4">
        <div className="flex gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Buscar cliente por nome ou telefone</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="search"
              className={cx(inputClasses, "pl-9 pr-9")}
              placeholder="Buscar nome ou telefone"
              value={list.searchInput}
              onChange={(event) => list.setSearchInput(event.target.value)}
            />
            {list.searchInput ? (
              <button type="button" onClick={() => list.setSearchInput("")} aria-label="Limpar busca" className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-control text-muted hover:text-ink">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </label>
          {brokerSimulationLink ? (
            <Button variant="secondary" size="icon" onClick={list.copyBrokerSimulationLink} className="sm:hidden" aria-label="Copiar meu link de simulação">
              <Link2 className="h-5 w-5" aria-hidden="true" />
            </Button>
          ) : null}
          <Button variant={extraFilterCount ? "primary" : "secondary"} onClick={() => setFiltersOpen(true)} aria-haspopup="dialog" aria-label={extraFilterCount ? `Filtros (${extraFilterCount} ativos)` : "Filtros"}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Filtros</span>
            {extraFilterCount ? <span className="tabular-nums">({extraFilterCount})</span> : null}
          </Button>
        </div>
        {chips.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              <button key={chip.key} type="button" onClick={chip.onRemove} className="inline-flex h-8 items-center gap-1 rounded-full border border-info-line bg-info-soft pl-3 pr-2 text-[13px] font-medium text-info hover:border-info" aria-label={`Remover filtro: ${chip.label}`}>
                {chip.label}
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ))}
            <button type="button" onClick={list.resetFilters} className="h-8 px-2 text-[13px] font-medium text-ink-2 hover:text-ink hover:underline">Limpar tudo</button>
          </div>
        ) : null}
      </div>

      {/* 5. Lista */}
      <div className="relative mt-3">
        {list.loading ? <span className="ui-progress absolute inset-x-0 -top-2 z-10 h-0.5 rounded-full" role="progressbar" aria-label="Atualizando a lista" /> : null}
        {list.loadError ? (
          <div className="rounded-card border border-line bg-white">
            <EmptyState tone="danger" icon={TriangleAlert} title="Não foi possível carregar os clientes" description={list.loadError} action={<Button size="sm" onClick={list.fetchClients}>Tentar de novo</Button>} />
          </div>
        ) : list.loading && !list.items.length ? (
          <div className="rounded-card border border-line bg-white p-5"><SkeletonList rows={6} label="Carregando clientes…" /></div>
        ) : list.items.length ? (
          <div className={cx("grid gap-3 transition-opacity duration-150 [grid-template-columns:repeat(auto-fill,minmax(min(100%,22rem),1fr))] xl:[grid-template-columns:repeat(auto-fill,minmax(26rem,1fr))]", list.loading && "opacity-60")} aria-busy={list.loading || undefined}>
            {list.items.map((client) => (
              <ClientCard
                key={client.id}
                client={client}
                activities={list.activitiesFor(client)}
                responsibleName={responsibleNameOf(client)}
                responsibleProfile={responsibleProfileOf(client)}
                showResponsible={canManageResponsibleUsers}
                busy={list.busyClientId === client.id}
                selected={openClientId === client.id}
                isOwner={isOwner}
                canReturnAssignedProspecting={canReturnAssignedProspecting}
                list={list}
                confirmAction={confirmAction}
                onOpen={(focus = "") => openFicha(client.id, focus)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-card border border-line bg-white">
            <EmptyState
              icon={Inbox}
              title={filters.query ? "Nenhum cliente encontrado para esta busca" : anyFilter ? "Nenhum cliente neste filtro" : "Nenhum cliente ainda"}
              description={anyFilter ? "Tente outro termo ou limpe os filtros." : brokerSimulationLink ? "Compartilhe seu link de simulação para receber os primeiros clientes." : "Cadastre um cliente ou aguarde novos atendimentos."}
              action={anyFilter ? <Button variant="secondary" size="sm" onClick={list.resetFilters}>Limpar filtros</Button> : <Button size="sm" href="/admin/simulacoes/nova">Novo cliente</Button>}
            />
          </div>
        )}
      </div>

      {/* 6. Paginação */}
      {list.total > 0 && !list.loadError ? (
        <nav className="mt-3 flex flex-wrap items-center justify-between gap-3" aria-label="Paginação">
          <p className="text-[13px] text-ink-2 tabular-nums" aria-live="polite">
            {pageStart}–{pageEnd} de {list.total}
          </p>
          <div className="flex items-center gap-2">
            <PageSizeSelect value={list.pageSize} onChange={list.changePageSize} />
            <Button variant="secondary" size="icon" onClick={() => goToPage(list.page - 1)} disabled={list.page <= 1} aria-label="Página anterior">
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </Button>
            <span className="min-w-[4.5rem] text-center text-[13px] font-medium text-ink tabular-nums sm:hidden">{list.page} de {list.totalPages}</span>
            <span className="hidden items-center gap-1 sm:flex">
              {pageNumbers(list.page, list.totalPages).map((number) => (
                <button
                  key={number}
                  type="button"
                  onClick={() => goToPage(number)}
                  aria-current={number === list.page ? "page" : undefined}
                  aria-label={`Página ${number}`}
                  className={cx(
                    "h-touch min-w-touch rounded-control px-2 text-[13px] font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                    number === list.page ? "bg-navy text-white" : "text-ink hover:bg-navy/[0.06]"
                  )}
                >
                  {number}
                </button>
              ))}
            </span>
            <Button variant="secondary" size="icon" onClick={() => goToPage(list.page + 1)} disabled={list.page >= list.totalPages} aria-label="Próxima página">
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      ) : null}

      <FiltersSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} list={list} canManage={canManageResponsibleUsers} />

      <ClientSheet
        client={openClient}
        list={list}
        open={Boolean(openClient)}
        onClose={() => { setOpenClientId(""); setOpenFocus(""); }}
        focus={openFocus}
        canManage={canManageResponsibleUsers}
        canReturnAssignedProspecting={canReturnAssignedProspecting}
        isOwner={isOwner}
        responsibleName={openClient ? responsibleNameOf(openClient) : ""}
      />

      {confirmElement}
      {toastElement}
    </section>
  );
}

// Padrão único dos atalhos (Chat, Agenda, Clientes que esfriaram, Notificações): components/ui/shortcut-icon.js.
const SHORTCUT = SHORTCUT_ICON_BUTTON;

// Funil da carteira: cada etapa mostra quantos clientes estão nela e uma
// barra proporcional — a lista inteira vira um mapa do funil.
function PipelineStrip({ list }) {
  const { filters, counters } = list;
  const groups = CLIENT_STATUS_FILTER_GROUPS;
  const funnel = groups.filter((group) => !["all", "archived"].includes(group.key));
  const max = Math.max(1, ...funnel.map((group) => counters.byGroup?.[group.key] || 0));
  const activeGroup = groups.find((group) => group.key === filters.statusGroup);

  const select = (key) => list.updateFilters({ statusGroup: key, status: "all", pendingOnly: false, needsFirstContact: false });
  const renderFunnelTab = (group) => (
    <StageTab
      key={group.key}
      label={group.label}
      count={counters.byGroup?.[group.key] || 0}
      ratio={(counters.byGroup?.[group.key] || 0) / max}
      active={filters.statusGroup === group.key}
      onClick={() => select(group.key)}
    />
  );

  // Celular: ao selecionar uma etapa, rola a faixa só o necessário para ela
  // ficar inteira à vista (se já está visível, não mexe).
  const tabsRef = useRef(null);
  useEffect(() => {
    const scroller = tabsRef.current;
    const tab = scroller?.querySelector('[aria-selected="true"]');
    if (!scroller || !tab) return;
    const box = scroller.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();
    let delta = 0;
    if (rect.left < box.left) delta = rect.left - box.left;
    else if (rect.right > box.right) delta = rect.right - box.right;
    if (Math.abs(delta) > 1) scroller.scrollBy({ left: delta, behavior: "smooth" });
  }, [filters.statusGroup]);

  return (
    <div className="mt-0 overflow-hidden rounded-card border border-line bg-white sm:mt-4">
      <div ref={tabsRef} className="flex snap-x snap-mandatory items-stretch overflow-x-auto [scrollbar-width:none] sm:snap-none [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Etapas do funil">
        <StageTab label="Todos" count={counters.byGroup?.all ?? counters.all ?? 0} active={filters.statusGroup === "all"} onClick={() => select("all")} />
        {/* Ordem pedida pelo dono (2026-10-09): Patrocinado logo depois de Todos (onde ficava Prospecção); Prospecção vai para o fim da fila. */}
        <StageTab label="Patrocinado" count={counters.byGroup?.sponsored || 0} active={filters.statusGroup === "sponsored"} onClick={() => select("sponsored")} />
        {funnel.filter((group) => group.key !== "prospecting").map(renderFunnelTab)}
        <StageTab label="Arquivados" count={counters.byGroup?.archived || 0} active={filters.statusGroup === "archived"} onClick={() => select("archived")} muted />
        {funnel.filter((group) => group.key === "prospecting").map(renderFunnelTab)}
      </div>

      {filters.statusGroup === "sponsored" && counters.sponsoredCost ? (
        <div className="grid grid-cols-3 gap-2 border-t border-line px-3 py-2.5 text-center sm:flex sm:flex-wrap sm:items-center sm:justify-start sm:gap-x-6" aria-label="Custo estimado do patrocinado nesta visão">
          <p className="text-[13px] text-ink-2"><span className="block text-base font-bold tabular-nums text-ink sm:inline">{formatMoneyBR(counters.sponsoredCost.total)}</span> <span className="block sm:inline">investidos nesta visão</span></p>
          <p className="text-[13px] text-ink-2"><span className="block text-base font-bold tabular-nums text-ink sm:inline">{formatMoneyBR(counters.sponsoredCost.average)}</span> <span className="block sm:inline">por cliente</span></p>
          <p className="text-[13px] text-ink-2"><span className="block text-base font-bold tabular-nums text-ink sm:inline">{counters.sponsoredCost.withCost}/{counters.sponsoredCost.clients}</span> <span className="block sm:inline">com custo identificado</span></p>
        </div>
      ) : null}

      {activeGroup && activeGroup.key !== "all" && activeGroup.statuses.length > 1 ? (
        <div className="flex gap-1.5 overflow-x-auto border-t border-line px-3 py-2.5" aria-label={`Status dentro de ${activeGroup.label}`}>
          {activeGroup.statuses.filter((status) => status !== CLIENT_STATUS.SIMULATION_SENT).map((status) => {
            const active = filters.status === status;
            return (
              <button
                key={status}
                type="button"
                aria-pressed={active}
                onClick={() => list.updateFilters({ status: active ? "all" : status })}
                className={cx(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
                  active ? "border-navy bg-navy text-white" : "border-line bg-white text-ink hover:border-navy/25"
                )}
              >
                {CLIENT_STATUS_META[status]?.label || status}
                <span className={cx("tabular-nums", active ? "text-white/80" : "text-muted")}>{counters.byStatus?.[status] || 0}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function StageTab({ label, count, ratio = null, active, onClick, muted = false }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cx(
        // Celular: metade da altura (dono, 2026-10-12) — rótulo e número na mesma linha, sem a barrinha. Desktop inalterado.
        "relative flex w-1/3 shrink-0 grow-0 snap-start flex-row flex-wrap items-baseline justify-center gap-x-1.5 px-2 py-1.5 text-center sm:flex-col sm:flex-nowrap sm:items-stretch sm:justify-between sm:text-left sm:pb-3 sm:pt-2.5 sm:w-auto sm:min-w-[6.75rem] sm:flex-1 sm:snap-align-none sm:gap-2 sm:px-3.5 transition-colors duration-150",
        "border-r border-line/70 last:border-r-0 sm:border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
        active ? "bg-info-soft/70 sm:bg-info-soft" : "hover:bg-navy/[0.025]"
      )}
    >
      <span className={cx("text-[11px] font-medium leading-none sm:text-xs", active ? "text-navy" : muted ? "text-muted" : "text-muted sm:text-ink-2")}>{label}</span>
      <span className={cx("text-[15px] font-bold leading-none tracking-[-0.01em] tabular-nums sm:text-xl sm:leading-none", active ? "text-navy" : count ? "text-ink" : "text-faint")}>{count}</span>
      {ratio !== null ? (
        <span className="hidden h-1 w-full overflow-hidden rounded-full bg-navy/[0.06] sm:block" aria-hidden="true">
          <span className={cx("block h-full rounded-full", active ? "bg-brand" : "bg-navy/30")} style={{ width: `${Math.max(count ? 6 : 0, Math.round(ratio * 100))}%` }} />
        </span>
      ) : <span className="hidden h-1 sm:block" aria-hidden="true" />}
      {active ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand" aria-hidden="true" /> : null}
    </button>
  );
}

function FiltersSheet({ open, onClose, list, canManage }) {
  const { filters } = list;
  const ids = { responsible: useId(), tag: useId(), date: useId(), from: useId(), to: useId() };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      side="auto"
      title="Filtros"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={() => list.updateFilters({ responsibleUserId: "all", tagId: "all", staleContactOnly: false, noFutureActivityOnly: false, datePreset: "all", dateFrom: "", dateTo: "" })}>Limpar</Button>
          <Button block onClick={onClose}>Ver {list.total} {list.total === 1 ? "cliente" : "clientes"}</Button>
        </div>
      }
    >
      <div className="space-y-5">
        {canManage ? (
          <div>
            <label htmlFor={ids.responsible} className="text-sm font-medium text-ink">Corretor responsável</label>
            <select id={ids.responsible} className={cx(inputClasses, "mt-1.5")} value={filters.responsibleUserId} onChange={(event) => list.updateFilters({ responsibleUserId: event.target.value })}>
              <option value="all">Todos os corretores</option>
              {list.responsibleProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              <option value="unassigned">Sem corretor</option>
            </select>
          </div>
        ) : null}
        <div>
          {/* Data de cadastro (dono, 2026-10-14): filtra lista, contadores e o "investido" do Patrocinado. */}
          <label htmlFor={ids.date} className="text-sm font-medium text-ink">Data de cadastro</label>
          <select
            id={ids.date}
            className={cx(inputClasses, "mt-1.5")}
            value={filters.datePreset || "all"}
            onChange={(event) => {
              const preset = event.target.value;
              if (preset === "custom") list.updateFilters({ datePreset: "custom" });
              else list.updateFilters({ datePreset: preset, ...datePresetRange(preset) });
            }}
          >
            <option value="all">Todas as datas</option>
            <option value="today">Hoje</option>
            <option value="yesterday">Ontem</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="month">Este mês</option>
            <option value="custom">Personalizado</option>
          </select>
          {filters.datePreset === "custom" ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={ids.from} className="text-xs text-muted">De</label>
                <input id={ids.from} type="date" className={cx(inputClasses, "mt-1")} value={filters.dateFrom} max={filters.dateTo || undefined} onChange={(event) => list.updateFilters({ dateFrom: event.target.value })} />
              </div>
              <div>
                <label htmlFor={ids.to} className="text-xs text-muted">Até</label>
                <input id={ids.to} type="date" className={cx(inputClasses, "mt-1")} value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(event) => list.updateFilters({ dateTo: event.target.value })} />
              </div>
            </div>
          ) : null}
        </div>
        <div>
          <label htmlFor={ids.tag} className="text-sm font-medium text-ink">Tag</label>
          <select id={ids.tag} className={cx(inputClasses, "mt-1.5")} value={filters.tagId} onChange={(event) => list.updateFilters({ tagId: event.target.value })}>
            <option value="all">Todas as tags</option>
            {list.localTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
          </select>
        </div>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-medium text-ink">Situação</legend>
          <Toggle label="Sem contato há +3 dias" checked={filters.staleContactOnly} onChange={(value) => list.updateFilters({ staleContactOnly: value })} />
          <Toggle label="Sem atividade futura" checked={filters.noFutureActivityOnly} onChange={(value) => list.updateFilters({ noFutureActivityOnly: value })} />
        </fieldset>
      </div>
    </Sheet>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex min-h-touch cursor-pointer items-center justify-between gap-3 rounded-control px-1 text-sm text-ink">
      {label}
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span aria-hidden="true" className="relative h-6 w-10 shrink-0 rounded-full bg-neutral-line transition-colors duration-150 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-150 peer-checked:bg-brand peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2" />
    </label>
  );
}

function PageSizeSelect({ value, onChange }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="sr-only">Clientes por página</label>
      <select id={id} value={value} onChange={(event) => onChange(Number(event.target.value))} className="h-touch rounded-control border border-line bg-white px-2 text-[13px] font-medium text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20">
        {PAGE_SIZE_OPTIONS.map((option) => <option key={option} value={option}>{option} por página</option>)}
      </select>
    </>
  );
}

function pageNumbers(current, totalPages) {
  const maxVisible = 5;
  const start = Math.max(1, Math.min(current - 2, totalPages - maxVisible + 1));
  const end = Math.min(totalPages, start + maxVisible - 1);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

// Chips removíveis para todo filtro ativo — inclusive os que chegam por link
// externo (ex.: painel de Desempenho), para nenhum filtro ficar invisível.
function buildChips(filters, list) {
  const chips = [];
  if (filters.responsibleUserId !== "all") {
    const label = filters.responsibleUserId === "unassigned" ? "Sem corretor" : (list.responsibleProfileMap.get(filters.responsibleUserId)?.name || "Corretor selecionado");
    chips.push({ key: "responsibleUserId", label: `Corretor: ${label}`, onRemove: () => list.updateFilters({ responsibleUserId: "all" }) });
  }
  if (filters.tagId !== "all") {
    const label = list.localTags.find((tag) => tag.id === filters.tagId)?.name || "Tag selecionada";
    chips.push({ key: "tagId", label: `Tag: ${label}`, onRemove: () => list.updateFilters({ tagId: "all" }) });
  }
  if (filters.dateFrom || filters.dateTo) {
    chips.push({ key: "date", label: `Cadastro: ${formatDateRangeLabel(filters.dateFrom, filters.dateTo)}`, onRemove: () => list.updateFilters({ datePreset: "all", dateFrom: "", dateTo: "" }) });
  }
  if (filters.staleContactOnly) chips.push({ key: "staleContactOnly", label: "Sem contato há +3 dias", onRemove: () => list.updateFilters({ staleContactOnly: false }) });
  if (filters.noFutureActivityOnly) chips.push({ key: "noFutureActivityOnly", label: "Sem atividade futura", onRemove: () => list.updateFilters({ noFutureActivityOnly: false }) });
  if (filters.needsFirstContact) chips.push({ key: "needsFirstContact", label: "Novos atendimentos", onRemove: () => list.updateFilters({ needsFirstContact: false, status: "all" }) });
  if (filters.pendingOnly) chips.push({ key: "pendingOnly", label: "Pendentes", onRemove: () => list.updateFilters({ pendingOnly: false }) });
  return chips;
}
