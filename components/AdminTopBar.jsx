"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Eye, ListTodo, MessageCircle, Search } from "lucide-react";
import AdminThemeToggle from "@/components/AdminThemeToggle";
import { CrmBreakdown, activeKeyForPath, findActiveMenuItem, getAdminMenuGroups } from "@/components/AdminMenu";
import { useAcademyMenuEnabled } from "@/components/AcademyMenuContext";
import { useLiveChatHidden } from "@/components/WhatsappAccessProvider";
import { useCrmBadgeCounts } from "@/components/useCrmBadgeCounts";
import { useMarketplaceUnreadCount } from "@/components/marketplace/MarketplaceNavBadge";
import { MarketplaceChatIcon } from "@/components/marketplace/MarketplaceChatShortcut";
import { CountBadge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { hiddenNavKeys } from "@/lib/whatsapp-access-core.mjs";

// Cabeçalho do painel (visual novo, dono, 2026-10-22): título e subtítulo da tela, busca de clientes, atalhos
// Chat · Chat Marketplace · Agenda com os contadores que já existiam (+ "Pendências", o antigo balão do grupo CRM),
// sol/lua, pílula "Online" e — só para o administrador geral real — "Visualizar como corretor", que abre o seletor de
// "Alterar conta" que já existe (/admin/corretores?tab=account → /api/admin/view-as). A faixa "Voltar para minha
// conta" continua sendo o AdminViewAsBanner. Só apresentação e navegação: permissão real nos guards de cada página.

// Títulos de telas que não estão no menu.
const EXTRA_TITLES = {
  notifications: "Notificações",
  security: "Segurança da conta",
  registrations: "Cadastros"
};

// Subtítulo curto por tela (descrição do que a tela é, sem números nem regras).
const SUBTITLES = {
  simulations: "Seus clientes, do primeiro contato à venda",
  chat: "Conversas do WhatsApp",
  "marketplace-chat": "Conversas do Facebook Marketplace",
  calendar: "Atividades e compromissos",
  "daily-goal": "Novos contatos, 2º contato e pendentes de hoje",
  "daily-goal-admin": "Configuração da Meta Diária",
  online: "Presença no CRM, na imobiliária, aparelho e WhatsApp",
  performance: "Ranking, funil e pontos da equipe",
  "daily-report": "Resumo do dia",
  prospecting: "Base da imobiliária e reativação",
  "caixa-simulator": "Simulação rápida das condições da Caixa",
  financial: "Comissões, recebimentos e despesas",
  "cooled-clients": "Clientes com mais de 3 dias sem contato",
  manual: "Como usar cada tela"
};

function titleCase(label = "") {
  return label.length <= 3 ? label : label.charAt(0) + label.slice(1).toLowerCase();
}

const SHORTCUT = "relative inline-flex h-touch w-touch shrink-0 items-center justify-center rounded-control border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const shortcutTone = (on) => (on ? "border-accent bg-accent-soft text-accent" : "border-line bg-white text-ink hover:border-accent-line hover:bg-accent-soft");
const SHORTCUT_BADGE = "absolute -right-1.5 -top-1.5 ring-2 ring-mist";

export default function AdminTopBar({
  isAdmin = false,
  isBroker = false,
  isAssociate = false,
  isManager = false,
  whatsappBlocked = false,
  chatHidden: chatHiddenProp = false,
  canViewAs = false,
  currentPath = ""
}) {
  const chatHidden = useLiveChatHidden(chatHiddenProp);
  const routerPath = usePathname() || "";
  const pathname = currentPath || routerPath;
  const router = useRouter();
  const academiaEnabled = useAcademyMenuEnabled();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [pendingOpen, setPendingOpen] = useState(false);
  const pendingRef = useRef(null);
  const crmCounts = useCrmBadgeCounts();
  const marketplaceUnread = useMarketplaceUnreadCount();

  useEffect(() => {
    setSearch(typeof window === "undefined" ? "" : window.location.search);
    setPendingOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!pendingOpen) return undefined;
    const closeOutside = (event) => { if (!pendingRef.current?.contains(event.target)) setPendingOpen(false); };
    const closeEscape = (event) => { if (event.key === "Escape") setPendingOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [pendingOpen]);

  const groups = useMemo(
    () => getAdminMenuGroups({ isAdmin, isBroker, isAssociate, isManager, whatsappBlocked, chatHidden, academiaEnabled }),
    [isAdmin, isBroker, isAssociate, isManager, whatsappBlocked, chatHidden, academiaEnabled]
  );
  const active = activeKeyForPath(pathname, search);
  const current = findActiveMenuItem(groups, active);
  const title = current?.item.label || EXTRA_TITLES[active] || "Painel";
  const subtitle = SUBTITLES[active] || (current ? titleCase(current.group.label) : "");
  const crumb = current ? titleCase(current.group.label) : "";

  const hidden = hiddenNavKeys({ blocked: whatsappBlocked, chatHidden, isBrokerOrAssociate: (isBroker || isAssociate) && !isManager && !isAdmin });
  const showChat = !hidden.has("chat");
  const pendingTotal = crmCounts.total - (showChat ? 0 : crmCounts.chat || 0);

  function submitSearch(event) {
    event.preventDefault();
    const value = query.trim();
    router.push(value ? `/admin/simulacoes?query=${encodeURIComponent(value)}` : "/admin/simulacoes");
  }

  return (
    <div className="admin-topbar container-page flex flex-wrap items-center gap-x-3 gap-y-2 pb-1 pt-[calc(env(safe-area-inset-top)+14px)] md:pt-[calc(env(safe-area-inset-top)+20px)]">
      <div className="min-w-0 flex-[1_1_220px]">
        {crumb ? <p className="truncate text-xs text-muted max-md:hidden">{crumb}</p> : null}
        <p className="truncate text-xl font-extrabold leading-tight tracking-[-0.01em] text-ink md:text-2xl">{title}</p>
        {subtitle ? <p className="mt-0.5 truncate text-[13px] text-muted max-sm:hidden">{subtitle}</p> : null}
      </div>

      <form role="search" onSubmit={submitSearch} className="hidden min-h-touch max-w-[380px] flex-[1_1_240px] items-center gap-2 rounded-control border border-line bg-white px-3.5 text-muted focus-within:border-accent lg:flex">
        <Search className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} aria-hidden="true" />
        <label className="sr-only" htmlFor="admin-topbar-search">Buscar cliente</label>
        <input
          id="admin-topbar-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar cliente, telefone ou código"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
        />
      </form>

      <nav aria-label="Atalhos" className="flex items-center gap-2 max-sm:hidden">
        {showChat ? (
          <Link href="/admin/chat" aria-label={`Chat${crmCounts.chat ? ` (${crmCounts.chat} não lidas)` : ""}`} title="Chat" className={cx(SHORTCUT, shortcutTone(active === "chat"))}>
            <MessageCircle className="h-[21px] w-[21px]" strokeWidth={1.9} aria-hidden="true" />
            <CountBadge count={crmCounts.chat} className={SHORTCUT_BADGE} label={`${crmCounts.chat} mensagens não lidas`} />
          </Link>
        ) : null}
        <Link href="/admin/chat/marketplace" aria-label={`Chat Marketplace${marketplaceUnread ? ` (${marketplaceUnread} não lidas)` : ""}`} title="Chat Marketplace" className={cx(SHORTCUT, shortcutTone(active === "marketplace-chat"))}>
          <MarketplaceChatIcon className="h-[21px] w-[21px]" strokeWidth={1.9} />
          <CountBadge count={marketplaceUnread} className={SHORTCUT_BADGE} label={`${marketplaceUnread} mensagens não lidas no Marketplace`} />
        </Link>
        <Link href="/admin/calendario" aria-label={`Agenda${crmCounts.agenda ? ` (${crmCounts.agenda} pendentes)` : ""}`} title="Agenda" className={cx(SHORTCUT, shortcutTone(active === "calendar"))}>
          <CalendarDays className="h-[21px] w-[21px]" strokeWidth={1.9} aria-hidden="true" />
          <CountBadge count={crmCounts.agenda} className={SHORTCUT_BADGE} label={`${crmCounts.agenda} atividades pendentes`} />
        </Link>
        {pendingTotal > 0 ? (
          <div ref={pendingRef} className="relative">
            <button
              type="button"
              onClick={() => setPendingOpen((value) => !value)}
              aria-expanded={pendingOpen}
              aria-label={`Pendências (${pendingTotal})`}
              title="Pendências"
              className={cx(SHORTCUT, shortcutTone(pendingOpen))}
            >
              <ListTodo className="h-[21px] w-[21px]" strokeWidth={1.9} aria-hidden="true" />
              <CountBadge count={pendingTotal} className={SHORTCUT_BADGE} label={`${pendingTotal} pendências no CRM`} />
            </button>
            {pendingOpen ? <CrmBreakdown counts={{ ...crmCounts, total: pendingTotal }} onClose={() => setPendingOpen(false)} hideChat={!showChat} /> : null}
          </div>
        ) : null}
      </nav>

      {canViewAs ? (
        <Link
          href="/admin/corretores?tab=account"
          title="Visualizar como corretor (Alterar conta)"
          aria-label="Visualizar como corretor (Alterar conta)"
          className="inline-flex min-h-touch min-w-touch shrink-0 items-center justify-center gap-2 rounded-control border border-accent bg-accent-soft px-3 text-[13px] font-extrabold text-ink transition-colors hover:bg-accent hover:text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Eye className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
          <span className="max-xl:hidden">Visualizar como corretor</span>
        </Link>
      ) : null}

      <AdminThemeToggle variant="icon" />

      {(() => {
        const pill = (
          <>
            <span className="mm-online-dot h-2 w-2 rounded-full bg-[#1FB37A]" aria-hidden="true" />
            <span className="text-xs font-semibold text-ink-2">Online</span>
          </>
        );
        const cls = "hidden min-h-touch shrink-0 items-center gap-2 rounded-control border border-line bg-white px-3 md:inline-flex";
        return isAdmin || isManager ? (
          <Link href="/admin/desempenho/online" title="Ver quem está on-line" className={cx(cls, "hover:border-accent-line")}>{pill}</Link>
        ) : (
          <span className={cls} title="Você está on-line no CRM">{pill}</span>
        );
      })()}
    </div>
  );
}
