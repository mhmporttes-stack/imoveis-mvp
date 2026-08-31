"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const buttonBase =
  "inline-flex min-h-12 items-center justify-center rounded-full px-6 text-sm font-extrabold transition duration-300";

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
      { href: "/admin/corretores", label: "Corretores", key: "brokers" }
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
    key: "notificacoes",
    label: "NOTIFICAÇÕES",
    href: "/admin/notificacoes",
    items: [
      { href: "/admin/notificacoes", label: "Central", key: "notifications" },
      { href: "/admin/whatsapp-master", label: "WhatsApp Master", key: "whatsapp-master" }
    ]
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
    items: clientItems
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
  }
];

function getGroupKeyForActive(active, groups = adminGroups) {
  return groups.find((group) => group.items.some((item) => isActiveItem(item, active)))?.key || "clientes";
}

export default function AdminMenu({ active = "properties", isAdmin = false, isBroker = false }) {
  const groups = isBroker && !isAdmin ? brokerGroups : adminGroups;
  const [visibleGroup, setVisibleGroup] = useState(() => getGroupKeyForActive(active, groups));

  useEffect(() => {
    setVisibleGroup(getGroupKeyForActive(active, groups));
  }, [active, groups]);

  const visibleItems = useMemo(() => {
    return groups.find((group) => group.key === visibleGroup)?.items || [];
  }, [groups, visibleGroup]);

  return (
    <div className="space-y-3">
      <nav className="flex flex-wrap gap-3" aria-label="Categorias administrativas">
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

      <div className="inline-flex max-w-full flex-wrap rounded-full border border-navy/10 bg-white p-1 shadow-sm" aria-label="Opções da categoria administrativa">
        {visibleItems.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={`rounded-full px-5 py-2 text-sm font-extrabold transition duration-200 ${
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
