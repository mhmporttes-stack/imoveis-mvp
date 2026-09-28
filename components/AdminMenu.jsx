"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import WhatsappChatNavBadge from "@/components/WhatsappChatNavBadge";
import { useCrmBadgeCounts } from "@/components/useCrmBadgeCounts";
import { MoreHorizontal } from "lucide-react";

const buttonBase =
  "inline-flex min-h-10 flex-1 items-center justify-center rounded-full font-extrabold transition duration-300";

function buttonClass(isActive, compact = false) {
  return `${buttonBase} ${compact ? "min-w-0 px-2 text-[11px] sm:px-5 sm:text-sm" : "min-w-[130px] px-5 text-sm"} ${isActive ? "admin-nav-current" : ""} ${
    isActive
      ? "bg-navy text-white shadow-soft"
      : "border border-navy/15 bg-white text-navy hover:-translate-y-0.5 hover:border-brand hover:shadow-soft"
  }`;
}

function isActiveItem(item, active) {
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
      { href: "/admin/oportunidades", label: "Oportunidades", key: "opportunities" },
      { href: "/admin/empreendimentos", label: "Empreendimentos", key: "developments" },
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
      { href: "/admin/desempenho", label: "Desempenho", key: "performance", activeKeys: ["daily-report", "financial", "scoring"] }
    ]
  }
];

const brokerGroups = [
  {
    key: "crm",
    label: "CRM",
    href: "/admin/simulacoes",
    items: [{ href: "/admin/meta-diaria", label: "Meta Diária", key: "daily-goal" }, clientItems[0], { href: "/admin/chat", label: "Chat", key: "chat", badge: "chat" }, { href: "/admin/oportunidades", label: "Oportunidades", key: "opportunities" }, { href: "/admin/empreendimentos", label: "Empreendimentos", key: "developments" }, clientItems[1], { href: "/admin/prospeccao", label: "Prospecção", key: "prospecting" }]
  },
  {
    key: "cadastros",
    label: "CADASTROS",
    items: [
      { href: "/admin/novo", label: "Cadastrar imóvel", key: "new-property" },
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

// Central de Oportunidades é escopo corretor/gestor/admin (associado fora
// do pedido original) — some do grupo "crm" só pra associado, sem afetar
// corretor/gestor que compartilham o mesmo brokerGroups.
const associateGroups = brokerGroups.map((group) => {
  if (group.key === "desempenho") return { ...group, items: group.items.filter((item) => item.key === "financial"), href: "/admin/financeiro" };
  if (group.key === "crm") return { ...group, items: group.items.filter((item) => item.key !== "opportunities") };
  return group;
});

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
      { href: "/admin/desempenho/online", label: "Online", key: "online" }
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
      { href: "/admin/automacoes", label: "Automações", key: "automations", activeKeys: ["whatsapp-master"] },
      { href: "/admin/guia-atendimento", label: "Guia de Atendimento", key: "attendance-guide" },
      { href: "/admin/minha-jornada", label: "Minha Jornada", key: "client-journey" }
    ]
  }
];

function getGroupKeyForActive(active, groups = adminGroups) {
  return groups.find((group) => group.items.some((item) => isActiveItem(item, active)))?.key || groups[0]?.key || "";
}

