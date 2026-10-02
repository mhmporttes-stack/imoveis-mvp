"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import SceneTransitionLink from "@/components/motion/SceneTransitionLink";
import WhatsappChatNavBadge from "@/components/WhatsappChatNavBadge";
import { useCrmBadgeCounts } from "@/components/useCrmBadgeCounts";
import { CalendarDays, CircleDot, MessageCircle, MessageSquareReply, UserRoundPlus } from "lucide-react";

const buttonBase =
  "inline-flex min-h-10 flex-1 items-center justify-center rounded-full font-extrabold transition duration-300";

function buttonClass(isActive, compact = false) {
  return `${buttonBase} ${compact ? "min-w-0 px-2 text-[11px] sm:px-5 sm:text-sm" : "min-w-[130px] px-5 text-sm"} ${isActive ? "admin-nav-current" : ""} ${
    isActive
      ? "bg-navy text-white shadow-soft"
      : "border border-navy/15 bg-white text-navy hover:-translate-y-0.5 hover:border-brand hover:shadow-soft"
  }`;
}

export function isActiveItem(item, active) {
  return item.key === active || item.activeKeys?.includes(active);
}

const clientItems = [
  { href: "/admin/simulacoes", label: "Lista de clientes", key: "simulations", activeKeys: ["registrations"] },
  { href: "/admin/calendario", label: "Calendário", key: "calendar" }
];

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
      { href: "/admin/desempenho", label: "Desempenho", key: "performance", activeKeys: ["daily-report", "financial", "scoring", "audit"] }
    ]
  }
];

const brokerGroups = [
  {
    key: "crm",
    label: "CRM",
    href: "/admin/simulacoes",
    items: [{ href: "/admin/meta-diaria", label: "Meta Diária", key: "daily-goal" }, clientItems[0], { href: "/admin/chat", label: "Chat", key: "chat", badge: "chat" }, clientItems[1], { href: "/admin/prospeccao", label: "Prospecção", key: "prospecting" }]
  },
  {
    key: "cadastros",
    label: "CADASTROS",
    items: [
      { href: "/admin/novo", label: "Cadastrar imóvel", key: "new-property" },
      { href: "/admin/empreendimentos", label: "Empreendimentos", key: "developments" },
      { href: "/admin/depoimentos/novo", label: "Cadastrar depoimento", key: "new-testimonial", activeKeys: ["testimonials"] }
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
  }
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
const managerGroups = [...brokerGroups, adminGroups.find((group) => group.key === "gestao")];

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
      { href: "/admin/gerador-de-links", label: "Gerador de Links", key: "campaign-links" }
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
  }
];

// Fonte única dos grupos do menu por perfil — usada também pela barra
// inferior do celular (components/AdminBottomNav.jsx, sheet "Mais"), para
// que nenhum destino exista em um menu e falte no outro.
export function getAdminMenuGroups({ isAdmin = false, isBroker = false, isAssociate = false, isManager = false } = {}) {
  const treatAsBroker = isBroker || isManager;
  return isAdmin ? ownerGroups : isManager ? managerGroups : treatAsBroker ? (isAssociate ? associateGroups : brokerGroups) : adminGroups;
}

function getGroupKeyForActive(active, groups = adminGroups) {
  return groups.find((group) => group.items.some((item) => isActiveItem(item, active)))?.key || groups[0]?.key || "";
}

