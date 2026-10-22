"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BarChart3, Calculator, CalendarDays, Clock, Menu, MessageCircle, MessageSquareReply, Target, UserCheck, UserRoundPlus, Users } from "lucide-react";
import { getAdminMenuGroups } from "@/components/AdminMenu";
import { useAcademyMenuEnabled } from "@/components/AcademyMenuContext";
import SceneTransitionLink from "@/components/motion/SceneTransitionLink";
import Sheet from "@/components/ui/Sheet";
import AdminThemeToggle from "@/components/AdminThemeToggle";
import { CountBadge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { navBadgeFor, navIconFor } from "@/components/admin-nav-icons";
import { cx } from "@/components/ui/cx";
import { useCrmBadgeCounts } from "@/components/useCrmBadgeCounts";
import { MarketplaceChatIcon } from "@/components/marketplace/MarketplaceChatShortcut";
import { useMarketplaceUnreadCount } from "@/components/marketplace/MarketplaceNavBadge";
import { useLiveChatHidden } from "@/components/WhatsappAccessProvider";
import { hiddenNavKeys } from "@/lib/whatsapp-access-core.mjs";

// Navegação principal do painel no celular (< md): barra inferior fixa com os
// 4 destinos mais usados do perfil + "Mais" (sheet com TODOS os grupos do
// menu, vindos de getAdminMenuGroups — nada fica inacessível). Do tablet para
// cima é o menu lateral (AdminMenu). Só navegação: permissão real continua
// nos guards de cada página.
//
// Distribuição (decisão do Designer, autorizada pelo dono em 2026-10-01):
// - Administrador geral supervisiona o time: Online (presença da equipe), Clientes,
//   Chat, Desempenho (Meta Diária no "Mais" desde 2026-10-13).
// - Gestor opera a própria carteira e a da equipe: Meta Diária, Clientes, Chat, Agenda.
// - Corretor e associado (dono, 2026-10-19): Simulador Caixa no lugar da Meta Diária;
//   a Meta Diária continua no "Mais" (e no menu do topo).
const DESTINATIONS = {
  dailyGoal: { key: "daily-goal", href: "/admin/meta-diaria", label: "Meta", Icon: Target, match: (path) => path === "/admin/meta-diaria" },
  caixaSimulator: { key: "caixa-simulator", href: "/admin/simulador-caixa", label: "Simulador", Icon: Calculator, match: (path) => path.startsWith("/admin/simulador-caixa") },
  clients: { key: "simulations", href: "/admin/simulacoes", label: "Clientes", Icon: Users, match: (path) => path.startsWith("/admin/simulacoes") },
  chat: { key: "chat", href: "/admin/chat", label: "Chat", Icon: MessageCircle, match: (path) => path.startsWith("/admin/chat") && !path.startsWith("/admin/chat/marketplace") },
  // Chat Marketplace (dono, 2026-10-21: "adicione ele ao lado do chat também"): todos os perfis, logo à direita do Chat.
  // Mesma chave do item do menu (MARKETPLACE_CHAT_ITEM), então some do "Mais". Rótulo curto abaixo de 390px (6 colunas).
  marketplaceChat: { key: "marketplace-chat", href: "/admin/chat/marketplace", label: "Chat Marketplace", shortLabel: "Market", mediumLabel: "Marketplace", Icon: MarketplaceChatIcon, match: (path) => path.startsWith("/admin/chat/marketplace") },
  agenda: { key: "calendar", href: "/admin/calendario", label: "Agenda", Icon: CalendarDays, match: (path) => path.startsWith("/admin/calendario") },
  online: { key: "online", href: "/admin/desempenho/online", label: "Online", Icon: UserCheck, match: (path) => path.startsWith("/admin/desempenho/online") },
  performance: { key: "performance", href: "/admin/desempenho", label: "Desempenho", Icon: BarChart3, match: (path) => (path.startsWith("/admin/desempenho") && !path.startsWith("/admin/desempenho/online")) || path.startsWith("/admin/relatorio-diario") }
};

// Administrador geral (dono, 2026-10-13): "Online" no lugar da Meta Diária na barra; a Meta Diária vai para o "Mais".
// Corretor/associado (dono, 2026-10-19): "Simulador Caixa" no lugar da Meta Diária; gestor mantém a Meta.
function destinationsFor({ isAdmin, isManager }) {
  if (isAdmin) return [DESTINATIONS.online, DESTINATIONS.clients, DESTINATIONS.chat, DESTINATIONS.marketplaceChat, DESTINATIONS.performance];
  if (isManager) return [DESTINATIONS.dailyGoal, DESTINATIONS.clients, DESTINATIONS.chat, DESTINATIONS.marketplaceChat, DESTINATIONS.agenda];
  return [DESTINATIONS.caixaSimulator, DESTINATIONS.clients, DESTINATIONS.chat, DESTINATIONS.marketplaceChat, DESTINATIONS.agenda];
}

// Contador de cada destino: fonte única em components/admin-nav-icons.js (o mesmo do menu lateral).
const badgeFor = navBadgeFor;

// Ícones da barra (dono, 2026-10-21: "diminua o tamanho dos ícones no app"): 20px, para caber o Chat Marketplace como
// 6ª coluna em 360px. Visual novo (dono, 2026-10-22): traço fino (1,9), item ativo no azul de destaque, sem pílula de
// fundo. A área de toque continua a coluna inteira (56px de altura).
const NAV_PILL = "relative flex h-6 w-10 items-center justify-center";
const NAV_ICON = "h-5 w-5";

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  if (target.tagName !== "INPUT") return false;
  return !["button", "checkbox", "radio", "submit", "reset", "range", "file", "color"].includes(target.type);
}

