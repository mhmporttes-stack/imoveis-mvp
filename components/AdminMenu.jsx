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
    key: "clientes",
    label: "CLIENTES",
    href: "/admin/simulacoes",
    items: [
      ...clientItems.slice(0, 1),
      { href: "/admin", label: "Imóveis", key: "properties" },
      { href: "/admin/depoimentos", label: "Depoimentos", key: "testimonials" },
      { href: "/admin/captacoes", label: "Captações", key: "captacoes" },
      { href: "/admin/corretores", label: "Corretores", key: "brokers" },
      { href: "/admin/prospeccao", label: "Prospecção", key: "prospecting" }
    ]
  },
  {
    key: "agenda",
    label: "AGENDA",
    href: "/admin/calendario",
    items: [clientItems[1]]
  },
  {
    key: "automacoes",
    label: "AUTOMAÇÕES",
    href: "/admin/automacoes",
    items: [{ href: "/admin/automacoes", label: "Regras", key: "automations" }]
  },
  {
    key: "desempenho",
    label: "DESEMPENHO",
    href: "/admin/desempenho",
    items: [
      { href: "/admin/desempenho", label: "Visão geral", key: "performance" },
      { href: "/admin/relatorio-diario", label: "Relatório Diário", key: "daily-report" },
      { href: "/admin/financeiro", label: "Financeiro", key: "financial" },
    ]
  }
];

const brokerGroups = [
  {
    key: "clientes",
    label: "CLIENTES",
    href: "/admin/simulacoes",
    items: [...clientItems, { href: "/admin/prospeccao", label: "Prospecção", key: "prospecting" }]
  },
  {
    key: "agenda",
    label: "AGENDA",
    href: "/admin/calendario",
    items: [clientItems[1]]
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

const managerGroups = [
  {
    key: "desempenho",
    label: "DESEMPENHO",
    href: "/admin/financeiro",
    items: [
      { href: "/admin/financeiro", label: "Financeiro", key: "financial" }
    ]
  }
];

function getGroupKeyForActive(active, groups = adminGroups) {
  return groups.find((group) => group.items.some((item) => isActiveItem(item, active)))?.key || "clientes";
}

export default function AdminMenu({ active = "properties", isAdmin = false, isBroker = false, isAssociate = false, isManager = false }) {
  const groups = isManager ? managerGroups : isBroker && !isAdmin ? (isAssociate ? brokerGroups.slice(0, 3) : brokerGroups) : adminGroups;
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

      {active !== "automations" ? <div className="mx-auto flex w-full flex-wrap justify-center rounded-2xl border border-navy/[0.07] bg-white p-0.5 shadow-[0_1px_2px_rgba(13,59,102,0.04)]" aria-label="Opções da categoria administrativa">
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
      </div> : null}
    </div>
  );
}
