"use client";

import { useEffect, useRef, useState } from "react";
import HenryOrb from "./HenryOrb";
import { HenryBrokerCards, HenryDataScene, HenryDetailPanel, HenryIconSearchHint, HenrySceneStyles } from "./HenrySearchScene";

// Apresentação do Henry (sem estado de voz): ícone do canto e tela cheia. Visual pedido pelo dono em 2026-10-22 a partir de
// uma referência em vídeo ("nesse perfil… no meu estilo"): fundo azul-marinho profundo, anel de filamentos no centro,
// conversa pequena no canto inferior direito (fala dele em branco, a do Henry no ciano de destaque) e dois botões redondos
// pequenos: teclado e microfone. Cores fixas por style (a tela é sempre escura, também no tema claro do painel).
// Usada pelo HenryVoiceAssistant e pela vitrine (app/dev/vitrine) para revisar sem login.

const BACKDROP = "#07111F";
const ACCENT = "#4FC3E0";
const VISIBLE_TURNS = 4;
const ICON_SMALL = 56;
const ICON_BIG = 112;

// Celular: ícone menor (52 → 88 px quando chamado), no canto inferior ESQUERDO logo acima da barra inferior do app (à
// direita ficam os botões flutuantes das telas); nunca cobre a barra.
const MOBILE_SMALL = 52;
const MOBILE_BIG = 88;
const MOBILE_BOTTOM = "calc(0.75rem + max(env(safe-area-inset-bottom), var(--admin-bottom-nav-space, 0px)))";

// iPhone (dono, 2026-10-22): tocar no Henry abria "Copiar / Pesquisar / Traduzir" e selecionava a área da animação. Nada
// do Henry é selecionável nem abre o menu/lupa do toque longo; só o campo de digitação continua selecionável.
export const HENRY_NO_SELECT = Object.freeze({
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation"
});
const TYPING_SELECT = Object.freeze({ userSelect: "text", WebkitUserSelect: "text", WebkitTouchCallout: "default" });

// Toque (não mouse): sem seleção nem lupa. preventDefault no pointerdown não cancela o clique (o clique é que abre/grava,
// dentro do gesto que libera o som no iOS); no touchstart cancelaria — por isso não é usado lá.
export function preventTouchSelection(event) {
  if (event.pointerType && event.pointerType !== "mouse" && event.cancelable) event.preventDefault();
}

