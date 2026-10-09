"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3, BookOpen, GraduationCap, Building, Building2, CalendarDays, CircleDot, Clock, Ellipsis, FileText, House, HousePlus, Link2,
  MessageCircle, MessageSquarePlus, MessageSquareQuote, MessageSquareReply, Mic, Radar, Route, Search, ShieldCheck, BrainCircuit, Target, Trophy, UserCheck,
  UserRoundPlus, Users, UsersRound, Wallet, Zap
} from "lucide-react";
import { getAdminMenuGroups } from "@/components/AdminMenu";
import { useAcademyMenuEnabled } from "@/components/AcademyMenuContext";
import SceneTransitionLink from "@/components/motion/SceneTransitionLink";
import Sheet from "@/components/ui/Sheet";
import { CountBadge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { useCrmBadgeCounts } from "@/components/useCrmBadgeCounts";
import { hiddenNavKeys } from "@/lib/whatsapp-access-core.mjs";

// Navegação principal do painel no celular (< md): barra inferior fixa com os
// 4 destinos mais usados do perfil + "Mais" (sheet com TODOS os grupos do
// menu, vindos de getAdminMenuGroups — nada fica inacessível). Do tablet para
// cima continua o AdminMenu do topo. Só navegação: permissão real continua
// nos guards de cada página.
//
// Distribuição (decisão do Designer, autorizada pelo dono em 2026-10-01):
// - Administrador geral supervisiona o time: Meta Diária (equipe), Clientes,
//   Chat, Desempenho.
// - Gestor, corretor e associado operam a própria carteira: Meta Diária,
//   Clientes, Chat, Agenda.
const DESTINATIONS = {
  dailyGoal: { key: "daily-goal", href: "/admin/meta-diaria", label: "Meta", Icon: Target, match: (path) => path === "/admin/meta-diaria" },
  clients: { key: "simulations", href: "/admin/simulacoes", label: "Clientes", Icon: Users, match: (path) => path.startsWith("/admin/simulacoes") },
  chat: { key: "chat", href: "/admin/chat", label: "Chat", Icon: MessageCircle, match: (path) => path.startsWith("/admin/chat") },
  agenda: { key: "calendar", href: "/admin/calendario", label: "Agenda", Icon: CalendarDays, match: (path) => path.startsWith("/admin/calendario") },
  performance: { key: "performance", href: "/admin/desempenho", label: "Desempenho", Icon: BarChart3, match: (path) => path.startsWith("/admin/desempenho") || path.startsWith("/admin/relatorio-diario") }
};

function destinationsFor({ isAdmin }) {
  return isAdmin
    ? [DESTINATIONS.dailyGoal, DESTINATIONS.clients, DESTINATIONS.chat, DESTINATIONS.performance]
    : [DESTINATIONS.dailyGoal, DESTINATIONS.clients, DESTINATIONS.chat, DESTINATIONS.agenda];
}

function badgeFor(key, counts) {
  if (key === "chat") return counts.chat || 0;
  if (key === "calendar") return counts.agenda || 0;
  if (key === "simulations") return (counts.newAttendances || 0) + (counts.awaitingSimulation || 0) + (counts.prospectingReplies || 0);
  return 0;
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  if (target.tagName !== "INPUT") return false;
  return !["button", "checkbox", "radio", "submit", "reset", "range", "file", "color"].includes(target.type);
}

// `currentPath` só existe para a vitrine de desenvolvimento simular a rota;
// no painel o caminho vem do roteador.
export default function AdminBottomNav({ isAdmin = false, isBroker = false, isAssociate = false, isManager = false, whatsappBlocked = false, currentPath = "" }) {
  const routerPath = usePathname() || "";
  const pathname = currentPath || routerPath;
  const counts = useCrmBadgeCounts();
  const [moreOpen, setMoreOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const flags = { isAdmin, isBroker, isAssociate, isManager, whatsappBlocked };
  // Acesso WhatsApp bloqueado (2026-10-04): Chat e Meta Diária do corretor NÃO são renderizados (nada de botão cinza).
  const hiddenKeys = hiddenNavKeys({ blocked: whatsappBlocked, isBrokerOrAssociate: (isBroker || isAssociate) && !isManager && !isAdmin });
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

  // Marca no <html> que o teclado está aberto: telas em modo aplicativo (Chat) tiram o espaço reservado da barra.
  useEffect(() => {
    document.documentElement.classList.toggle("admin-typing", typing);
    return () => document.documentElement.classList.remove("admin-typing");
  }, [typing]);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  return (
    <>
      <nav
        aria-label="Navegação principal"
        className={cx(
          "admin-bottom-nav fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-float backdrop-blur md:hidden",
          "transition-transform duration-200 ease-out-ui motion-reduce:transition-none",
          typing && "translate-y-full"
        )}
      >
        <ul className="mx-auto grid h-16 max-w-lg" style={{ gridTemplateColumns: `repeat(${destinations.length + 1}, minmax(0, 1fr))` }}>
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
                    "relative flex flex-1 flex-col items-center justify-center gap-1 text-2xs font-medium tracking-normal",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                    active ? "text-navy" : "text-muted"
                  )}
                >
                  <span className={cx("relative flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-150", active && "bg-info-soft")}>
                    <item.Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
                    <CountBadge count={badge} className="absolute -right-0.5 -top-1.5 ring-2 ring-white" label={`${badge} pendentes em ${item.label}`} />
                  </span>
                  <span className={active ? "font-semibold" : undefined}>{item.label}</span>
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
                "flex flex-1 flex-col items-center justify-center gap-1 text-2xs font-medium tracking-normal",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                !activeKey ? "text-navy" : "text-muted"
              )}
            >
              <span className={cx("flex h-7 w-12 items-center justify-center rounded-full", !activeKey && "bg-info-soft")}>
                <Ellipsis className="h-[22px] w-[22px]" aria-hidden="true" />
              </span>
              <span className={!activeKey ? "font-semibold" : undefined}>Mais</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Menu" side="bottom" compact>
        <MoreMenu flags={flags} counts={counts} pathname={pathname} barKeys={destinations.map((item) => item.key)} />
      </Sheet>
    </>
  );
}

