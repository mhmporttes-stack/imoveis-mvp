"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowRight, X } from "lucide-react";

const SESSION_STATE_KEY = "mm_whatsapp_simulation_prompt_state";
const SESSION_ENTERED_AT_KEY = "mm_whatsapp_simulation_prompt_entered_at";
const DISPLAY_DELAY_MS = 30000;
const SINGLE_PERSON_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfDtT53N_WxEHHut1npFSAvqrliXfKgUGJzw3qtU_krKiwlHg/viewform?usp=dialog";
const TWO_PERSON_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLScbvy0vcCglc-ayHPrqj5sMrvgepxKToRLEaeLKGJqULKDs1w/viewform?usp=dialog";

export default function WhatsAppSimulationPrompt() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [choiceModalOpen, setChoiceModalOpen] = useState(false);

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

  useEffect(() => {
    if (!choiceModalOpen || typeof document === "undefined") return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setChoiceModalOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [choiceModalOpen]);

  function closePrompt() {
    writeSessionValue(SESSION_STATE_KEY, "closed");
    setVisible(false);
  }

  function openSimulationChoices() {
    writeSessionValue(SESSION_STATE_KEY, "clicked");
    setVisible(false);
    setChoiceModalOpen(true);
  }

  if (isAdminRoute) return null;

  return (
    <>
      {visible ? (
        <aside
          aria-label="Convite para simulação de financiamento"
          className="simulation-prompt fixed right-5 top-1/2 z-[90] w-[260px] max-w-[calc(100vw-40px)] -translate-y-1/2 sm:right-7 sm:w-auto"
        >
          <button
            aria-label="Fazer uma simulação de financiamento"
            className="group relative flex min-h-[62px] w-full items-center gap-3 overflow-hidden rounded-full border border-white/15 bg-gradient-to-r from-[#0D2E57] to-[#184A84] py-3 pl-3.5 pr-11 text-white shadow-[0_20px_55px_rgba(13,59,102,0.28)] backdrop-blur-xl transition duration-[250ms] ease-out hover:scale-[1.03] hover:border-white/25 hover:shadow-[0_28px_78px_rgba(24,74,132,0.42)] focus:outline-none focus:ring-4 focus:ring-blue-300/35 sm:min-h-[66px] sm:min-w-[272px] sm:gap-4 sm:pl-4 sm:pr-12"
            onClick={openSimulationChoices}
            type="button"
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
          </button>

          <button
            aria-label="Fechar convite de simulação"
            className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full text-white/55 transition duration-[250ms] hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-200/60"
            onClick={closePrompt}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </aside>
      ) : null}

      {choiceModalOpen ? (
        <div
          aria-labelledby="simulation-choice-title"
          aria-modal="true"
          className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/65 px-4 py-6 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setChoiceModalOpen(false);
            }
          }}
          role="dialog"
        >
          <div className="relative w-full max-w-[560px] overflow-hidden rounded-[28px] border border-white/20 bg-white p-7 text-slate-900 shadow-[0_32px_90px_rgba(2,12,27,0.32)] sm:p-9">
            <button
              aria-label="Fechar pergunta da simulação"
              className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 transition duration-200 hover:border-blue-200 hover:bg-blue-50 hover:text-[#0D3B66] focus:outline-none focus:ring-4 focus:ring-blue-200/60"
              onClick={() => setChoiceModalOpen(false)}
              type="button"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-[#2563EB]">
              <FinancingIcon className="h-8 w-8" />
            </div>

            <p className="mb-3 text-xs font-black uppercase tracking-[0.22em] text-[#2563EB]">
              Simulação de financiamento
            </p>
            <h2
              className="max-w-[440px] text-[clamp(1.55rem,4.6vw,2.35rem)] font-black leading-[1.08] text-[#0D3B66]"
              id="simulation-choice-title"
            >
              A simulação será feita apenas em seu nome ou você gostaria de simular com mais alguém?
            </h2>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <a
                className="group flex min-h-[58px] items-center justify-center rounded-full bg-gradient-to-r from-[#0D2E57] to-[#184A84] px-5 text-center text-sm font-black uppercase tracking-[0.04em] text-white shadow-[0_18px_42px_rgba(13,59,102,0.22)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_56px_rgba(13,59,102,0.3)] focus:outline-none focus:ring-4 focus:ring-blue-300/45"
                href={SINGLE_PERSON_FORM_URL}
                rel="noopener noreferrer"
                target="_blank"
              >
                SIM APENAS EM MEU NOME
                <ArrowRight className="ml-2 h-4 w-4 transition duration-200 group-hover:translate-x-1" />
              </a>
              <a
                className="group flex min-h-[58px] items-center justify-center rounded-full border border-[#0D3B66]/18 bg-white px-5 text-center text-sm font-black uppercase tracking-[0.04em] text-[#0D3B66] shadow-[0_14px_34px_rgba(13,59,102,0.08)] transition duration-200 hover:-translate-y-0.5 hover:border-[#2563EB]/45 hover:bg-blue-50 hover:shadow-[0_20px_46px_rgba(13,59,102,0.14)] focus:outline-none focus:ring-4 focus:ring-blue-200/70"
                href={TWO_PERSON_FORM_URL}
                rel="noopener noreferrer"
                target="_blank"
              >
                EU E MAIS UMA PESSOA
                <ArrowRight className="ml-2 h-4 w-4 transition duration-200 group-hover:translate-x-1" />
              </a>
            </div>

            <p className="mt-5 text-sm leading-6 text-slate-500">
              Escolha a opção que combina com a sua simulação. O formulário abrirá em uma nova aba.
            </p>
          </div>
        </div>
      ) : null}
    </>
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
