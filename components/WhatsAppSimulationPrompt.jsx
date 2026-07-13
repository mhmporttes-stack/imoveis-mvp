"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { whatsappMessageLink } from "@/lib/format";

const SESSION_STATE_KEY = "mm_whatsapp_simulation_prompt_state";
const SESSION_ENTERED_AT_KEY = "mm_whatsapp_simulation_prompt_entered_at";
const DISPLAY_DELAY_MS = 30000;
const SIMULATION_MESSAGE = "Gostaria de fazer uma simulação";

export default function WhatsAppSimulationPrompt() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  const whatsappUrl = useMemo(() => whatsappMessageLink(SIMULATION_MESSAGE), []);
  const isAdminRoute = pathname?.startsWith("/admin");

  useEffect(() => {
    if (isAdminRoute || typeof window === "undefined") {
      setVisible(false);
      return undefined;
    }

    const state = readSessionValue(SESSION_STATE_KEY);
    if (state === "shown" || state === "closed" || state === "clicked") {
      return undefined;
    }

    const now = Date.now();
    const enteredAt = Number(readSessionValue(SESSION_ENTERED_AT_KEY)) || now;
    writeSessionValue(SESSION_ENTERED_AT_KEY, String(enteredAt));

    const remainingDelay = Math.max(DISPLAY_DELAY_MS - (now - enteredAt), 0);
    const timer = window.setTimeout(() => {
      writeSessionValue(SESSION_STATE_KEY, "shown");
      setVisible(true);
    }, remainingDelay);

    return () => window.clearTimeout(timer);
  }, [isAdminRoute, pathname]);

  function closePrompt() {
    writeSessionValue(SESSION_STATE_KEY, "closed");
    setVisible(false);
  }

  function markClicked() {
    writeSessionValue(SESSION_STATE_KEY, "clicked");
    setVisible(false);
  }

  if (!visible || isAdminRoute) return null;

  return (
    <aside
      aria-label="Convite para simulação pelo WhatsApp"
      className="simulation-prompt fixed right-4 z-[90] max-w-[calc(100vw-2rem)] sm:right-6 sm:top-[52%] sm:w-auto max-sm:bottom-[calc(5.25rem+env(safe-area-inset-bottom))]"
    >
      <a
        aria-label="Fazer uma simulação pelo WhatsApp"
        className="group flex min-h-[58px] items-center gap-3 rounded-2xl border border-blue-100/40 bg-[#071f38]/95 py-3 pl-4 pr-12 text-white shadow-[0_22px_65px_rgba(4,20,38,0.32)] backdrop-blur-xl transition duration-300 hover:-translate-x-1 hover:border-blue-100/70 hover:bg-[#082f55] hover:shadow-[0_28px_85px_rgba(4,20,38,0.42)] focus:outline-none focus:ring-4 focus:ring-blue-300/35 sm:min-w-[245px]"
        href={whatsappUrl}
        onClick={markClicked}
        rel="noopener noreferrer"
        target="_blank"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#25D366] text-white shadow-[0_14px_32px_rgba(37,211,102,0.28)] transition duration-300 group-hover:scale-105">
          <WhatsAppIcon className="h-5 w-5" />
        </span>
        <span className="whitespace-nowrap text-sm font-black leading-none tracking-[0.01em] sm:text-base">
          Faça uma simulação
        </span>
      </a>

      <button
        aria-label="Fechar convite de simulação"
        className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full text-white/60 transition duration-300 hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-200/60"
        onClick={closePrompt}
        type="button"
      >
        <X className="h-4 w-4" />
      </button>
    </aside>
  );
}

function readSessionValue(key) {
  try {
    return window.sessionStorage?.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeSessionValue(key, value) {
  try {
    window.sessionStorage?.setItem(key, value);
  } catch {
    // Some restricted browser contexts can block sessionStorage. The prompt still works for the current page.
  }
}

function WhatsAppIcon({ className }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} fill="currentColor">
      <path d="M16.04 3.2A12.74 12.74 0 0 0 5.2 22.65L3.72 28l5.48-1.43A12.75 12.75 0 1 0 16.04 3.2Zm0 2.27a10.47 10.47 0 0 1 8.86 16.04 10.47 10.47 0 0 1-14.96 2.74l-.39-.24-3.25.85.87-3.16-.26-.41A10.46 10.46 0 0 1 16.04 5.47Zm-4.45 5.62c-.22 0-.58.08-.88.42-.3.34-1.15 1.12-1.15 2.74s1.18 3.18 1.34 3.4c.16.22 2.27 3.64 5.63 4.96 2.79 1.1 3.36.88 3.96.82.6-.05 1.94-.79 2.21-1.55.27-.76.27-1.42.19-1.55-.08-.14-.3-.22-.63-.38-.33-.16-1.94-.96-2.24-1.07-.3-.11-.52-.16-.74.16-.22.33-.85 1.07-1.04 1.29-.19.22-.38.25-.71.08-.33-.16-1.38-.51-2.63-1.62-.97-.86-1.63-1.93-1.82-2.26-.19-.33-.02-.5.14-.67.15-.15.33-.38.49-.57.16-.19.22-.33.33-.55.11-.22.05-.41-.03-.57-.08-.16-.74-1.79-1.01-2.45-.27-.64-.54-.55-.74-.56h-.63Z" />
    </svg>
  );
}
