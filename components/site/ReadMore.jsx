"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

// Texto longo da ficha (2026-10-15): mostra o começo e "Ler mais" — o resumo e os botões ficam à vista
// no celular. Texto curto aparece inteiro, sem botão. Mantém as quebras de linha do cadastro.
export default function ReadMore({ text = "", limit = 260, className = "" }) {
  const [open, setOpen] = useState(false);
  const value = String(text || "").trim();
  if (!value) return null;
  const isLong = value.length > limit;

  return (
    <div className={className}>
      <p className={`whitespace-pre-line text-base leading-7 text-ink-2 ${isLong && !open ? "line-clamp-4" : ""}`}>{value}</p>
      {isLong ? (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-extrabold text-brand transition hover:text-navy focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/20"
        >
          {open ? "Ler menos" : "Ler mais"}
          <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
