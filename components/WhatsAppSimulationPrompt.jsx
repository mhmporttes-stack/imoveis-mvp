"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import { whatsappMessageLink } from "@/lib/format";

const SESSION_STATE_KEY = "mm_whatsapp_simulation_prompt_state";
const SESSION_ENTERED_AT_KEY = "mm_whatsapp_simulation_prompt_entered_at";
const DISPLAY_DELAY_MS = 30000;
const SIMULATION_MESSAGE = "Gostaria de fazer uma simulação";

export default function WhatsAppSimulationPrompt() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  const simulationUrl = useMemo(() => whatsappMessageLink(SIMULATION_MESSAGE), []);
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
      aria-label="Convite para simulação de financiamento"
      className="simulation-prompt fixed bottom-[calc(20px+env(safe-area-inset-bottom))] right-5 z-[110] w-[260px] max-w-[calc(100vw-40px)] sm:bottom-[calc(28px+env(safe-area-inset-bottom))] sm:right-7 sm:w-auto"
    >
      <a
        aria-label="Fazer uma simulação de financiamento"
        className="group relative flex min-h-[62px] w-full items-center gap-3 overflow-hidden rounded-full border border-white/15 bg-gradient-to-r from-[#0D2E57] to-[#184A84] py-3 pl-3.5 pr-11 text-white shadow-[0_20px_55px_rgba(13,59,102,0.28)] backdrop-blur-xl transition duration-[250ms] ease-out hover:scale-[1.03] hover:border-white/25 hover:shadow-[0_28px_78px_rgba(24,74,132,0.42)] focus:outline-none focus:ring-4 focus:ring-blue-300/35 sm:min-h-[66px] sm:min-w-[272px] sm:gap-4 sm:pl-4 sm:pr-12"
        href={simulationUrl}
        onClick={markClicked}
        rel="noopener noreferrer"
        target="_blank"
      >
        <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.22),rgba(255,255,255,0.04)_38%,rgba(255,255,255,0)_70%)] opacity-80" />
        <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/20 bg-white/12 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_14px_34px_rgba(0,0,0,0.18)] transition duration-[250ms] group-hover:scale-105 sm:h-12 sm:w-12">
          <FinancingIcon className="h-7 w-7" />
        </span>
        <span className="relative flex min-w-0 flex-1 items-center justify-between gap-2">
          <span className="text-left text-[0.8rem] font-black uppercase leading-[1.05] tracking-[0.08em] text-white sm:text-[0.9rem]">
            <span className="block">Faça sua</span>
            <span className="block">simulação</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-white/85 transition duration-[250ms] group-hover:translate-x-1 group-hover:text-white" />
        </span>
      </a>

      <button
        aria-label="Fechar convite de simulação"
        className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full text-white/55 transition duration-[250ms] hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-200/60"
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

function FinancingIcon({ className }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} fill="none">
      <path
        d="M6.5 14.1 16 6.4l9.5 7.7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.35"
      />
      <path
        d="M9.25 13.25v10.1c0 1.05.85 1.9 1.9 1.9h9.7c1.05 0 1.9-.85 1.9-1.9v-10.1"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2.35"
      />
      <path
        d="M16 12.15v8.7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.1"
      />
      <path
        d="M18.35 14.2c-.55-.58-1.35-.9-2.22-.9-1.34 0-2.43.72-2.43 1.82 0 1.2 1.14 1.63 2.45 1.94 1.22.3 2.38.72 2.38 1.96 0 1.08-1.02 1.84-2.48 1.84-.98 0-1.9-.38-2.48-1.05"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.85"
      />
    </svg>
  );
}