// `currentPath` só existe para a vitrine de desenvolvimento simular a rota;
// no painel o caminho vem do roteador.
export default function AdminBottomNav({ isAdmin = false, isBroker = false, isAssociate = false, isManager = false, whatsappBlocked = false, chatHidden: chatHiddenProp = false, currentPath = "" }) {
  // Valor vivo do modo lista impressa (PRO-15): volta o Chat quando o WhatsApp reconecta, sem fechar o app.
  const chatHidden = useLiveChatHidden(chatHiddenProp);
  const routerPath = usePathname() || "";
  const pathname = currentPath || routerPath;
  const crmCounts = useCrmBadgeCounts();
  // Contador do Chat Marketplace: mesma fonte do menu e do atalho do computador (MKT-2).
  const marketplaceUnread = useMarketplaceUnreadCount();
  const counts = { ...crmCounts, marketplace: marketplaceUnread };
  const [moreOpen, setMoreOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const navRef = useRef(null);
  const resyncRef = useRef(() => {});
  const flags = { isAdmin, isBroker, isAssociate, isManager, whatsappBlocked, chatHidden };
  // Acesso WhatsApp bloqueado (2026-10-04): Chat e Meta Diária do corretor NÃO são renderizados (nada de botão cinza).
  // Modo lista impressa (PRO-15, 2026-10-15): `chatHidden` tira só o Chat.
  const hiddenKeys = hiddenNavKeys({ blocked: whatsappBlocked, chatHidden, isBrokerOrAssociate: (isBroker || isAssociate) && !isManager && !isAdmin });
  const destinations = destinationsFor(flags).filter((item) => !hiddenKeys.has(item.key));
  const activeKey = destinations.find((item) => item.match(pathname))?.key || "";

  // Reserva o espaço da barra no fim da página (ver --admin-bottom-nav-space
  // em app/globals.css) enquanto ela estiver montada.
  useEffect(() => {
    document.documentElement.classList.add("admin-has-bottom-nav");
    return () => document.documentElement.classList.remove("admin-has-bottom-nav");
  }, []);

  // Com o teclado virtual aberto a barra sai do caminho (senão ela sobe junto
  // e cobre o campo/compositor do Chat).
  useEffect(() => {
    const onFocusIn = (event) => setTyping(isEditableTarget(event.target));
    const onFocusOut = () => setTyping(false);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // iPhone (app instalado): depois que o teclado fecha, o iOS às vezes não devolve a janela ao tamanho/posição normais
  // e o que é position: fixed (esta barra) fica "flutuando" no meio da tela até a próxima rolagem (dono, 2026-10-11:
  // "a barra inferior ficou ali pro meio", 3 vezes na tarde). Ao fechar o teclado, a janela mudar de tamanho ou o app
  // voltar ao primeiro plano, força o navegador a recalcular: a rolagem da janela volta para onde deve estar (no Chat o
  // body é fixo, então a janela fica em 0) e a barra é repintada.
  useEffect(() => {
    let timer = 0;
    const resync = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (isEditableTarget(document.activeElement)) return; // teclado aberto: a barra está escondida mesmo
        const root = document.documentElement;
        if (root.classList.contains("chat-app-mode")) {
          if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
        } else {
          window.scrollTo(window.scrollX, window.scrollY);
        }
        const nav = navRef.current;
        if (!nav) return;
        nav.style.transform = "translateZ(0)";
        void nav.offsetHeight;
        nav.style.transform = "";
        // Se mesmo assim o "fixo" do iOS terminar antes do fim real da tela (faixa vazia embaixo da barra — print do
        // dono, 2026-10-11, depois de "Atualizar"), mede a diferença e desce a barra (e, no Chat, a moldura do body)
        // até o fim visível. Autoajustável: quando o iOS se corrige, a diferença volta a 0.
        const rect = nav.getBoundingClientRect();
        if (!rect.height) return; // computador: barra oculta
        const current = parseFloat(root.style.getPropertyValue("--mm-fixed-drop")) || 0;
        const vv = window.visualViewport;
        // App instalado no iPhone (navigator.standalone, só iOS; status bar black-translucent + viewport-fit=cover em
        // app/layout.jsx): a janela é a tela inteira, então o fim real é a altura do aparelho. Necessário no Chat, onde
        // o body é fixo e o iOS reporta innerHeight/visualViewport já encurtados (a barra continuava alta só lá).
        const portrait = window.matchMedia?.("(orientation: portrait)").matches;
        const screenBottom = window.navigator.standalone === true && window.screen
          ? (portrait ? Math.max(window.screen.width, window.screen.height) : Math.min(window.screen.width, window.screen.height))
          : 0;
        const visibleBottom = Math.max(window.innerHeight, vv ? vv.offsetTop + vv.height : 0, screenBottom);
        const next = Math.max(0, Math.round(current + visibleBottom - rect.bottom));
        if (next > 2) root.style.setProperty("--mm-fixed-drop", `${next}px`);
        else root.style.removeProperty("--mm-fixed-drop");
        root.classList.toggle("mm-fixed-drop", next > 2);
      }, 300);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") resync();
    };
    const viewport = window.visualViewport;
    document.addEventListener("focusout", resync);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", resync);
    window.addEventListener("orientationchange", resync);
    viewport?.addEventListener("resize", resync);
    window.addEventListener("scroll", resync, { passive: true });
    resyncRef.current = resync;
    resync();
    return () => {
      window.removeEventListener("scroll", resync);
      document.documentElement.style.removeProperty("--mm-fixed-drop");
      document.documentElement.classList.remove("mm-fixed-drop");
      window.clearTimeout(timer);
      document.removeEventListener("focusout", resync);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", resync);
      window.removeEventListener("orientationchange", resync);
      viewport?.removeEventListener("resize", resync);
    };
  }, []);

  // Marca no <html> que o teclado está aberto: telas em modo aplicativo (Chat) tiram o espaço reservado da barra.
  useEffect(() => {
    document.documentElement.classList.toggle("admin-typing", typing);
    return () => document.documentElement.classList.remove("admin-typing");
  }, [typing]);

  useEffect(() => {
    setMoreOpen(false);
    // Troca de tela (ex.: Clientes → Chat, que fixa o body): mede de novo para a barra ficar igual em todas.
    resyncRef.current();
    const later = window.setTimeout(() => resyncRef.current(), 800);
    return () => window.clearTimeout(later);
  }, [pathname]);

  return (
    <>
      <nav
        ref={navRef}
        aria-label="Navegação principal"
        className={cx(
          // Visual novo (dono, 2026-10-22): fundo translúcido com desfoque (app/admin-theme.css no escuro).
          "admin-bottom-nav fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/[0.94] backdrop-blur-[14px] md:hidden",
          "transition-transform duration-200 ease-out-ui motion-reduce:transition-none",
          typing && "translate-y-full"
        )}
      >
        <ul className="mx-auto grid h-14 max-w-lg" style={{ gridTemplateColumns: `repeat(${destinations.length + 1}, minmax(0, 1fr))` }}>
          {destinations.map((item) => {
            const active = item.key === activeKey;
            const badge = badgeFor(item.key, counts);
            const ItemLink = item.key === "daily-goal" ? SceneTransitionLink : Link;
            return (
              <li key={item.key} className="flex">
                <ItemLink
                  href={item.href}
                  {...(item.key === "daily-goal" ? { direction: "forward" } : {})}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold leading-4 tracking-normal",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                    active ? "text-accent" : "text-muted"
                  )}
                >
                  <span className={cx(NAV_PILL, "transition-colors duration-150", active && "admin-nav-current")}>
                    <item.Icon className={NAV_ICON} strokeWidth={1.9} aria-hidden="true" />
                    <CountBadge count={badge} className="absolute -right-0.5 -top-1.5 !h-4 !min-w-4 !px-1 !text-[10px]" label={`${badge} pendentes em ${item.label}`} />
                  </span>
                  {item.shortLabel ? (
                    <span className="max-w-full truncate">
                      <span className="sr-only">{item.label}</span>
                      <span className="min-[390px]:hidden" aria-hidden="true">{item.shortLabel}</span>
                      <span className="max-[389px]:hidden" aria-hidden="true">{item.mediumLabel}</span>
                    </span>
                  ) : (
                    <span className="max-w-full truncate">{item.label}</span>
                  )}
                </ItemLink>
              </li>
            );
          })}
          <li className="flex">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={cx(
                "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold leading-4 tracking-normal",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                !activeKey || moreOpen ? "text-accent" : "text-muted"
              )}
            >
              <span className={NAV_PILL}>
                <Menu className={NAV_ICON} strokeWidth={1.9} aria-hidden="true" />
              </span>
              <span>Mais</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Mais" side="bottom" compact>
        <MoreMenu flags={flags} counts={counts} pathname={pathname} barKeys={destinations.map((item) => item.key)} />
      </Sheet>
    </>
  );
}