function CrmBreakdown({ counts, onClose, alignLeft = false }) {
  const items = [
    { label: "Chat", count: counts.chat, href: "/admin/chat", Icon: MessageCircle },
    { label: "Agenda", count: counts.agenda, href: "/admin/calendario?pending=1", Icon: CalendarDays },
    { label: "Novos atendimentos", count: counts.newAttendances, href: "/admin/simulacoes?needsFirstContact=1", Icon: UserRoundPlus },
    { label: "Aguardando simulação", count: counts.awaitingSimulation, href: "/admin/simulacoes?status=pending", Icon: CircleDot },
    { label: "Respostas da prospecção", count: counts.prospectingReplies, href: "/admin/simulacoes?prospectingReplies=1", Icon: MessageSquareReply }
  ].filter((item) => item.count > 0);

  return (
    <div className={`absolute top-full z-50 mt-2 w-[min(20rem,calc(100vw-2.5rem))] rounded-2xl border border-brand/15 bg-white p-3 text-left shadow-soft ${alignLeft ? "left-0" : "left-1/2 -translate-x-1/2"}`}>
      <p className="px-2 text-xs font-black uppercase tracking-widest text-brand">Pendências</p>
      <p className="px-2 pb-2 text-sm font-semibold text-slate">{counts.total} no total</p>
      {items.map(({ label, count, href, Icon }) => (
        <Link key={label} href={href} onClick={onClose} className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-sm font-bold text-navy hover:bg-brand/5">
          <Icon size={18} className="shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 flex-1">{label}</span>
          <span className="inline-flex min-w-5 justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-black leading-5 text-white">{count}</span>
        </Link>
      ))}
      <Link href="/admin/simulacoes" onClick={onClose} className="mt-1 block border-t border-line px-2 pt-2 text-xs font-bold text-brand">Ver clientes</Link>
    </div>
  );
}