export default function AdminMenu({ active = "properties", isAdmin = false, isBroker = false, isAssociate = false, isManager = false }) {
  // Gestor enxerga exatamente o mesmo menu do administrador geral — o que
  // ele nao deve ver (financeiro da imobiliaria, clientes do dono) e barrado
  // nas proprias paginas/consultas, nao escondendo o item de menu.
  const groups = isAdmin ? ownerGroups : isManager ? adminGroups : isBroker ? (isAssociate ? associateGroups : brokerGroups) : adminGroups;
  const [visibleGroup, setVisibleGroup] = useState(() => getGroupKeyForActive(active, groups));
  const menuRef = useRef(null);
  const { total: crmCount } = useCrmBadgeCounts();

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
          { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
        );
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  const visibleItems = useMemo(() => {
    return groups.find((group) => group.key === visibleGroup)?.items || [];
  }, [groups, visibleGroup]);

  return (
    <div className="space-y-2" ref={menuRef}>
      <nav className={`flex w-full justify-center gap-2.5 ${isBroker ? "flex-nowrap" : "flex-wrap"}`} aria-label="Categorias administrativas">
        {groups.map((group) => {
          const groupActive = group.items.some((item) => isActiveItem(item, active));
          const highlighted = groupActive || visibleGroup === group.key;

          if (group.href) {
            if (isBroker && group.key === "crm") {
              return (
                <div key={group.key} className="relative flex min-w-0 flex-1">
                  <Link href={group.href} className={`${buttonClass(highlighted, true)} w-full pr-8`} onClick={() => setVisibleGroup(group.key)}>
                    {group.label}
                  </Link>
                  {crmCount > 0 ? <span className="pointer-events-none absolute -right-2 -top-2 inline-flex min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-black leading-5 text-white" aria-label={`${crmCount} pendências no CRM`}>{crmCount > 99 ? "99+" : crmCount}</span> : null}
                  <details className="absolute right-1 top-1/2 z-20 -translate-y-1/2">
                    <summary className="grid h-8 w-7 cursor-pointer list-none place-items-center rounded-full text-navy [&::-webkit-details-marker]:hidden" aria-label="Outras áreas do CRM" title="Outras áreas do CRM">
                      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </summary>
                    <div className="absolute right-0 top-full mt-2 min-w-44 rounded-2xl border border-line bg-white p-2 shadow-soft">
                      {group.items.filter((item) => ["daily-goal", "opportunities", "developments"].includes(item.key)).map((item) => (
                        <Link key={item.key} href={item.href} className="block rounded-xl px-3 py-2 text-sm font-bold text-navy hover:bg-brand/10" onClick={(event) => { event.currentTarget.closest("details").open = false; setVisibleGroup(group.key); }}>
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  </details>
                </div>
              );
            }
            return (
              <div key={group.key} className="relative flex min-w-0 flex-1">
              <Link
                href={group.href}
                className={`${buttonClass(highlighted, isBroker)} w-full`}
                onClick={() => setVisibleGroup(group.key)}
              >
                {group.label}
              </Link>
              {["clientes", "crm"].includes(group.key) && crmCount > 0 ? <span className="pointer-events-none absolute -right-2 -top-2 inline-flex min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-black leading-5 text-white" aria-label={`${crmCount} pendências no CRM`}>{crmCount > 99 ? "99+" : crmCount}</span> : null}
              </div>
            );
          }

          return (
            <button
              key={group.key}
              type="button"
              className={buttonClass(highlighted, isBroker)}
              onClick={() => setVisibleGroup(group.key)}
            >
              {group.label}
            </button>
          );
        })}
      </nav>

      {(isAdmin && visibleGroup === "clientes") || (isBroker && visibleGroup === "crm") ? null : <div className="mx-auto flex w-full flex-wrap justify-center rounded-2xl border border-navy/[0.07] bg-white p-0.5 shadow-[0_1px_2px_rgba(13,59,102,0.04)]" aria-label="Opções da categoria administrativa">
        {visibleItems.map((item) => (
          <Link
            key={`${visibleGroup}-${item.key}`}
            href={item.href}
            className={`admin-motion-enter min-w-[110px] flex-1 rounded-xl px-4 py-1 text-center text-[13px] font-extrabold transition duration-200 ${
              isActiveItem(item, active)
                ? "admin-nav-current bg-navy text-white shadow-soft"
                : "text-navy hover:bg-brand/10 hover:text-brand"
            }`}
          >
            {item.label}
            {item.badge === "chat" ? <WhatsappChatNavBadge className="ml-1.5" /> : null}
          </Link>
        ))}
      </div>}
    </div>
  );
}
