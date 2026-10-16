"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { formatBrazilianPhone } from "@/lib/phone-utils";

// Telefone do cliente nos cards do fluxo de clientes que esfriaram (REGRA OFICIAL — dono, 2026-10-16, FUN-15d):
// número formatado e fácil de copiar, para o corretor achar a conversa no celular. O número só chega aqui quando o
// servidor já liberou o cliente para quem está vendo (mesmo escopo do card); sem número, não mostra nada.
export default function CooledClientPhone({ phone, className = "" }) {
  const [copied, setCopied] = useState(false);
  const formatted = formatBrazilianPhone(phone) || String(phone || "").trim();
  if (!formatted) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} data-cooled-phone="true">
      <span className="select-all font-semibold tabular-nums text-ink">{formatted}</span>
      <button type="button" onClick={copy} className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-semibold text-brand hover:bg-info-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" aria-label={`Copiar telefone ${formatted}`}>
        <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {copied ? "Copiado" : "Copiar"}
      </button>
    </span>
  );
}