export default function AdminMenu({ active = "properties", isAdmin = false, isBroker = false, isAssociate = false, isManager = false }) {
  const pathname = usePathname();
  // Gestor enxerga o mesmo padrão de menu do corretor (pedido do dono,
  // 2026-09-29): CRM/CADASTROS/DESEMPENHO, CRM colapsado num único pill com
  // selo — MAIS o pill de GESTÃO (managerGroups), que tinha sumido nessa
  // mudança e é como ela acessa/gerencia a própria equipe (corrigido em
  // 2026-09-29). A checagem de permissão/escopo real continua nas próprias
  // páginas — isso aqui é só o menu.
  const treatAsBroker = isBroker || isManager;
  const groups = getAdminMenuGroups({ isAdmin, isBroker, isAssociate, isManager });
  const [visibleGroup, setVisibleGroup] = useState(() => getGroupKeyForActive(active, groups));
  const menuRef = useRef(null);
  const crmCounts = useCrmBadgeCounts();
  const crmCount = crmCounts.total;
  const [showCrmDetails, setShowCrmDetails] = useState(false);
  const crmPopoverRef = useRef(null);
  const onMainGroupClick = (event, group) => {
    setVisibleGroup(group.key);
    if (!["clientes", "crm"].includes(group.key)) return;
    if (pathname === group.href && crmCount > 0) {
      event.preventDefault();
      setShowCrmDetails((open) => !open);
    } else {
      setShowCrmDetails(false);
    }
  };

  useEffect(() => {
    if (!showCrmDetails) return;
    const closeOutside = (event) => { if (!crmPopoverRef.current?.contains(event.target)) setShowCrmDetails(false); };
    const closeEscape = (event) => { if (event.key === "Escape") setShowCrmDetails(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [showCrmDetails]);

  useEffect(() => {
    setVisibleGroup(getGroupKeyForActive(active, groups));
  }, [active, groups]);

  // A navegação pode reutilizar o mesmo nó da página; a animação CSS de entrada
  // não reinicia nesse caso. Animar os irmãos após o menu a cada troca de rota.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const frame = requestAnimationFrame(() => {
      const sectionNav = menuRef.current?.parentElement;
      if (sectionNav?.parentElement?.tagName !== "MAIN") return;
      for (let node = sectionNav.nextElementSibling; node; node = node.nextElementSibling) {
        node.animate?.(
          [{ opacity: 0.2, transform: "translateY(20px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 800, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
        );
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  const visibleItems = useMemo(() => {
    return groups.find((group) => group.key === visibleGroup)?.items || [];
  }, [groups, visibleGroup]);

  return (
    // No celular (< md) a navegação é a barra inferior fixa
    // (AdminBottomNav, renderizada em app/admin/layout.jsx) — este menu só
    // aparece do tablet para cima. Mesmos grupos (getAdminMenuGroups).
    <div className="hidden space-y-2 md:block" ref={menuRef}>
      {/* Gestor tem 4 pills (CRM/CADASTROS/DESEMPENHO/GESTÃO) contra 3 do
          corretor — sem quebra de linha eles ficariam espremidos/cortados
          no celular, por isso só o corretor puro fica flex-nowrap. */}
      <nav className={`flex w-full justify-center gap-2.5 ${treatAsBroker && !isManager ? "flex-nowrap" : "flex-wrap"}`} aria-label="Categorias administrativas">
        {groups.map((group) => {
          const groupActive = group.items.some((item) => isActiveItem(item, active));
          const highlighted = groupActive || visibleGroup === group.key;

          if (group.href) {
            if (treatAsBroker && group.key === "crm") {
              return (
                <div key={group.key} ref={crmPopoverRef} className="relative flex min-w-0 flex-1">
                  <Link href={group.href} className={`${buttonClass(highlighted, true)} w-full`} aria-expanded={crmCount > 0 ? showCrmDetails : undefined} onClick={(event) => onMainGroupClick(event, group)}>
                    {group.label}
                  </Link>
                  {crmCount > 0 ? <span className="pointer-events-none absolute -right-2 -top-2 inline-flex min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-black leading-5 text-white" aria-label={`${crmCount} pendências no CRM`}>{crmCount > 99 ? "99+" : crmCount}</span> : null}
                  {showCrmDetails && crmCount > 0 ? <CrmBreakdown counts={crmCounts} onClose={() => setShowCrmDetails(false)} alignLeft /> : null}
                </div>
              );
            }
            return (
              <div key={group.key} ref={["clientes", "crm"].includes(group.key) ? crmPopoverRef : null} className="relative flex min-w-[130px] flex-1">
              <Link
                href={group.href}
                className={`${buttonClass(highlighted, treatAsBroker)} w-full`}
                aria-expanded={["clientes", "crm"].includes(group.key) && crmCount > 0 ? showCrmDetails : undefined}
                onClick={(event) => onMainGroupClick(event, group)}
              >
                {group.label}
              </Link>
              {["clientes", "crm"].includes(group.key) && crmCount > 0 ? <span className="pointer-events-none absolute -right-2 -top-2 inline-flex min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-black leading-5 text-white" aria-label={`${crmCount} pendências no CRM`}>{crmCount > 99 ? "99+" : crmCount}</span> : null}
              {["clientes", "crm"].includes(group.key) && showCrmDetails && crmCount > 0 ? <CrmBreakdown counts={crmCounts} onClose={() => setShowCrmDetails(false)} alignLeft={!isAdmin} /> : null}
              </div>
            );
          }

          return (
            <button
              key={group.key}
              type="button"
              className={buttonClass(highlighted, treatAsBroker)}
              onClick={() => setVisibleGroup(group.key)}
            >
              {group.label}
            </button>
          );
        })}
      </nav>

      {(isAdmin && visibleGroup === "clientes") || (treatAsBroker && visibleGroup === "crm") ? null : <div className="mx-auto flex w-full flex-wrap justify-center rounded-2xl border border-navy/[0.07] bg-white p-0.5 shadow-[0_1px_2px_rgba(13,59,102,0.04)]" aria-label="Opções da categoria administrativa">
        {visibleItems.map((item) => {
          // Meta Diária ganha a coreografia de cenas (SceneTransitionLink)
          // ao entrar/sair dela; os demais itens continuam com o Link normal.
          const ItemLink = item.key === "daily-goal" ? SceneTransitionLink : Link;
          return (
            <ItemLink
              key={`${visibleGroup}-${item.key}`}
              href={item.href}
              {...(item.key === "daily-goal" ? { direction: "forward" } : {})}
              className={`admin-motion-enter min-w-[110px] flex-1 rounded-xl px-4 py-1 text-center text-[13px] font-extrabold transition duration-200 ${
                isActiveItem(item, active)
                  ? "admin-nav-current bg-navy text-white shadow-soft"
                  : "text-navy hover:bg-brand/10 hover:text-brand"
              }`}
            >
              {item.label}
              {item.badge === "chat" ? <WhatsappChatNavBadge className="ml-1.5" /> : null}
            </ItemLink>
          );
        })}
      </div>}
    </div>
  );
}
