"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HENRY_PIN_LENGTH } from "@/lib/henry-lock-core.mjs";

// Tela de bloqueio do Henry (REGRA OFICIAL — dono, 2026-10-23; docs/BUSINESS_RULES.md HENRY-LOCK). Só apresentação e a
// digitação: embaixo, centralizado, 6 risquinhos com um cadeado fino em cima de cada um; cada dígito vira "*" e abre o
// cadeado (o número nunca aparece). Erro = tremor leve e os campos limpam. Teclado físico (dígitos e Backspace); no
// celular, toque nos risquinhos abre um teclado numérico mínimo. Quem confere a senha é o SERVIDOR (onSubmit).
// Paleta do Henry (fundo #07111F, destaque #4FC3E0); prefers-reduced-motion = sem tremor nem transição.

const ACCENT = "#4FC3E0";
const BACKDROP = "#07111F";

export function HenryLockIcon({ open = false, size = 14, color = "currentColor", strokeWidth = 1.3 }) {
  return (
    <svg viewBox="0 0 16 18" width={size} height={size * 1.125} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="8" width="11" height="8.5" rx="1.6" />
      {open ? <path d="M5 8V5.2a3 3 0 0 1 5.6-1.5" /> : <path d="M5 8V5.5a3 3 0 0 1 6 0V8" />}
      <path d="M8 11.4v1.8" />
    </svg>
  );
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];