function useFullscreenOrbSize(active, mobile) {
  const [size, setSize] = useState(520);
  useEffect(() => {
    if (!active) return undefined;
    const update = () =>
      setSize(
        Math.round(
          mobile
            ? Math.max(220, Math.min(window.innerWidth * 0.86, window.innerHeight * 0.46))
            : Math.max(280, Math.min(window.innerWidth * 0.6, window.innerHeight * 0.72, 720))
        )
      );
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [active, mobile]);
  return size;
}

export default function HenryVoiceView({
  expanded,
  onExpand,
  onMinimize,
  status,
  engaged = false,
  inConversation = false,
  caption = "",
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
  vision = false,
  capturing = false,
  onToggleVision,
  mobile = false,
  speaking = false,
  onInterrupt,
  tapToTalk = false,
  recordMode = false, // celular sem reconhecimento de voz: tocar no anel/microfone grava; tocar de novo envia
  recording = false,
  onTalk,
  heardHint = "", // minimizado: "Ouvi: … (diga 'Henry' antes)" — o que foi ignorado, para o dono ver
  searching = false, // pensando/buscando: "dados" transparentes atrás do anel (HenrySearchScene)
  sceneTopic = "geral",
  brokers = [], // corretores do pedido: procurando (scanner) → achado (card com foto e números)
  fixed = true
}) {
  const orbSize = useFullscreenOrbSize(expanded, mobile);
  const inputRef = useRef(null);
  const touchRef = useRef(null);
  useEffect(() => {
    if (expanded && showKeyboard) inputRef.current?.focus();
  }, [expanded, showKeyboard]);

  const foundBroker = [...brokers].reverse().find((broker) => broker.found) || null;
  const lastAssistant = [...turns].reverse().find((turn) => turn?.role === "assistant");
  const detail = !searching && lastAssistant?.detail ? lastAssistant.detail : null;

  if (!expanded && mobile) {
    // Celular: toque no anel = abre a cena já ouvindo. Mudo só aparece com "Ouvir 'Henry' com o app aberto" (tapToTalk falso).
    const box = engaged ? MOBILE_BIG : MOBILE_SMALL;
    return (
      <div
        className={`${fixed ? "pointer-events-none fixed left-3 z-[35]" : "relative"} flex items-end gap-2 md:hidden`}
        style={fixed ? { ...HENRY_NO_SELECT, bottom: MOBILE_BOTTOM } : HENRY_NO_SELECT}
        data-henry-assistant
      >
        <div className="relative transition-[width,height] duration-300 ease-out motion-reduce:transition-none" style={{ width: box, height: box }}>
          <button
            type="button"
            onPointerDown={preventTouchSelection}
            onClick={onExpand}
            className="pointer-events-auto absolute bottom-0 left-0 flex items-center justify-center overflow-hidden rounded-full shadow-float ring-1 ring-white/10 transition-transform duration-300 ease-out motion-reduce:transition-none"
            style={{ background: BACKDROP, width: MOBILE_BIG, height: MOBILE_BIG, transform: `scale(${box / MOBILE_BIG})`, transformOrigin: "bottom left" }}
            aria-label={`Falar com o Henry. ${status}`}
          >
            <HenryOrb size={MOBILE_BIG} fibers={18} points={48} alpha={0.45} lineWidth={0.8} getSignal={getSignal} sleep={sleeping && !engaged} />
            {inConversation ? <ConversationDot /> : null}
          </button>
          <HenrySceneStyles />
          <HenryIconSearchHint searching={searching} broker={foundBroker} size={box} />
        </div>
        {!tapToTalk ? (
          <span className="pointer-events-auto mb-1.5">
            <RoundButton onClick={onToggleMute} label={micOff ? "Ligar o microfone do Henry" : "Deixar o Henry no mudo"} small>
              <MicIcon off={micOff} />
            </RoundButton>
          </span>
        ) : null}
        {engaged && caption ? (
          <p
            className="mb-1.5 max-w-[calc(100vw-9rem)] rounded-2xl px-3 py-2 text-[12px] leading-snug shadow-float ring-1 ring-white/10 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] overflow-hidden"
            style={{ background: BACKDROP, color: ACCENT }}
            aria-live="polite"
          >
            {caption}
          </p>
        ) : null}
      </div>
    );
  }

  if (!expanded) {
    // Ícone do canto: 56 px parado; chamado/em conversa (engaged) DOBRA para 112 px, crescendo para dentro da tela a partir
    // do canto, com a legenda pequena ao lado. O anel é desenhado sempre em 112 px e reduzido por escala (nítido nos dois).
    // Wrapper sem cliques (pointer-events-none): só o ícone e o botão de mudo recebem clique; a legenda nunca tapa nada.
    const box = engaged ? ICON_BIG : ICON_SMALL;
    return (
      <div className={`${fixed ? "pointer-events-none fixed bottom-5 right-5 z-[65]" : "relative"} flex items-end gap-2`} style={HENRY_NO_SELECT} data-henry-assistant>
        {!engaged && heardHint ? (
          <p className="mb-2 max-w-[260px] rounded-2xl px-3 py-2 text-[11px] leading-snug text-white/70 shadow-float ring-1 ring-white/10" style={{ background: BACKDROP }} aria-live="polite">
            {heardHint}
          </p>
        ) : null}
        {engaged && caption ? (
          <p
            className="mb-2 max-w-[260px] rounded-2xl px-3 py-2 text-[12px] leading-snug shadow-float ring-1 ring-white/10 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:4] overflow-hidden"
            style={{ background: BACKDROP, color: ACCENT }}
            aria-live="polite"
          >
            {caption}
          </p>
        ) : null}
        <span className="pointer-events-auto mb-2.5">
          <RoundButton onClick={onToggleMute} label={micOff ? "Ligar o microfone do Henry (Alt+B)" : "Deixar o Henry no mudo (Alt+B)"} small>
            <MicIcon off={micOff} />
          </RoundButton>
        </span>
        <div className="relative transition-[width,height] duration-300 ease-out motion-reduce:transition-none" style={{ width: box, height: box }}>
          <button
            type="button"
            onPointerDown={preventTouchSelection}
            onClick={onExpand}
            className="pointer-events-auto absolute bottom-0 right-0 flex items-center justify-center overflow-hidden rounded-full shadow-float ring-1 ring-white/10 transition-transform duration-300 ease-out hover:ring-white/30 motion-reduce:transition-none"
            style={{ background: BACKDROP, width: ICON_BIG, height: ICON_BIG, transform: `scale(${box / ICON_BIG})`, transformOrigin: "bottom right" }}
            aria-label={`Abrir o Henry. ${status}`}
            title={`Henry — ${heardHint || status}`}
          >
            <HenryOrb size={ICON_BIG} fibers={24} points={60} alpha={0.42} lineWidth={0.8} getSignal={getSignal} sleep={sleeping && !engaged} />
            {capturing ? <CaptureDot className="absolute right-3 top-3" /> : null}
            {inConversation ? <ConversationDot /> : null}
          </button>
          <HenrySceneStyles />
          <HenryIconSearchHint searching={searching} broker={foundBroker} size={box} />
        </div>
      </div>
    );
  }

  const recent = turns.slice(-VISIBLE_TURNS);
  return (
    <div
      className={`${fixed ? "fixed inset-0 z-[70]" : "relative h-[640px] w-full"} flex items-center justify-center overflow-hidden text-white`}
      style={{ ...HENRY_NO_SELECT, background: `radial-gradient(ellipse at 50% 45%, #0C1E36 0%, ${BACKDROP} 62%)` }}
      role="dialog"
      aria-modal="true"
      aria-label="Assistente Henry"
      onPointerDown={(event) => {
        if (!(event.target instanceof HTMLInputElement)) preventTouchSelection(event);
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        if (recording) onTalk?.(); // gravando: tocar na tela envia
        else if (mobile && speaking) onInterrupt?.(); // celular: o microfone fica desligado enquanto ele fala; tocar na tela corta
        else onMinimize?.(); // clique fora (no fundo) minimiza
      }}
      // Celular: arrastar para baixo (> 90 px) minimiza; o "voltar" do aparelho também (HenryVoiceAssistant).
      onTouchStart={(event) => {
        touchRef.current = event.touches[0]?.clientY ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchRef.current;
        touchRef.current = null;
        const end = event.changedTouches[0]?.clientY;
        if (mobile && start != null && end != null && end - start > 90 && !(event.target instanceof HTMLInputElement)) onMinimize?.();
      }}
    >
      <HenrySceneStyles />
      <HenryDataScene active={searching} topic={sceneTopic} mobile={mobile} />
      {!mobile ? <HenryDetailPanel detail={detail} /> : null}
      <div className="absolute left-5 top-[calc(1rem+env(safe-area-inset-top))] md:left-8 md:top-6">
        <p className="flex items-center gap-2 text-sm font-bold tracking-wide text-white/85">
          Henry
          {inConversation ? (
            <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: ACCENT }}>
              em conversa
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-white/55" aria-live="polite">{status}</p>
      </div>
      <button
        type="button"
        onClick={onMinimize}
        className="absolute right-4 top-[calc(0.75rem+env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white md:right-6 md:top-5 md:h-9 md:w-9"
        aria-label="Minimizar o Henry (Esc)"
        title="Minimizar (Esc)"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <div className={`relative ${mobile ? "-translate-y-[14vh]" : ""}`}>
        {onTalk ? (
          <button type="button" onPointerDown={preventTouchSelection} onClick={onTalk} className="block rounded-full" aria-label={recording ? "Enviar o que eu falei" : "Tocar para falar com o Henry"}>
            <HenryOrb size={orbSize} fibers={mobile ? 40 : 52} points={mobile ? 110 : 140} alpha={0.3} lineWidth={0.85} glow getSignal={getSignal} />
          </button>
        ) : (
          <HenryOrb size={orbSize} fibers={mobile ? 40 : 52} points={mobile ? 110 : 140} alpha={0.3} lineWidth={0.85} glow getSignal={getSignal} />
        )}
        <HenryBrokerCards brokers={brokers} orbSize={orbSize} mobile={mobile} />
      </div>

      <div className="absolute inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] flex flex-col items-end gap-3 md:inset-x-auto md:bottom-6 md:right-8 md:w-[min(420px,40vw)]">
        <div className="flex max-h-[30vh] w-full flex-col items-end gap-1.5 overflow-y-auto text-right text-[14px] leading-snug md:max-h-none md:overflow-visible md:text-[13px]">
          {mobile ? <HenryDetailPanel detail={detail} mobile /> : null}
          {recent.length ? (
            recent.map((turn, index) => (
              <p key={`${turns.length - recent.length + index}`} className={turn.role === "user" ? "text-white/80" : ""} style={turn.role === "user" ? undefined : { color: ACCENT }}>
                {turn.text}
              </p>
            ))
          ) : (
            <p className="text-white/55">
              {recordMode ? "Toque no Henry e fale: “quantos clientes aguardam resposta?”" : tapToTalk ? "Pode falar: “quantos clientes aguardam resposta?”" : "Diga “bom dia, Henry” ou “Henry, quantos clientes aguardam resposta?”"}
            </p>
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
              style={TYPING_SELECT}
              className="h-11 flex-1 rounded-full border border-white/15 bg-white/5 px-4 text-base text-white placeholder:text-white/45 focus:border-white/40 focus:outline-none md:h-9 md:text-sm"
            />
            <button type="submit" disabled={busy} className="h-9 rounded-full bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/20 disabled:opacity-50">
              Enviar
            </button>
          </form>
        ) : null}
        <div className="flex items-center gap-2">
          {onToggleVision ? (
            <span className="relative">
              <RoundButton onClick={onToggleVision} label={vision ? "Visão ligada: a câmera só abre no “bom dia” e em “o que é isso?” (clique para desligar)" : "Ligar a visão pela câmera"} dark active={vision}>
                <CameraIcon off={!vision} />
              </RoundButton>
              {capturing ? <CaptureDot className="absolute -right-0.5 -top-0.5" /> : null}
            </span>
          ) : null}
          <RoundButton onClick={onToggleKeyboard} label={showKeyboard ? "Esconder o teclado" : "Digitar a pergunta"} dark active={showKeyboard}>
            <KeyboardIcon />
          </RoundButton>
          <RoundButton onClick={onToggleMute} label={recordMode ? (recording ? "Enviar o que eu falei" : "Tocar para falar") : micOff ? "Ligar o microfone (Alt+B)" : "Mudo (Alt+B)"} dark active={!micOff}>
            <MicIcon off={micOff && !recordMode} />
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
    <button type="button" onPointerDown={preventTouchSelection} onClick={onClick} className={`${base} flex items-center justify-center rounded-full transition ${tone}`} aria-label={label} title={label}>
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

// Indicador "câmera capturando agora" (pulso dourado da paleta do Henry; some quando a câmera desliga).
function CaptureDot({ className = "" }) {
  return (
    <span className={`flex h-3 w-3 ${className}`} aria-label="Câmera capturando" role="status">
      <span className="absolute inline-flex h-3 w-3 animate-ping rounded-full opacity-75 motion-reduce:animate-none" style={{ background: "#F3DCA6" }} />
      <span className="relative inline-flex h-3 w-3 rounded-full" style={{ background: "#F3DCA6" }} />
    </span>
  );
}

// Indicador discreto "em conversa" no ícone do canto (ponto ciano; ele está ouvindo sem precisar do nome).
function ConversationDot() {
  return (
    <span className="absolute bottom-3 right-3 flex h-2.5 w-2.5" role="status" aria-label="Em conversa">
      <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full opacity-60 motion-reduce:animate-none" style={{ background: ACCENT }} />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: ACCENT }} />
    </span>
  );
}

function CameraIcon({ off }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
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
