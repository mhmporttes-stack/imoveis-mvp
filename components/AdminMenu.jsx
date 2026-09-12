"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const buttonBase =
  "inline-flex min-h-10 min-w-[130px] flex-1 items-center justify-center rounded-full px-5 text-sm font-extrabold transition duration-300";

function buttonClass(isActive) {
  return `${buttonBase} ${
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
      { href: "/admin/simulacoes", label: "Clientes", key: "simulations", activeKeys: ["registrations"] },
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
      { href: "/admin/automacoes", label: "Automações", key: "automations" },
      { href: "/admin/desempenho", label: "Desempenho", key: "performance", activeKeys: ["daily-report", "financial", "scoring"] }
    ]
  }
];

const brokerGroups = [
  {
    key: "crm",
    label: "CRM",
    href: "/admin/simulacoes",
    items: [clientItems[0], { href: "/admin/empreendimentos", label: "Empreendimentos", key: "developments" }, clientItems[1], { href: "/admin/prospeccao", label: "Prospecção", key: "prospecting" }]
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

const associateGroups = brokerGroups.map((group) => group.key === "desempenho"
  ? { ...group, items: group.items.filter((item) => item.key === "financial"), href: "/admin/financeiro" }
  : group);

function getGroupKeyForActive(active, groups = adminGroups) {
  return groups.find((group) => group.items.some((item) => isActiveItem(item, active)))?.key || groups[0]?.key || "";
}

export default function AdminMenu({ active = "properties", isAdmin = false, isBroker = false, isAssociate = false, isManager = false }) {
  // Gestor enxerga exatamente o mesmo menu do administrador geral — o que
  // ele nao deve ver (financeiro da imobiliaria, clientes do dono) e barrado
  // nas proprias paginas/consultas, nao escondendo o item de menu.
  const groups = isManager || isAdmin ? adminGroups : isBroker ? (isAssociate ? associateGroups : brokerGroups) : adminGroups;
  const [visibleGroup, setVisibleGroup] = useState(() => getGroupKeyForActive(active, groups));

  useEffect(() => {
    setVisibleGroup(getGroupKeyForActive(active, groups));
  }, [active, groups]);

  const visibleItems = useMemo(() => {
    return groups.find((group) => group.key === visibleGroup)?.items || [];
  }, [groups, visibleGroup]);

  return (
    <div className="space-y-2">
      <nav className="flex w-full flex-wrap justify-center gap-2.5" aria-label="Categorias administrativas">
        {groups.map((group) => {
          const groupActive = group.items.some((item) => isActiveItem(item, active));
          const highlighted = groupActive || visibleGroup === group.key;

          if (group.href) {
            return (
              <Link
                key={group.key}
                href={group.href}
                className={buttonClass(highlighted)}
                onClick={() => setVisibleGroup(group.key)}
              >
                {group.label}
              </Link>
            );
          }

          return (
            <button
              key={group.key}
              type="button"
              className={buttonClass(highlighted)}
              onClick={() => setVisibleGroup(group.key)}
            >
              {group.label}
            </button>
          );
        })}
      </nav>

      <div className="mx-auto flex w-full flex-wrap justify-center rounded-2xl border border-navy/[0.07] bg-white p-0.5 shadow-[0_1px_2px_rgba(13,59,102,0.04)]" aria-label="Opções da categoria administrativa">
        {visibleItems.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={`min-w-[110px] flex-1 rounded-xl px-4 py-1 text-center text-[13px] font-extrabold transition duration-200 ${
              isActiveItem(item, active)
                ? "bg-navy text-white shadow-soft"
                : "text-navy hover:bg-brand/10 hover:text-brand"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
