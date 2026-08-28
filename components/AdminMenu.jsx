"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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

export default function AdminMenu({ active = "properties", isAdmin = false, isBroker = false }) {
  const [openMenu, setOpenMenu] = useState("");
  const navRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setOpenMenu("");
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpenMenu("");
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (isBroker && !isAdmin) {
    const brokerLinks = [
      { href: "/admin/simulacoes", label: "CLIENTES", key: "simulations", activeKeys: ["registrations"] },
      { href: "/admin/novo", label: "CADASTRAR IMÓVEL", key: "new-property" },
      { href: "/admin/relatorio-diario", label: "RELATÓRIO DIÁRIO", key: "daily-report" }
    ];

    return (
      <nav className="flex flex-wrap gap-3" aria-label="Categorias administrativas">
        {brokerLinks.map((link) => (
          <Link key={link.key} href={link.href} className={buttonClass(isActiveItem(link, active))}>
            {link.label}
          </Link>
        ))}
      </nav>
    );
  }

  const clientActive = ["simulations", "registrations", "calendar"].includes(active);
  const menus = [
    {
      key: "cadastros",
      label: "CADASTROS",
      items: [
        { href: "/admin", label: "Imóveis", key: "properties" },
        { href: "/admin/depoimentos", label: "Depoimentos", key: "testimonials" },
        { href: "/admin/captacoes", label: "Captações", key: "captacoes" }
      ]
    },
    {
      key: "administrativo",
      label: "ADMINISTRATIVO",
      items: [
        { href: "/admin/financeiro", label: "Financeiro", key: "financial" },
        { href: "/admin/relatorio-diario", label: "Relatório Diário", key: "daily-report" },
        { href: "/admin/corretores", label: "Corretores", key: "brokers" }
      ]
    }
  ];

  return (
    <nav ref={navRef} className="flex flex-wrap gap-3" aria-label="Categorias administrativas">
      <Link href="/admin/simulacoes" className={buttonClass(clientActive)}>
        CLIENTES
      </Link>

      {menus.map((menu) => {
        const menuActive = menu.items.some((item) => isActiveItem(item, active));
        const isOpen = openMenu === menu.key;

        return (
          <div key={menu.key} className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              className={buttonClass(menuActive)}
              onClick={() => setOpenMenu(isOpen ? "" : menu.key)}
            >
              {menu.label}
            </button>

            {isOpen ? (
              <div
                role="menu"
                className="absolute left-0 z-50 mt-2 w-max min-w-44 max-w-[calc(100vw-2rem)] rounded-2xl border border-navy/10 bg-white p-2 shadow-[0_18px_45px_rgba(13,46,87,0.14)]"
              >
                {menu.items.map((item) => (
                  <Link
                    key={item.key}
                    href={item.href}
                    role="menuitem"
                    className={`block whitespace-nowrap rounded-xl px-4 py-3 text-sm font-extrabold transition duration-200 ${
                      isActiveItem(item, active)
                        ? "bg-brand text-white"
                        : "text-navy hover:bg-brand/10 hover:text-brand"
                    }`}
                    onClick={() => setOpenMenu("")}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