// Ícone de cada destino do menu "Mais", por chave de `getAdminMenuGroups`.
// Só apresentação — destinos, ordem e permissões vêm do próprio menu.
const ITEM_ICONS = {
  "daily-goal": Target,
  "daily-goal-admin": Target,
  simulations: Users,
  chat: MessageCircle,
  calendar: CalendarDays,
  prospecting: Search,
  properties: House,
  "new-property": HousePlus,
  developments: Building2,
  "management-properties": Building,
  captacoes: Radar,
  testimonials: MessageSquareQuote,
  "new-testimonial": MessageSquarePlus,
  brokers: UsersRound,
  "campaign-links": Link2,
  "client-journey": Route,
  automations: Zap,
  "attendance-guide": BookOpen,
  manual: BookOpen,
  performance: BarChart3,
  "daily-report": FileText,
  financial: Wallet,
  online: UserCheck,
  audit: ShieldCheck,
  "ai-usage": BrainCircuit,
  scoring: Trophy,
  "document-rules": FileText,
  alexa: Mic,
  academy: GraduationCap
};

// Mesma unidade visual para todo item do menu: ícone em ladrilho + nome (até
// 2 linhas) + badge quando existir. Altura mínima de 44px (toque).
function MenuTile({ href, label, Icon, current = false, count = 0, fullPage = false }) {
  // fullPage: destino fora de /admin (Academia) — navegação completa com <a>.
  const TileLink = fullPage ? "a" : Link;
  return (
    <TileLink
      href={href}
      aria-current={current ? "page" : undefined}
      className={cx(
        "relative flex h-full min-h-touch items-center gap-1.5 rounded-control border px-1.5 py-1.5 text-[12px] leading-[1.15] min-[375px]:gap-2 min-[375px]:px-2.5 min-[375px]:text-[13px] transition-[background-color,transform] duration-150 ease-out-ui active:scale-[0.97] motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        current ? "border-info-line bg-info-soft font-semibold text-navy" : "border-navy/[0.06] bg-mist/70 font-medium text-ink hover:bg-info-soft/60"
      )}
    >
      <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-md", current ? "bg-brand text-white" : "bg-white text-brand ring-1 ring-navy/[0.06]")}>
        <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 break-words">{label}</span>
      {/* Badge preso ao canto do próprio item: não disputa largura com o nome. */}
      <CountBadge count={count} label={`${count} ${label}`} className="absolute -right-1 -top-1.5 ring-2 ring-white" />
    </TileLink>
  );
}

const SECTION_TITLE = "mb-1.5 px-0.5 text-2xs font-semibold uppercase tracking-[0.08em] text-muted";

function MoreMenu({ flags, counts, pathname, barKeys }) {
  const academiaEnabled = useAcademyMenuEnabled();
  const groups = getAdminMenuGroups({ ...flags, academiaEnabled });
  const pending = [
    { label: "Novos atendimentos", count: counts.newAttendances, href: "/admin/simulacoes?needsFirstContact=1", Icon: UserRoundPlus },
    { label: "Aguardando simulação", count: counts.awaitingSimulation, href: "/admin/simulacoes?status=pending", Icon: Clock },
    { label: "Agenda", count: counts.agenda, href: "/admin/calendario?pending=1", Icon: CalendarDays },
    { label: "Chat", count: counts.chat, href: "/admin/chat", Icon: MessageCircle },
    { label: "Respostas da prospecção", count: counts.prospectingReplies, href: "/admin/simulacoes?prospectingReplies=1", Icon: MessageSquareReply }
  ].filter((item) => item.count > 0 && !(flags.whatsappBlocked && item.label === "Chat"));

  return (
    <div className="space-y-3.5">
      {pending.length ? (
        <section aria-labelledby="mais-pendencias">
          <h3 id="mais-pendencias" className={SECTION_TITLE}>Pendências</h3>
          <ul className="grid grid-cols-2 gap-1.5">
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
            <ul className="grid grid-cols-2 gap-1.5">
              {items.map((item) => {
                const itemPath = item.href.split("?")[0];
                const current = pathname === itemPath && !item.href.includes("?");
                return (
                  <li key={`${group.key}-${item.key}`}>
                    <MenuTile href={item.href} label={item.label} Icon={ITEM_ICONS[item.key] || CircleDot} current={current} fullPage={item.fullPage} />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
