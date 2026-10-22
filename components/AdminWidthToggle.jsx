"use client";

import { useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { cx } from "@/components/ui/cx";
import { ADMIN_WIDE_CLASS, ADMIN_WIDE_EVENT, readStoredAdminWide, setAdminWide } from "@/components/admin-theme";

// Largura do conteúdo do painel (dono, 2026-10-22): padrão (limite de 1360px) ou até as bordas da tela.
// Só no computador; no celular o conteúdo já ocupa a tela toda. Preferência por aparelho (components/admin-theme.js).
export default function AdminWidthToggle({ className = "" }) {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const stored = readStoredAdminWide();
    setWide(stored);
    document.documentElement.classList.toggle(ADMIN_WIDE_CLASS, stored);
    const onChange = (event) => setWide(Boolean(event.detail));
    window.addEventListener(ADMIN_WIDE_EVENT, onChange);
    return () => window.removeEventListener(ADMIN_WIDE_EVENT, onChange);
  }, []);
  const Icon = wide ? Minimize2 : Maximize2;
  const label = wide ? "Largura padrão" : "Expandir para a tela toda";
  return (
    <button
      type="button"
      onClick={() => setAdminWide(!wide)}
      aria-label={label}
      aria-pressed={wide}
      title={label}
      className={cx(
        "hidden h-touch w-touch shrink-0 items-center justify-center rounded-control border border-line bg-white text-ink transition-colors hover:border-accent-line hover:bg-accent-soft md:inline-flex",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className
      )}
    >
      <Icon className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
    </button>
  );
}
