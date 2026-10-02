"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, CalendarDays, CircleDot, Ellipsis, MessageCircle, Target, UserRoundPlus, Users } from "lucide-react";
import { getAdminMenuGroups } from "@/components/AdminMenu";
import SceneTransitionLink from "@/components/motion/SceneTransitionLink";
import Sheet from "@/components/ui/Sheet";
import { CountBadge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { useCrmBadgeCounts } from "@/components/useCrmBadgeCounts";

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
  if (key === "simulations") return (counts.newAttendances || 0) + (counts.awaitingSimulation || 0);
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
export default function AdminBottomNav({ isAdmin = false, isBroker = false, isAssociate = false, isManager = false, currentPath = "" }) {
  const routerPath = usePathname() || "";
  const pathname = currentPath || routerPath;
  const counts = useCrmBadgeCounts();
  const [moreOpen, setMoreOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const flags = { isAdmin, isBroker, isAssociate, isManager };
  const destinations = destinationsFor(flags);
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
        <ul className="mx-auto grid h-16 max-w-lg grid-cols-5">
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

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Menu" side="bottom">
        <MoreMenu flags={flags} counts={counts} pathname={pathname} barKeys={destinations.map((item) => item.key)} />
      </Sheet>
    </>
  );
}

function MoreMenu({ flags, counts, pathname, barKeys }) {
  const groups = getAdminMenuGroups(flags);
  const pending = [
    { label: "Novos atendimentos", count: counts.newAttendances, href: "/admin/simulacoes?needsFirstContact=1", Icon: UserRoundPlus },
    { label: "Aguardando simulação", count: counts.awaitingSimulation, href: "/admin/simulacoes?status=pending", Icon: CircleDot },
    { label: "Agenda", count: counts.agenda, href: "/admin/calendario?pending=1", Icon: CalendarDays },
    { label: "Chat", count: counts.chat, href: "/admin/chat", Icon: MessageCircle }
  ].filter((item) => item.count > 0);

  return (
    <div className="space-y-2">
      {pending.length ? (
        <section aria-labelledby="mais-pendencias">
          <h3 id="mais-pendencias" className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-muted">Pendências</h3>
          <ul className="grid grid-cols-2 gap-x-2">
            {pending.map(({ label, count, href, Icon }) => (
              <li key={label}>
                <Link href={href} className="flex min-h-touch items-center gap-2 rounded-control px-2 text-[13px] font-medium leading-tight text-ink hover:bg-navy/[0.04]">
                  <Icon className="h-[18px] w-[18px] shrink-0 text-brand" aria-hidden="true" />
                  <span className="min-w-0 flex-1">{label}</span>
                  <CountBadge count={count} label={`${count} ${label}`} />
                </Link>
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
          <section key={group.key} aria-labelledby={headingId} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
            <h3 id={headingId} className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-muted">
              {group.label.length <= 3 ? group.label : group.label.charAt(0) + group.label.slice(1).toLowerCase()}
            </h3>
            <ul className="grid grid-cols-2 gap-x-2">
              {items.map((item) => {
                const itemPath = item.href.split("?")[0];
                const current = pathname === itemPath && !item.href.includes("?");
                return (
                  <li key={`${group.key}-${item.key}`}>
                    <Link
                      href={item.href}
                      aria-current={current ? "page" : undefined}
                      className={cx(
                        "flex min-h-touch items-center rounded-control px-2 text-[13px] leading-tight",
                        current ? "bg-info-soft font-semibold text-navy" : "font-medium text-ink hover:bg-navy/[0.04]"
                      )}
                    >
                      {item.label}
                    </Link>
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
