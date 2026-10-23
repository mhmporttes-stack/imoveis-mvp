"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import SceneTransitionLink from "@/components/motion/SceneTransitionLink";
import Avatar from "@/components/Avatar";
import { useCrmBadgeCounts } from "@/components/useCrmBadgeCounts";
import { useMarketplaceUnreadCount } from "@/components/marketplace/MarketplaceNavBadge";
import { useAcademyMenuEnabled } from "@/components/AcademyMenuContext";
import { useLiveChatHidden } from "@/components/WhatsappAccessProvider";
import { navBadgeFor, navIconFor } from "@/components/admin-nav-icons";
import { CountBadge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { withAcademyMenuGroup } from "@/lib/academy-menu.mjs";
import { hiddenNavKeys } from "@/lib/whatsapp-access-core.mjs";
import { crmPendingItems } from "@/components/crm-pending-items";

export function isActiveItem(item, active) {
  return item.key === active || item.activeKeys?.includes(active);
}

// Chat do Marketplace (MKT-2, dono, 2026-10-20): conversas do Facebook Marketplace, todos os perfis (escopo no servidor).
const MARKETPLACE_CHAT_ITEM = { href: "/admin/chat/marketplace", label: "Chat Marketplace", key: "marketplace-chat", badge: "marketplace" };

const clientItems = [
  { href: "/admin/simulacoes", label: "Lista de clientes", key: "simulations", activeKeys: ["registrations"] },
  { href: "/admin/calendario", label: "Calendário", key: "calendar" }
];

// Início (dono, 2026-10-22 — INI-1): resumo do dia, PRIMEIRO item do menu de todos os perfis (entra em getAdminMenuGroups).
const HOME_ITEM = { href: "/admin/inicio", label: "Início", key: "inicio" };

// Manual do CRM: todos os perfis (a visibilidade do conteúdo é filtrada no servidor).
const manualGroup = {
  key: "ajuda",
  label: "MANUAL",
  href: "/admin/manual",
  items: [{ href: "/admin/manual", label: "Manual", key: "manual" }]
};

const adminGroups = [
  {
    key: "crm",
    label: "CRM",
    href: "/admin/simulacoes",
    items: [
      { href: "/admin/meta-diaria", label: "Meta Diária", key: "daily-goal" },
      { href: "/admin/simulacoes", label: "Clientes", key: "simulations", activeKeys: ["registrations"] },
      { href: "/admin/chat", label: "Chat", key: "chat", badge: "chat" },
      { href: "/admin/calendario", label: "Agenda", key: "calendar" },
      { href: "/admin/prospeccao", label: "Prospecção", key: "prospecting" }
    ]
  },
  {
    key: "cadastros",
    label: "CADASTROS",
    href: "/admin",
    items: [
      { href: "/admin", label: "Imóveis", key: "properties" },
      { href: "/admin/empreendimentos", label: "Empreendimentos", key: "developments" },
      { href: "/admin/captacoes", label: "Captações", key: "captacoes" },
      { href: "/admin/depoimentos", label: "Depoimentos", key: "testimonials" }
    ]
  },
  {
    key: "gestao",
    label: "GESTÃO",
    href: "/admin/corretores",
    items: [
      { href: "/admin/corretores", label: "Corretores", key: "brokers" },
      { href: "/admin?area=gestao", label: "Empreendimentos", key: "management-properties" },
      { href: "/admin/gerador-de-links", label: "Gerador de Links", key: "campaign-links" },
      { href: "/admin/minha-jornada", label: "Minha Jornada", key: "client-journey" },
      { href: "/admin/automacoes", label: "Automações", key: "automations", activeKeys: ["whatsapp-master"] },
      { href: "/admin/guia-atendimento", label: "Guia de Atendimento", key: "attendance-guide" },
      { href: "/admin/meta-diaria/gestao", label: "Meta Diária", key: "daily-goal-admin" },
      { href: "/admin/desempenho", label: "Desempenho", key: "performance", activeKeys: ["daily-report", "financial", "scoring", "audit"] },
      { href: "/admin/desempenho/esfriados", label: "Clientes frios", key: "cooled-clients" }
    ]
  },
  manualGroup
];

const brokerGroups = [
  {
    key: "crm",
    label: "CRM",
    href: "/admin/simulacoes",
    items: [{ href: "/admin/meta-diaria", label: "Meta Diária", key: "daily-goal" }, clientItems[0], { href: "/admin/chat", label: "Chat", key: "chat", badge: "chat" }, MARKETPLACE_CHAT_ITEM, clientItems[1], { href: "/admin/prospeccao", label: "Prospecção", key: "prospecting" }]
  },
  {
    key: "cadastros",
    label: "CADASTROS",
    items: [
      { href: "/admin/novo", label: "Cadastrar imóvel", key: "new-property" },
      { href: "/admin/empreendimentos", label: "Empreendimentos", key: "developments" },
      // Corretor/associado (dono, 2026-10-15): sai "Cadastrar depoimento", entra a consulta de Imóveis (todos, mesmo fora do site).
      { href: "/admin/imoveis", label: "Imóveis", key: "properties-catalog" }
    ]
  },
  {
    key: "desempenho",
    label: "DESEMPENHO",
    href: "/admin/relatorio-diario",
    items: [
      { href: "/admin/relatorio-diario", label: "Relatório Diário", key: "daily-report" },
      { href: "/admin/financeiro", label: "Financeiro", key: "financial" }
    ]
  },
  manualGroup
];

// Associado só vê "Financeiro" dentro de "DESEMPENHO" (sem Relatório
// Diário, que é do corretor) — sem afetar corretor/gestor, que compartilham
// o mesmo brokerGroups.
const associateGroups = brokerGroups.map((group) => {
  if (group.key === "desempenho") return { ...group, items: group.items.filter((item) => item.key === "financial"), href: "/admin/financeiro" };
  return group;
});

// Gestor: mesmo padrão visual compacto do corretor (CRM/CADASTROS/DESEMPENHO,
// pedido do dono em 2026-09-29) MAIS o pill de GESTÃO (reaproveitado de
// adminGroups) — sem ele, o gestor perde o acesso a Corretores, Gerador de
// Links, Automações, Guia de Atendimento e Meta Diária > Gestão, que são dela
// mesma gerenciar a equipe (não do dono). A checagem real de permissão/escopo
// continua nas próprias páginas (requireBrokerManagementPage: admin OU
// gestor, sempre limitado à equipe dela — nunca aos clientes/financeiro do
// dono) — isso aqui é só garantir que o item do menu não suma de novo.
// Gestora mantém "Cadastrar depoimento" (a troca de 2026-10-15 foi só para corretor/associado) e ganha a consulta de Imóveis.
const NEW_TESTIMONIAL_ITEM = { href: "/admin/depoimentos/novo", label: "Cadastrar depoimento", key: "new-testimonial", activeKeys: ["testimonials"] };
const managerGroups = [
  ...brokerGroups
    .filter((group) => group.key !== "ajuda")
    .map((group) => (group.key === "cadastros" ? { ...group, items: [...group.items, NEW_TESTIMONIAL_ITEM] } : group)),
  adminGroups.find((group) => group.key === "gestao"),
  manualGroup
];

// Menu do administrador geral, organizado em torno de supervisionar o time.
// Gestor continua com adminGroups (acima), sem alteração.
const ownerGroups = [
  {
    key: "supervisao",
    label: "SUPERVISÃO",
    href: "/admin/meta-diaria",
    items: [
      { href: "/admin/meta-diaria", label: "Meta Diária", key: "daily-goal" },
      { href: "/admin/desempenho", label: "Desempenho", key: "performance", activeKeys: ["daily-report"] },
      { href: "/admin/desempenho/online", label: "Online", key: "online" },
      { href: "/admin/anuncios", label: "Anúncios", key: "ads" },
      { href: "/admin/desempenho/reentradas", label: "Reentradas", key: "reentries" },
      { href: "/admin/desempenho/esfriados", label: "Clientes frios", key: "cooled-clients" },
      { href: "/admin/desempenho/auditoria", label: "Auditoria", key: "audit" }
    ]
  },
  {
    key: "clientes",
    label: "CLIENTES",
    href: "/admin/simulacoes",
    items: [
      { href: "/admin/simulacoes", label: "Clientes", key: "simulations", activeKeys: ["registrations"] },
      { href: "/admin/chat", label: "Chat", key: "chat", badge: "chat" },
      MARKETPLACE_CHAT_ITEM,
      { href: "/admin/prospeccao", label: "Prospecção", key: "prospecting" },
      { href: "/admin/calendario", label: "Agenda", key: "calendar" }
    ]
  },
  {
    key: "cadastros",
    label: "CADASTROS",
    href: "/admin",
    items: [
      { href: "/admin", label: "Imóveis", key: "properties" },
      { href: "/admin/empreendimentos", label: "Empreendimentos", key: "developments" },
      { href: "/admin?area=gestao", label: "Cadastro de empreendimentos", key: "management-properties" },
      { href: "/admin/captacoes", label: "Captações", key: "captacoes" },
      { href: "/admin/depoimentos", label: "Depoimentos", key: "testimonials" },
      { href: "/admin/corretores", label: "Corretores", key: "brokers" },
      { href: "/admin/gerador-de-links", label: "Gerador de Links", key: "campaign-links" },
      // Publicador do Facebook Marketplace (MKT-1, dono, 2026-10-20): só o admin geral.
      { href: "/admin/marketplace", label: "Marketplace", key: "marketplace" }
    ]
  },
  {
    key: "financeiro",
    label: "FINANCEIRO",
    href: "/admin/financeiro",
    items: [
      { href: "/admin/financeiro", label: "Financeiro", key: "financial" },
      { href: "/admin/gastos-ia", label: "Gastos de IA", key: "ai-usage" }
    ]
  },
  {
    key: "configuracoes",
    label: "CONFIGURAÇÕES",
    items: [
      { href: "/admin/meta-diaria/gestao", label: "Meta Diária", key: "daily-goal-admin" },
      { href: "/admin/desempenho/pontuacao", label: "Pontuação", key: "scoring" },
      { href: "/admin/documentacao/regras", label: "Documentação · Regras da IA", key: "document-rules" },
      { href: "/admin/automacoes", label: "Automações", key: "automations", activeKeys: ["whatsapp-master"] },
      { href: "/admin/guia-atendimento", label: "Guia de Atendimento", key: "attendance-guide" },
      { href: "/admin/minha-jornada", label: "Minha Jornada", key: "client-journey" },
      { href: "/admin/alexa", label: "Alexa", key: "alexa" }
    ]
  },
  manualGroup
];

const CAIXA_SIMULATOR_ITEM = { href: "/admin/simulador-caixa", label: "Simulador Caixa", key: "caixa-simulator" };
const CAIXA_SIMULATOR_GROUPS = new Set(["crm", "clientes"]);

// Fonte única dos grupos do menu por perfil — usada também pela barra
// inferior do celular (components/AdminBottomNav.jsx, sheet "Mais"), para
// que nenhum destino exista em um menu e falte no outro.
export function getAdminMenuGroups({ isAdmin = false, isBroker = false, isAssociate = false, isManager = false, whatsappBlocked = false, chatHidden = false, academiaEnabled = false } = {}) {
  const treatAsBroker = isBroker || isManager;
  const groups = isAdmin ? ownerGroups : isManager ? managerGroups : treatAsBroker ? (isAssociate ? associateGroups : brokerGroups) : adminGroups;
  // Acesso WhatsApp bloqueado (2026-10-04): Chat (e a Meta Diária do corretor) NÃO são renderizados — nada de item cinza.
  // Modo lista impressa (PRO-15, 2026-10-15): `chatHidden` tira só o Chat.
  const hidden = hiddenNavKeys({ blocked: whatsappBlocked, chatHidden, isBrokerOrAssociate: (isBroker || isAssociate) && !isManager && !isAdmin });
  const filtered = hidden.size ? groups.map((group) => ({ ...group, items: group.items.filter((item) => !hidden.has(item.key)) })) : groups;
  // "Simulador Caixa" (dono, 2026-10-19): todos os perfis, no grupo de clientes (CRM / CLIENTES).
  const withSimulator = filtered.map((group) => (CAIXA_SIMULATOR_GROUPS.has(group.key) ? { ...group, items: [...group.items, CAIXA_SIMULATOR_ITEM] } : group));
  // "Início" (dono, 2026-10-22): primeiro item do primeiro grupo, em todos os perfis (menu lateral, barra do celular e "Mais").
  const visible = withSimulator.map((group, index) => (index === 0 ? { ...group, items: [HOME_ITEM, ...group.items] } : group));
  // Chave da Academia desligada (padrão): devolve exatamente os mesmos grupos de sempre.
  return withAcademyMenuGroup(visible, academiaEnabled);
}

// Chave da tela atual a partir do caminho (o menu agora vive no layout e não recebe mais `active` de cada página).
// Mesmos valores que as páginas passavam ao AdminSectionNav — os `activeKeys` dos itens continuam valendo.
const PATH_KEYS = [
  ["/admin/inicio", "inicio"],
  ["/admin/chat/marketplace", "marketplace-chat"],
  ["/admin/chat", "chat"],
  ["/admin/simulacoes", "simulations"],
  ["/admin/cadastros", "registrations"],
  ["/admin/calendario", "calendar"],
  ["/admin/prospeccao", "prospecting"],
  ["/admin/simulador-caixa", "caixa-simulator"],
  ["/admin/meta-diaria/gestao", "daily-goal-admin"],
  ["/admin/meta-diaria", "daily-goal"],
  ["/admin/desempenho/online", "online"],
  ["/admin/desempenho/auditoria", "audit"],
  ["/admin/desempenho/pontuacao", "scoring"],
  ["/admin/desempenho/reentradas", "reentries"],
  ["/admin/desempenho/esfriados", "cooled-clients"],
  ["/admin/desempenho", "performance"],
  ["/admin/relatorio-diario", "daily-report"],
  ["/admin/financeiro", "financial"],
  ["/admin/gastos-ia", "ai-usage"],
  ["/admin/anuncios", "ads"],
  ["/admin/empreendimentos", "developments"],
  ["/admin/imoveis", "properties-catalog"],
  ["/admin/novo", "new-property"],
  ["/admin/captacoes", "captacoes"],
  ["/admin/depoimentos/novo", "new-testimonial"],
  ["/admin/depoimentos", "testimonials"],
  ["/admin/corretores", "brokers"],
  ["/admin/gerador-de-links", "campaign-links"],
  ["/admin/marketplace", "marketplace"],
  ["/admin/documentacao/regras", "document-rules"],
  ["/admin/automacoes", "automations"],
  ["/admin/guia-atendimento", "attendance-guide"],
  ["/admin/minha-jornada", "client-journey"],
  ["/admin/alexa", "alexa"],
  ["/admin/manual", "manual"],
  ["/admin/notificacoes", "notifications"],
  ["/admin/seguranca", "security"]
];

export function activeKeyForPath(pathname = "", search = "") {
  const path = String(pathname || "").replace(/\/+$/, "") || "/";
  if (path === "/admin") return /(^|[?&])area=gestao(&|$)/.test(search || "") ? "management-properties" : "properties";
  const hit = PATH_KEYS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return hit ? hit[1] : "";
}

// Item e grupo do menu da tela atual (título do cabeçalho e destaque do menu lateral).
export function findActiveMenuItem(groups, active) {
  if (!active) return null;
  for (const group of groups) {
    const item = group.items.find((entry) => isActiveItem(entry, active));
    if (item) return { group, item };
  }
  return null;
}

// Lista "Pendências" (o antigo balão do grupo CRM/CLIENTES): agora abre pelo atalho do cabeçalho (AdminTopBar).
export function CrmBreakdown({ counts, onClose, alignLeft = false, hideChat = false, className = "" }) {
  const items = crmPendingItems(counts, { hideChat });

  return (
    <div className={cx("absolute top-full z-50 mt-2 w-[min(20rem,calc(100vw-2.5rem))] rounded-card border border-line bg-white p-3 text-left shadow-float", alignLeft ? "left-0" : "right-0", className)}>
      <p className="px-2 text-2xs font-semibold uppercase tracking-[0.1em] text-faint">Pendências</p>
      <p className="px-2 pb-2 text-sm font-semibold text-ink-2">{counts.total} no total</p>
      {items.map(({ label, count, href, Icon }) => (
        <Link key={label} href={href} onClick={onClose} className="flex min-h-touch items-center gap-3 rounded-control px-2 text-sm font-semibold text-ink hover:bg-accent-soft">
          <Icon size={18} className="shrink-0 text-accent" aria-hidden="true" />
          <span className="min-w-0 flex-1">{label}</span>
          <CountBadge count={count} label={`${count} ${label}`} />
        </Link>
      ))}
      <Link href="/admin/simulacoes" onClick={onClose} className="mt-1 block border-t border-line px-2 pt-2 text-xs font-semibold text-accent-text">Ver clientes</Link>
    </div>
  );
}

// Menu lateral do computador (visual novo, dono, 2026-10-22) — substitui as pílulas do topo a partir de 768px.
// Recolhido em 76px só com ícones; abre (260px, por cima do conteúdo) ao passar o mouse ou ao navegar pelo teclado,
// com o título de cada grupo. Rola sem barra visível. Logo sem fundo no topo; foto e nome de quem está usando embaixo.
// Mesmos grupos/itens de getAdminMenuGroups (fonte única, também da barra inferior do celular). Só navegação:
// a permissão real continua nos guards de cada página. No celular (< md) a navegação é a AdminBottomNav.
// `currentPath` só existe para a vitrine de desenvolvimento simular a rota.
export default function AdminMenu({ isAdmin = false, isBroker = false, isAssociate = false, isManager = false, whatsappBlocked = false, chatHidden: chatHiddenProp = false, user = null, currentPath = "" }) {
  // Valor vivo do modo lista impressa (PRO-15): volta o Chat quando o WhatsApp reconecta, sem recarregar a página.
  const chatHidden = useLiveChatHidden(chatHiddenProp);
  const routerPath = usePathname() || "";
  const pathname = currentPath || routerPath;
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const academiaEnabled = useAcademyMenuEnabled();
  const groups = useMemo(
    () => getAdminMenuGroups({ isAdmin, isBroker, isAssociate, isManager, whatsappBlocked, chatHidden, academiaEnabled }),
    [isAdmin, isBroker, isAssociate, isManager, whatsappBlocked, chatHidden, academiaEnabled]
  );
  const crmCounts = useCrmBadgeCounts();
  const marketplaceUnread = useMarketplaceUnreadCount();
  const counts = { ...crmCounts, marketplace: marketplaceUnread };

  // "?area=gestao" (Cadastro de empreendimentos) só existe na URL: lido a cada troca de tela.
  useEffect(() => {
    setSearch(typeof window === "undefined" ? "" : window.location.search);
    setOpen(false);
  }, [pathname]);

  // Reserva a coluna do menu à esquerda do conteúdo (app/admin-theme.css, a partir de md).
  useEffect(() => {
    document.documentElement.classList.add("admin-has-sidebar");
    return () => document.documentElement.classList.remove("admin-has-sidebar");
  }, []);

  const current = findActiveMenuItem(groups, activeKeyForPath(pathname, search));

  return (
    <div className="mm-app-hide admin-sidebar fixed inset-y-0 left-0 z-[35] hidden w-[var(--mm-shell-sidebar)] md:block">
      <nav
        aria-label="Menu principal"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
        data-open={open ? "true" : "false"}
        className={cx(
          "admin-sidebar-panel absolute inset-y-0 left-0 flex flex-col overflow-hidden border-r border-line pb-3 pt-[calc(env(safe-area-inset-top)+16px)]",
          "transition-[width,box-shadow] duration-200 ease-out-ui motion-reduce:transition-none",
          open ? "w-[260px] shadow-float" : "w-[var(--mm-shell-sidebar)]"
        )}
      >
        <Link href="/admin/simulacoes" className="mx-2.5 mb-3 flex min-h-touch shrink-0 items-center gap-3 rounded-control px-[5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label="Matheus Machado Corretor de Imóveis — Clientes">
          <img src="/assets/matheus-machado-symbol.png" alt="" width={40} height={40} className="h-10 w-10 shrink-0 object-contain" />
          <span className={cx("min-w-0 whitespace-nowrap leading-tight transition-opacity duration-150", open ? "opacity-100" : "opacity-0")}>
            <span className="block text-sm font-extrabold text-ink">Matheus Machado</span>
            <span className="block text-2xs font-medium tracking-normal text-muted">Corretor de Imóveis</span>
          </span>
        </Link>

        <div className="mm-noscroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5">
          {groups.map((group) => (
            <div key={group.key} className="mb-2">
              <p className={cx("h-6 truncate whitespace-nowrap px-3 pt-2 text-[10px] font-semibold uppercase leading-4 tracking-[0.1em] text-faint transition-opacity duration-150", open ? "opacity-100" : "opacity-0")} aria-hidden={!open}>
                {group.label}
              </p>
              <ul>
                {group.items.map((item) => {
                  const isCurrent = current?.item === item;
                  const Icon = navIconFor(item.key);
                  const badge = navBadgeFor(item.key, counts);
                  const ItemLink = item.fullPage ? "a" : item.key === "daily-goal" ? SceneTransitionLink : Link;
                  return (
                    <li key={`${group.key}-${item.key}`}>
                      <ItemLink
                        href={item.href}
                        {...(item.key === "daily-goal" ? { direction: "forward" } : {})}
                        data-henry-target={item.href.split("?")[0]}
                        aria-current={isCurrent ? "page" : undefined}
                        title={item.label}
                        className={cx(
                          "relative mb-0.5 flex min-h-[42px] items-center gap-3 rounded-control border px-[13px] text-sm",
                          "transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                          isCurrent ? "border-accent-line bg-accent-soft font-bold text-ink" : "border-transparent font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
                        )}
                      >
                        <span className={cx("relative inline-flex w-6 shrink-0 justify-center", isCurrent ? "text-accent" : "text-muted")}>
                          <Icon className="h-[21px] w-[21px]" strokeWidth={1.8} aria-hidden="true" />
                          {!open && badge ? <span className="mm-count-dot absolute -right-1.5 -top-1" aria-hidden="true" /> : null}
                        </span>
                        <span className={cx("min-w-0 flex-1 truncate whitespace-nowrap transition-opacity duration-150", open ? "opacity-100" : "opacity-0")}>{item.label}</span>
                        {open ? <CountBadge count={badge} label={`${badge} em ${item.label}`} /> : badge ? <span className="sr-only">{`${badge} em ${item.label}`}</span> : null}
                      </ItemLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {user ? (
          <div className="mx-2.5 mt-2 flex shrink-0 items-center gap-2.5 overflow-hidden whitespace-nowrap border-t border-line px-[5px] pt-3">
            <Avatar name={user.name} photoUrl={user.photoUrl} size={40} className="!border-2 !border-accent" />
            <span className={cx("min-w-0 leading-tight transition-opacity duration-150", open ? "opacity-100" : "opacity-0")}>
              <span className="block truncate text-[13px] font-extrabold text-ink">{user.name}</span>
              <span className="block text-2xs font-medium tracking-normal text-muted">{user.roleLabel}</span>
            </span>
          </div>
        ) : null}
      </nav>
    </div>
  );
}
