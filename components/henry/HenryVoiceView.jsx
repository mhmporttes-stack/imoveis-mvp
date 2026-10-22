"use client";

import { useEffect, useRef, useState } from "react";
import HenryOrb from "./HenryOrb";

// Apresentação do Henry (sem estado de voz): ícone do canto e tela cheia. Visual pedido pelo dono em 2026-10-22 a partir de
// uma referência em vídeo ("nesse perfil… no meu estilo"): fundo azul-marinho profundo, anel de filamentos no centro,
// conversa pequena no canto inferior direito (fala dele em branco, a do Henry no ciano de destaque) e dois botões redondos
// pequenos: teclado e microfone. Cores fixas por style (a tela é sempre escura, também no tema claro do painel).
// Usada pelo HenryVoiceAssistant e pela vitrine (app/dev/vitrine) para revisar sem login.

const BACKDROP = "#07111F";
const ACCENT = "#4FC3E0";
const VISIBLE_TURNS = 4;

function useFullscreenOrbSize(active) {
  const [size, setSize] = useState(520);
  useEffect(() => {
    if (!active) return undefined;
    const update = () => setSize(Math.round(Math.max(280, Math.min(window.innerWidth * 0.6, window.innerHeight * 0.72, 720))));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [active]);
  return size;
}

export default function HenryVoiceView({
  expanded,
  onExpand,
  onMinimize,
  status,
  turns = [],
  notice = "",
  micOff,
  onToggleMute,
  getSignal,
  sleeping = false,
  showKeyboard = false,
  onToggleKeyboard,
  typed = "",
  onTyped,
  onSubmitTyped,
  busy = false,
  fixed = true
}) {
  const orbSize = useFullscreenOrbSize(expanded);
  const inputRef = useRef(null);
  useEffect(() => {
    if (expanded && showKeyboard) inputRef.current?.focus();
  }, [expanded, showKeyboard]);

  if (!expanded) {
    return (
      <div className={`${fixed ? "fixed bottom-5 right-5 z-[65]" : "relative"} flex items-center gap-2`} data-henry-assistant>
        <RoundButton onClick={onToggleMute} label={micOff ? "Ligar o microfone do Henry (Alt+B)" : "Deixar o Henry no mudo (Alt+B)"} small>
          <MicIcon off={micOff} />
        </RoundButton>
        <button
          type="button"
          onClick={onExpand}
          className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full shadow-float ring-1 ring-white/10 transition hover:ring-white/30"
          style={{ background: BACKDROP }}
          aria-label={`Abrir o Henry. ${status}`}
          title={`Henry — ${status}`}
        >
          <HenryOrb size={56} fibers={18} points={44} alpha={0.45} lineWidth={0.7} getSignal={getSignal} sleep={sleeping} />
        </button>
      </div>
    );
  }

  const recent = turns.slice(-VISIBLE_TURNS);
  return (
    <div
      className={`${fixed ? "fixed inset-0 z-[70]" : "relative h-[640px] w-full"} flex items-center justify-center overflow-hidden text-white`}
      style={{ background: `radial-gradient(ellipse at 50% 45%, #0C1E36 0%, ${BACKDROP} 62%)` }}
      role="dialog"
      aria-modal="true"
      aria-label="Assistente Henry"
    >
      <div className="absolute left-8 top-6">
        <p className="text-sm font-bold tracking-wide text-white/85">Henry</p>
        <p className="mt-0.5 text-xs text-white/55" aria-live="polite">{status}</p>
      </div>
      <button
        type="button"
        onClick={onMinimize}
        className="absolute right-6 top-5 flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
        aria-label="Minimizar o Henry (Esc)"
        title="Minimizar (Esc)"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <HenryOrb size={orbSize} fibers={52} points={140} alpha={0.3} lineWidth={0.85} glow getSignal={getSignal} />

      <div className="absolute bottom-6 right-8 flex w-[min(420px,40vw)] flex-col items-end gap-3">
        <div className="flex w-full flex-col items-end gap-1.5 text-right text-[13px] leading-snug">
          {recent.length ? (
            recent.map((turn, index) => (
              <p key={`${turns.length - recent.length + index}`} className={turn.role === "user" ? "text-white/80" : ""} style={turn.role === "user" ? undefined : { color: ACCENT }}>
                {turn.text}
              </p>
            ))
          ) : (
            <p className="text-white/55">Diga “bom dia, Henry” ou “Henry, quantos clientes aguardam resposta?”</p>
          )}
          {notice ? <p className="font-bold text-amber-200">{notice}</p> : null}
        </div>
        {showKeyboard ? (
          <form onSubmit={onSubmitTyped} className="flex w-full gap-2">
            <input
              ref={inputRef}
              value={typed}
              onChange={(event) => onTyped?.(event.target.value)}
              maxLength={500}
              placeholder="Digite a pergunta…"
              className="h-9 flex-1 rounded-full border border-white/15 bg-white/5 px-4 text-sm text-white placeholder:text-white/45 focus:border-white/40 focus:outline-none"
            />
            <button type="submit" disabled={busy} className="h-9 rounded-full bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/20 disabled:opacity-50">
              Enviar
            </button>
          </form>
        ) : null}
        <div className="flex items-center gap-2">
          <RoundButton onClick={onToggleKeyboard} label={showKeyboard ? "Esconder o teclado" : "Digitar a pergunta"} dark active={showKeyboard}>
            <KeyboardIcon />
          </RoundButton>
          <RoundButton onClick={onToggleMute} label={micOff ? "Ligar o microfone (Alt+B)" : "Mudo (Alt+B)"} dark active={!micOff}>
            <MicIcon off={micOff} />
          </RoundButton>
        </div>
      </div>
    </div>
  );
}

function RoundButton({ onClick, label, children, small = false, dark = false, active = false }) {
  const base = small ? "h-9 w-9" : "h-9 w-9";
  const tone = dark
    ? active
      ? "border border-white/25 bg-white/15 text-white"
      : "border border-white/15 bg-white/5 text-white/60"
    : "border border-line bg-white text-navy shadow-float hover:text-brand";
  return (
    <button type="button" onClick={onClick} className={`${base} flex items-center justify-center rounded-full transition ${tone}`} aria-label={label} title={label}>
      {children}
    </button>
  );
}

function MicIcon({ off }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      {off ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </svg>
  );
}