// Ladrilho do menu "Mais" (visual novo, dono, 2026-10-22): grade de 3, ícone em cima e nome embaixo (até 2 linhas),
// contador verde no canto. Altura mínima de 76px (toque folgado).
function MenuTile({ href, label, Icon, current = false, count = 0, fullPage = false }) {
  // fullPage: destino fora de /admin (Academia) — navegação completa com <a>.
  const TileLink = fullPage ? "a" : Link;
  return (
    <TileLink
      href={href}
      aria-current={current ? "page" : undefined}
      className={cx(
        "relative flex h-full min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-[14px] border px-1.5 py-3 text-center text-[11px] font-bold leading-[1.2] text-ink",
        "transition-[background-color,transform] duration-150 ease-out-ui active:scale-[0.97] motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        current ? "border-accent-line bg-accent-soft" : "border-line bg-surface-2 hover:bg-accent-soft"
      )}
    >
      <Icon className="h-[22px] w-[22px] shrink-0 text-accent" strokeWidth={1.9} aria-hidden="true" />
      <span className="max-w-full break-words">{label}</span>
      {/* Badge preso ao canto do próprio item: não disputa largura com o nome. */}
      <CountBadge count={count} label={`${count} ${label}`} className="absolute right-1.5 top-1.5" />
    </TileLink>
  );
}