// accessory (2026-10-24): botão do Face ID / Windows Hello (HenryPasskeyUnlockButton) ao lado dos cadeados — opcional.
export default function HenryLockScreen({ onSubmit, mobile = false, initialWaitSeconds = 0, keypadDefault = false, demoDigits = null, demoShake = false, accessory = null }) {
  const [digits, setDigits] = useState("");
  const [shake, setShake] = useState(demoShake ? 1 : 0); // demo* = só a vitrine (app/dev/vitrine)
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(demoShake ? "Senha incorreta." : "");
  const [waitUntil, setWaitUntil] = useState(() => (initialWaitSeconds > 0 ? Date.now() + initialWaitSeconds * 1000 : 0));
  const [now, setNow] = useState(() => Date.now());
  const [keypad, setKeypad] = useState(keypadDefault);
  const busyRef = useRef(false);
  const shown = demoDigits ?? digits;
  const waiting = waitUntil > now;
  const waitLeft = waiting ? Math.ceil((waitUntil - now) / 1000) : 0;

  useEffect(() => {
    if (!waitUntil) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waitUntil]);

  const submit = useCallback(
    async (pin) => {
      if (busyRef.current || !onSubmit) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const result = (await onSubmit(pin)) || {};
        if (result.ok) {
          setMessage("");
          setDigits("");
          return;
        }
        setDigits("");
        setShake((value) => value + 1);
        if (result.waitSeconds) {
          setWaitUntil(Date.now() + result.waitSeconds * 1000);
          setNow(Date.now());
        }
        setMessage(result.error || "Senha incorreta.");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onSubmit]
  );

  const press = useCallback(
    (key) => {
      if (busyRef.current || waiting) return;
      if (key === "back") {
        setDigits((current) => current.slice(0, -1));
        return;
      }
      if (!/^\d$/.test(key)) return;
      setMessage("");
      setDigits((current) => {
        if (current.length >= HENRY_PIN_LENGTH) return current;
        const next = current + key;
        if (next.length === HENRY_PIN_LENGTH) window.setTimeout(() => submit(next), 120); // o último "*" aparece antes
        return next;
      });
    },
    [submit, waiting]
  );

  // Teclado físico: dígitos (inclusive do teclado numérico) e Backspace. O campo "Digite a pergunta" continua livre.
  useEffect(() => {
    if (demoDigits !== null) return undefined;
    const onKey = (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        press(event.key);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        press("back");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [demoDigits, press]);

  const status = waiting ? `Muitas tentativas. Tente de novo em ${waitLeft >= 60 ? `${Math.ceil(waitLeft / 60)} min` : `${waitLeft} s`}.` : message;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 flex flex-col items-center"
      style={{ bottom: mobile ? "calc(1rem + env(safe-area-inset-bottom))" : "1.75rem" }}
      onClick={(event) => event.stopPropagation()}
    >
      <style>{`
        @keyframes henryLockShake { 0%,100% { transform: translateX(0) } 20% { transform: translateX(-6px) } 40% { transform: translateX(5px) } 60% { transform: translateX(-3px) } 80% { transform: translateX(2px) } }
        .henry-lock-shake { animation: henryLockShake 360ms ease-in-out }
        @media (prefers-reduced-motion: reduce) { .henry-lock-shake { animation: none } .henry-lock-slot * { transition: none !important } }
      `}</style>
      {keypad && mobile ? (
        <div className="pointer-events-auto mb-3 grid grid-cols-3 gap-2 rounded-3xl p-3 ring-1 ring-white/10" style={{ background: BACKDROP }} role="group" aria-label="Teclado numérico">
          {KEYS.map((key, index) =>
            key ? (
              <button
                key={key}
                type="button"
                disabled={busy || waiting}
                onClick={() => press(key)}
                className="flex h-12 w-14 items-center justify-center rounded-2xl text-lg font-semibold text-white/85 transition active:bg-white/15 disabled:opacity-40"
                aria-label={key === "back" ? "Apagar" : key}
              >
                {key === "back" ? (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 6h11v12H9l-5-6 5-6zM13 10l4 4M17 10l-4 4" />
                  </svg>
                ) : (
                  key
                )}
              </button>
            ) : (
              <span key={`blank-${index}`} />
            )
          )}
        </div>
      ) : null}
      <div className="relative">
      <button
        type="button"
        key={shake}
        onClick={() => mobile && setKeypad((value) => !value)}
        className={`pointer-events-auto flex items-end gap-3 rounded-2xl px-3 py-2 ${shake ? "henry-lock-shake" : ""}`}
        aria-label={`Tela bloqueada. Digite a senha de ${HENRY_PIN_LENGTH} dígitos. ${shown.length} digitados.${mobile ? " Toque para abrir o teclado." : ""}`}
        aria-live="polite"
      >
        {Array.from({ length: HENRY_PIN_LENGTH }, (_, index) => {
          const filled = index < shown.length;
          return (
            <span key={index} className="henry-lock-slot flex w-5 flex-col items-center gap-1.5">
              <span className="transition-[opacity,transform] duration-200 ease-out" style={{ color: filled ? ACCENT : "rgba(255,255,255,0.42)", transform: filled ? "translateY(-1px)" : "none" }}>
                <HenryLockIcon open={filled} size={11} strokeWidth={1.2} />
              </span>
              <span className="h-4 text-[15px] font-semibold leading-4 transition-opacity duration-150" style={{ color: ACCENT, opacity: filled ? 1 : 0 }} aria-hidden="true">
                *
              </span>
              <span className="block h-px w-5 transition-colors duration-200" style={{ background: filled ? ACCENT : "rgba(255,255,255,0.35)" }} />
            </span>
          );
        })}
      </button>
      {/* fora do fluxo: os cadeados continuam centralizados */}
      {accessory ? <div className="pointer-events-auto absolute bottom-1 left-full ml-1">{accessory}</div> : null}
      </div>
      <p className="mt-1.5 min-h-[1rem] text-center text-[11px] text-white/55" role="status">
        {status || (mobile ? "Toque para digitar a senha" : "Digite a senha")}
      </p>
    </div>
  );
}

// Desbloqueado: cadeado aberto bem discreto num canto (no topo, ao lado do "minimizar"). Clicar bloqueia na hora.
export function HenryUnlockedBadge({ onLock }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onLock?.();
      }}
      className="absolute right-16 top-[calc(0.75rem+env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full text-white/35 transition hover:bg-white/10 hover:text-white/80 md:right-16 md:top-5 md:h-9 md:w-9"
      aria-label="Bloquear a tela do Henry"
      title="Bloquear a tela"
    >
      <HenryLockIcon open size={13} />
    </button>
  );
}
