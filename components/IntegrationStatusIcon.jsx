"use client";

import { useEffect, useRef, useState } from "react";
import { Contact } from "lucide-react";
import { cx } from "@/components/ui/cx";

// Indicador COMPACTO (só ícone) do status das integrações individuais do
// corretor — WhatsApp (Baileys) e Google Contacts. Somente apresentação:
// quem decide o estado continua sendo cada integração (status vindo das
// APIs); aqui só se traduz o estado real em cor.
//
//   verde  = conectado
//   laranja = estado intermediário REAL (WhatsApp: conectando / reconectando /
//             aguardando QR ou código; Google: requer reconexão)
//   cinza  = desconectado / nunca conectou / erro
//
// Desktop: tooltip no hover/foco. Celular: toque revela o texto do status
// (ou, quando há `onClick`, abre o que o botão já abria — o modal da
// integração mostra o status por extenso).

export const INTEGRATION_TONE_CLASS = {
  connected: "border-success-line bg-success-soft text-success",
  partial: "border-orange-200 bg-orange-50 text-orange-600",
  off: "border-line bg-neutral-soft text-muted"
};

const WHATSAPP_PARTIAL = new Set(["connecting", "reconnecting", "qr_required", "pairing_code_required"]);
const GOOGLE_PARTIAL = new Set(["error", "expired"]);

export function whatsappTone(status) {
  if (status === "connected") return "connected";
  if (WHATSAPP_PARTIAL.has(status)) return "partial";
  return "off";
}

export function googleContactsTone(status) {
  if (status === "connected") return "connected";
  if (GOOGLE_PARTIAL.has(status)) return "partial";
  return "off";
}

function WhatsAppGlyph({ className }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} fill="currentColor">
      <path d="M16.04 3.2A12.74 12.74 0 0 0 5.2 22.65L3.72 28l5.48-1.43A12.75 12.75 0 1 0 16.04 3.2Zm0 2.27a10.47 10.47 0 0 1 8.86 16.04 10.47 10.47 0 0 1-14.96 2.74l-.39-.24-3.25.85.87-3.16-.26-.41A10.46 10.46 0 0 1 16.04 5.47Zm-4.45 5.62c-.22 0-.58.08-.88.42-.3.34-1.15 1.12-1.15 2.74s1.18 3.18 1.34 3.4c.16.22 2.27 3.64 5.63 4.96 2.79 1.1 3.36.88 3.96.82.6-.05 1.94-.79 2.21-1.55.27-.76.27-1.42.19-1.55-.08-.14-.3-.22-.63-.38-.33-.16-1.94-.96-2.24-1.07-.3-.11-.52-.16-.74.16-.22.33-.85 1.07-1.04 1.29-.19.22-.38.25-.71.08-.33-.16-1.38-.51-2.63-1.62-.97-.86-1.63-1.93-1.82-2.26-.19-.33-.02-.5.14-.67.15-.15.33-.38.49-.57.16-.19.22-.33.33-.55.11-.22.05-.41-.03-.57-.08-.16-.74-1.79-1.01-2.45-.27-.64-.54-.55-.74-.56h-.63Z" />
    </svg>
  );
}

// kind: "whatsapp" | "google". label: texto completo do status (tooltip,
// leitor de tela e revelação por toque), ex.: "WhatsApp: Conectado".
const BUBBLE_ALIGN = {
  center: "left-1/2 -translate-x-1/2",
  start: "left-0",
  end: "right-0"
};

export default function IntegrationStatusIcon({ kind, tone = "off", label, onClick, className, align = "center" }) {
  const [revealed, setRevealed] = useState(false);
  const timerRef = useRef(null);
  const Icon = kind === "whatsapp" ? WhatsAppGlyph : Contact;

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleClick = (event) => {
    // O card do corretor inteiro é clicável (abre o painel de desempenho):
    // tocar no indicador só mostra o status, não abre nada.
    event.stopPropagation();
    if (onClick) {
      onClick(event);
      return;
    }
    setRevealed(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setRevealed(false), 2800);
  };

  return (
    <span className={cx("group relative inline-flex", className)}>
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={(event) => event.stopPropagation()}
        title={label}
        aria-label={label}
        className={cx(
          // Alvo visual de 32px; o ::before amplia a área de toque para 44px.
          "relative inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors duration-150 before:absolute before:-inset-1.5 before:content-['']",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          INTEGRATION_TONE_CLASS[tone] || INTEGRATION_TONE_CLASS.off
        )}
      >
        <Icon className="h-4 w-4" />
      </button>
      <span
        aria-hidden="true"
        className={cx(
          "pointer-events-none absolute top-full z-30 mt-1.5 whitespace-nowrap rounded-control bg-navy px-2.5 py-1.5 text-xs font-semibold text-white shadow-float",
          BUBBLE_ALIGN[align] || BUBBLE_ALIGN.center,
          revealed ? "block" : "hidden group-hover:block group-focus-within:block"
        )}
      >
        {label}
      </span>
    </span>
  );
}