const SECTION_TITLE = "mb-2 mt-1 px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint";

function MoreMenu({ flags, counts, pathname, barKeys }) {
  const academiaEnabled = useAcademyMenuEnabled();
  const groups = getAdminMenuGroups({ ...flags, academiaEnabled });
  const pending = [
    { label: "Novos atendimentos", count: counts.newAttendances, href: "/admin/simulacoes?needsFirstContact=1", Icon: UserRoundPlus },
    { label: "Aguardando simulação", count: counts.awaitingSimulation, href: "/admin/simulacoes?status=pending", Icon: Clock },
    { label: "Agenda", count: counts.agenda, href: "/admin/calendario?pending=1", Icon: CalendarDays },
    { label: "Chat", count: counts.chat, href: "/admin/chat", Icon: MessageCircle },
    { label: "Respostas da prospecção", count: counts.prospectingReplies, href: "/admin/simulacoes?prospectingReplies=1", Icon: MessageSquareReply }
  ].filter((item) => item.count > 0 && !((flags.whatsappBlocked || flags.chatHidden) && item.label === "Chat"));
  // "Novo cliente" (dono, 2026-10-12: no celular o botão saiu do topo da Lista de clientes): agora é o botão
  // principal do fim da folha, ao lado de "Aparência" — para todo perfil que tem a Lista de clientes.
  const canCreateClient = groups.some((group) => group.items.some((item) => item.key === "simulations"));

  return (
    <div className="space-y-3">
      {pending.length ? (
        <section aria-labelledby="mais-pendencias">
          <h3 id="mais-pendencias" className={SECTION_TITLE}>Pendências</h3>
          <ul className="grid grid-cols-3 gap-2">
            {pending.map(({ label, count, href, Icon }) => (
              <li key={label}>
                <MenuTile href={href} label={label} Icon={Icon} count={count} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {groups.map((group) => {
        const items = group.items.filter((item) => !barKeys.includes(item.key));
        if (!items.length) return null;
        const headingId = `mais-${group.key}`;
        return (
          <section key={group.key} aria-labelledby={headingId}>
            <h3 id={headingId} className={SECTION_TITLE}>
              {group.label.length <= 3 ? group.label : group.label.charAt(0) + group.label.slice(1).toLowerCase()}
            </h3>
            <ul className="grid grid-cols-3 gap-2">
              {items.map((item) => {
                const itemPath = item.href.split("?")[0];
                const current = pathname === itemPath && !item.href.includes("?");
                return (
                  <li key={`${group.key}-${item.key}`}>
                    <MenuTile href={item.href} label={item.label} Icon={navIconFor(item.key)} current={current} count={navBadgeFor(item.key, counts)} fullPage={item.fullPage} />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {/* Modo claro/escuro (dono, 2026-10-16): preferência do aparelho, fora da navegação. */}
      <div className="flex gap-2 pt-2">
        <AdminThemeToggle variant="button" className="flex-1" />
        {canCreateClient ? (
          <Link href="/admin/simulacoes/nova" className={buttonClasses({ variant: "primary", className: "flex-1" })}>
            <UserRoundPlus className="h-[18px] w-[18px]" aria-hidden="true" /> Novo cliente
          </Link>
        ) : null}
      </div>
    </div>
  );
}
