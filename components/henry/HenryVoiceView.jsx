"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import HenryOrb from "./HenryOrb";
import HenryAnswerScenes from "./HenryAnswerScenes";
import HenryOpeningScene from "./HenryOpeningScene";
import { MORNING_PLAY_LABEL } from "@/lib/henry-morning-core.mjs";
import { HenryBrokerCards, HenryDataScene, HenryDetailPanel, HenryIconSearchHint, HenrySceneStyles } from "./HenrySearchScene";
import HenryMusicScene, { HenryNowPlaying } from "./HenryMusicScene";
import HenryPulse from "./HenryPulse";

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
  searching = false, // pensando/buscando (ícone do canto: arco girando)
  dataScene = searching, // tela cheia: cena de busca (HenrySearchScene) só depois que uma ferramenta foi chamada
  sceneTopic = "geral",
  brokers = [], // corretores do pedido: procurando (scanner) → achado (card com foto e números)
  // Música (dono, 2026-10-23): estado da cena do Spotify (conexão → busca → resultado → play), vindo dos eventos reais, e
  // o "Tocando agora" do player (canto da tela cheia, com as ondas sonoras).
  music = null,
  nowPlaying = null,
  pendingAlerts = 0, // avisos de cliente novo/transferido sem resposta (HENRY-1): indicador discreto; tocar = ouvir
  onPendingAlerts,
  // Botão ▶ "Começar o bom dia" (HENRY-1, dono 2026-10-23): ao lado do microfone só até 11h (quem decide é o
  // HenryVoiceAssistant, por morningPlayWindow). opening = cena de abertura por cima da tela cheia.
  morningPlay = false,
  onMorningPlay,
  opening = false,
  onOpeningDone,
  openingName = "Matheus",
  openingTelemetry = null,
  // Tela de bloqueio (HENRY-LOCK, dono 2026-10-23): lockLayer = risquinhos/cadeados (bloqueado) ou o cadeado aberto do
  // canto (desbloqueado), vindos do HenryVoiceAssistant; locked = sem o "minimizar" e, no celular, conversa mais acima.
  lockLayer = null,
  locked = false,
  // Celular bloqueado (dono, 2026-10-24): teclado numérico aberto → conversa e botões recolhem e o anel encolhe.
  lockKeypadOpen = false,
  // Cena do desbloqueio: a cada valor novo, uma varredura ciano/dourada corre pelo anel e ele dá um pulso leve.
  unlockFx = 0,
  // Modo ambiente (tela bloqueada): só a vitrine passa sorteio fixo e tempo acelerado.
  ambientRandom = null,
  ambientSpeed = 1,
  // Pulso do CRM (rascunho HENRY-1 "Pulso"): config do HenryPulse (null = desligado), abrir o link do card e, só na
  // vitrine, a fonte de eventos de exemplo.
  pulse = null,
  onPulseOpen = null,
  alertList = [], // avisos lidos pelo Henry (canto esquerdo; no celular, no topo)
  onDetailConfirm = null, // botão de confirmação do painel (aviso de aniversariante ao corretor, dono 2026-10-24)
  pulsePoll = undefined,
  fixed = true
}) {
  const orbSize = useFullscreenOrbSize(expanded, mobile);
  // Pulso do CRM: a chegada de um evento vira "level" do anel REAL (o maior entre a voz e o pulso), sem anel paralelo.
  const pulseLevelRef = useRef(0);
  const pulseHitsRef = useRef([]); // trechos do anel que acendem onde o card entrou (HenryOrb, signal.hits)
  const pulseBusyRef = useRef(false); // há card do Pulso na tela (o anel não cai para o ritmo ocioso)
  // Bom dia novo (protótipo v22): no boom o anel acorda com um pulso de fala curto (~0,9 s) e, enquanto a mensagem
  // "Bom dia" está no meio do anel (a cena de abertura aberta), as ondas vocais não são desenhadas (noVoice).
  const wakeUntilRef = useRef(0);
  const unlockPulseRef = useRef(0);
  // Desbloqueou: os cards inventados do modo ambiente ainda voltam ao anel (~2 s) antes do Pulso desligar.
  const [ambientTail, setAmbientTail] = useState(false);
  const wasLockedRef = useRef(locked);
  useEffect(() => {
    const was = wasLockedRef.current;
    wasLockedRef.current = locked;
    if (!was || locked) return undefined;
    setAmbientTail(true);
    const timer = window.setTimeout(() => setAmbientTail(false), 2600);
    return () => window.clearTimeout(timer);
  }, [locked]);
  const [unlockSweep, setUnlockSweep] = useState(0);
  useEffect(() => {
    if (!unlockFx) return undefined;
    setUnlockSweep(unlockFx);
    unlockPulseRef.current = performance.now() + UNLOCK_PULSE_MS; // pulso leve do anel (orbSignal)
    const timer = window.setTimeout(() => setUnlockSweep(0), 900);
    return () => window.clearTimeout(timer);
  }, [unlockFx]);
  const openingRef = useRef(opening);
  openingRef.current = opening;
  const orbSignal = useCallback(() => {
    let signal = getSignal?.() || { mode: "idle", level: 0 };
    if (performance.now() < wakeUntilRef.current) signal = { ...signal, mode: "speaking", level: Math.max(Number(signal.level) || 0, 0.6) };
    // Desbloqueio: pulso LEVE que se desfaz em ~0,8 s, sem trocar o estado do anel.
    const unlockLeft = unlockPulseRef.current - performance.now();
    if (unlockLeft > 0) signal = { ...signal, level: Math.max(Number(signal.level) || 0, 0.32 * (unlockLeft / UNLOCK_PULSE_MS)) };
    if (openingRef.current) signal = { ...signal, noVoice: true };
    const extra = pulseLevelRef.current || 0;
    const hits = pulseHitsRef.current;
    const pulseBusy = pulseBusyRef.current; // cards do Pulso na tela: o anel não cai para o ritmo ocioso
    if (extra <= 0.005 && !hits.length && !pulseBusy) return signal;
    return { ...signal, level: Math.max(Number(signal.level) || 0, extra), hits, pulseBusy };
  }, [getSignal]);
  const inputRef = useRef(null);
  const touchRef = useRef(null);
  useEffect(() => {
    if (expanded && showKeyboard) inputRef.current?.focus();
  }, [expanded, showKeyboard]);

  const foundBroker = [...brokers].reverse().find((broker) => broker.found) || null;
  const lastAssistant = [...turns].reverse().find((turn) => turn?.role === "assistant");
  const detail = !searching && lastAssistant?.detail ? lastAssistant.detail : null;
  // Cena da resposta (HenryAnswerScenes): a da última resposta enquanto ela for a última fala da tela; antes de qualquer
  // resposta e enquanto pensa sem ferramenta (papo), as ondas da conversa.
  const lastTurn = turns[turns.length - 1];
  const answer = !searching && lastTurn?.role === "assistant" ? lastTurn : null;
  // Pedido de música nunca mostra cena de números (dono, 2026-10-23: "os gráficos também não fazem sentido").
  const musicScene = searching && sceneTopic === "music" ? music : answer?.scene?.kind === "musica" ? music || answer.scene.music || { stage: "playing" } : null;
  const showDataScene = dataScene && sceneTopic !== "music";

  const showPlay = morningPlay && Boolean(onMorningPlay) && !opening;
  const pendingPill = pendingAlerts > 0 && onPendingAlerts ? (
    <button
      type="button"
      onClick={onPendingAlerts}
      className="pointer-events-auto mb-2.5 shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold shadow-float ring-1 ring-white/10"
      style={{ background: BACKDROP, color: ACCENT }}
      aria-label={`Ouvir ${pendingAlerts === 1 ? "o aviso pendente" : `os ${pendingAlerts} avisos pendentes`} do Henry`}
    >
      Aviso pendente ({pendingAlerts})
    </button>
  ) : null;

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
            <HenryOrb size={MOBILE_BIG} fibers={18} points={48} alpha={0.45} lineWidth={0.8} nodes={6} getSignal={getSignal} sleep={sleeping && !engaged} />
            {inConversation ? <ConversationDot /> : null}
          </button>
          <HenrySceneStyles />
          <HenryIconSearchHint searching={searching} broker={foundBroker} size={box} />
          <ThinkingStatus searching={searching} />
        </div>
        {!tapToTalk ? (
          <span className="pointer-events-auto mb-1.5">
            <RoundButton onClick={onToggleMute} label={micOff ? "Ligar o microfone do Henry" : "Deixar o Henry no mudo"} small>
              <MicIcon off={micOff} />
            </RoundButton>
          </span>
        ) : null}
        {showPlay ? (
          <span className="pointer-events-auto mb-1.5">
            <PlayButton onClick={onMorningPlay} />
          </span>
        ) : null}
        {pendingPill}
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
        {pendingPill}
        {showPlay ? (
          <span className="pointer-events-auto mb-2.5">
            <PlayButton onClick={onMorningPlay} />
          </span>
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
            <HenryOrb size={ICON_BIG} fibers={24} points={60} alpha={0.42} lineWidth={0.8} nodes={7} getSignal={getSignal} sleep={sleeping && !engaged} />
            {capturing ? <CaptureDot className="absolute right-3 top-3" /> : null}
            {inConversation ? <ConversationDot /> : null}
          </button>
          <HenrySceneStyles />
          <HenryIconSearchHint searching={searching} broker={foundBroker} size={box} />
          <ThinkingStatus searching={searching} />
        </div>
      </div>
    );
  }

  // Celular bloqueado: a fileira da senha fica SOZINHA embaixo, na mesma pilha do rodapé (nada se sobrepõe); acima dela só
  // as 2 últimas falas e os botões essenciais (teclado e microfone). Câmera e ▶ somem enquanto bloqueado (o ▶ do bom dia
  // e a câmera dependem do desbloqueio). Teclado numérico aberto: só ele e a fileira, com o anel menor.
  const lockedMobile = Boolean(locked && mobile && lockLayer);
  const keypadFocus = lockedMobile && lockKeypadOpen;
  const recent = turns.slice(lockedMobile ? -2 : -VISIBLE_TURNS);
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
      <style>{UNLOCK_SWEEP_CSS}</style>
      {opening ? <HenryOpeningScene name={openingName} mobile={mobile} orbSize={orbSize} onBoom={() => (wakeUntilRef.current = performance.now() + 900)} onDone={onOpeningDone} /> : null}
      <HenryDataScene active={showDataScene} topic={sceneTopic} mobile={mobile} orbSize={orbSize} hasBrokers={brokers.length > 0} />
      {!showDataScene && !musicScene ? (
        <HenryAnswerScenes
          kind={answer?.scene?.kind || "conversa"}
          scene={answer?.scene || null}
          text={answer?.text || ""}
          detail={answer?.detail || null}
          hasBrokers={brokers.length > 0}
          mobile={mobile}
          orbSize={orbSize}
          getSignal={getSignal}
          sceneKey={answer ? `a${turns.length}` : "idle"}
        />
      ) : null}
      {!mobile ? <HenryDetailPanel detail={detail} onConfirm={onDetailConfirm} /> : null}
      <HenryNowPlaying nowPlaying={nowPlaying} ducking={speaking} mobile={mobile} />
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
      {lockedMobile ? null : lockLayer}
      {locked ? null : <button
        type="button"
        onClick={onMinimize}
        className="absolute right-4 top-[calc(0.75rem+env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white md:right-6 md:top-5 md:h-9 md:w-9"
        aria-label="Minimizar o Henry (Esc)"
        title="Minimizar (Esc)"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>}

      <HenryAlertList items={alertList} mobile={mobile} />
      {/* Pulso do CRM: atrás do anel (cards e feixes em volta dele); apagado quando ele pensa ou fala. */}
      {/* Modo ambiente (tela bloqueada): o Pulso também roda sem a configuração ligada, só com cards inventados no navegador. */}
      <HenryPulse active={(Boolean(pulse) || locked || ambientTail) && !opening} ambient={locked} realEvents={Boolean(pulse)} ambientRandom={ambientRandom} ambientSpeed={ambientSpeed} idle={!engaged && !opening && !alertList.length && !musicScene && !brokers.length} config={pulse || undefined} orbSize={orbSize} mobile={mobile} dim={searching || speaking || busy} onOpen={onPulseOpen} levelRef={pulseLevelRef} hitsRef={pulseHitsRef} busyRef={pulseBusyRef} {...(pulsePoll ? { poll: pulsePoll } : {})} />
      <div className={`relative transition-transform duration-300 ease-out motion-reduce:transition-none ${mobile ? (keypadFocus ? "-translate-y-[14vh] scale-[0.72]" : "-translate-y-[14vh]") : ""}`}>
        {onTalk ? (
          <button type="button" onPointerDown={preventTouchSelection} onClick={onTalk} className="block rounded-full" aria-label={recording ? "Enviar o que eu falei" : "Tocar para falar com o Henry"}>
            <HenryOrb size={orbSize} fibers={mobile ? 40 : 52} points={mobile ? 110 : 140} alpha={0.3} lineWidth={0.85} glow nodes={mobile ? 16 : 24} getSignal={orbSignal} />
          </button>
        ) : (
          <HenryOrb size={orbSize} fibers={mobile ? 40 : 52} points={mobile ? 110 : 140} alpha={0.3} lineWidth={0.85} glow nodes={mobile ? 16 : 24} getSignal={orbSignal} />
        )}
        {unlockSweep ? <span key={unlockSweep} className="henry-unlock-sweep pointer-events-none absolute inset-0 rounded-full" aria-hidden="true" /> : null}
        <HenryBrokerCards brokers={brokers} orbSize={orbSize} mobile={mobile} />
        <HenryMusicScene music={musicScene} orbSize={orbSize} mobile={mobile} />
      </div>

      <div className="absolute inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] flex flex-col items-end gap-3 md:inset-x-auto md:bottom-6 md:right-8 md:w-[min(420px,40vw)]">
        {/* Texto sem card (dono, 2026-10-22): só as palavras sobre a cena, com sombra para ler (iPhone incluso). */}
        <div
          className={`${keypadFocus ? "hidden" : "flex"} ${lockedMobile ? "max-h-[18vh]" : "max-h-[30vh]"} w-full flex-col items-end gap-1.5 overflow-y-auto text-right text-[14px] leading-snug md:max-h-none md:overflow-visible md:text-[13px]`}
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.95), 0 0 10px rgba(7,17,31,0.95), 0 0 22px rgba(7,17,31,0.85)" }}
        >
          {mobile ? <HenryDetailPanel detail={detail} mobile onConfirm={onDetailConfirm} /> : null}
          {recent.length ? (
            recent.map((turn, index) => (
              <p key={`${turns.length - recent.length + index}`} className={turn.role === "user" ? "text-white/80" : ""} style={turn.role === "user" ? undefined : { color: ACCENT }}>
                {turn.text}
              </p>
            ))
          ) : lockedMobile ? null : (
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
        <div className={`${keypadFocus ? "hidden" : "flex"} items-center gap-2`}>
          {onToggleVision && !lockedMobile ? (
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
          {showPlay && !lockedMobile ? <PlayButton onClick={onMorningPlay} dark /> : null}
        </div>
        {lockedMobile ? <div className="w-full pb-1 pt-4">{lockLayer}</div> : null}
      </div>
    </div>
  );
}

// Avisos lidos pelo Henry (dono, 2026-10-23, protótipo v22): bem no canto esquerdo (no celular, no topo), sem fundo, só a
// escrita — tipo pequeno e colorido, texto branco embaixo. Cada aviso entra quando ele começa a falá-lo; o anterior apaga
// (0,45). Itens vêm do servidor (só o que ele fala).
function HenryAlertList({ items = [], mobile = false }) {
  if (!items.length) return null;
  return (
    <div
      className={`pointer-events-none absolute flex flex-col text-left ${mobile ? "inset-x-4 top-[84px] gap-3" : "left-8 top-1/2 w-[min(360px,30vw)] -translate-y-1/2 gap-[18px]"}`}
      style={{ textShadow: "0 1px 2px rgba(0,0,0,0.95), 0 0 10px rgba(7,17,31,0.95), 0 0 22px rgba(7,17,31,0.85)" }}
      aria-live="polite"
      data-henry-alert-list
    >
      <style>{ALERT_LIST_CSS}</style>
      {items.map((item) => (
        <div key={item.id} className={item.read ? "henry-avl-read" : "henry-avl-in"}>
          <p className="m-0 text-[10.5px] font-extrabold uppercase tracking-[0.16em]" style={{ color: item.color || "#e8b85c" }}>
            {item.kicker}
          </p>
          <p className={`m-0 mt-1 font-semibold leading-[1.4] text-white ${mobile ? "text-[14px]" : "text-[15px]"}`}>{item.text}</p>
        </div>
      ))}
    </div>
  );
}
const ALERT_LIST_CSS = `
.henry-avl-in{opacity:0;transform:translateX(-14px);filter:blur(6px);animation:henry-avl-in 700ms cubic-bezier(0.2,0.8,0.2,1) forwards}
.henry-avl-read{opacity:.45;transition:opacity 600ms ease}
@keyframes henry-avl-in{to{opacity:1;transform:none;filter:blur(0)}}
@media (prefers-reduced-motion: reduce){.henry-avl-in{animation:none;opacity:1;transform:none;filter:none}}
`;

// Varredura do desbloqueio (dono, 2026-10-24): um arco ciano → dourado corre uma volta pelo anel e some. Só o anel
// (máscara em anel na altura dos fios do HenryOrb, ~0,3 do tamanho). prefers-reduced-motion: não aparece.
const UNLOCK_PULSE_MS = 800;
const UNLOCK_SWEEP_CSS = `
@keyframes henryUnlockSweep { 0% { transform: rotate(-90deg); opacity: 0 } 12% { opacity: 1 } 80% { opacity: 1 } 100% { transform: rotate(270deg); opacity: 0 } }
.henry-unlock-sweep { background: conic-gradient(from 0deg, transparent 0 62%, rgba(79,195,224,0.15) 72%, rgba(79,195,224,0.95) 88%, rgba(232,184,92,1) 97%, transparent 100%); -webkit-mask: radial-gradient(circle closest-side, transparent 0 54%, #000 57% 65%, transparent 68%); mask: radial-gradient(circle closest-side, transparent 0 54%, #000 57% 65%, transparent 68%); animation: henryUnlockSweep 760ms cubic-bezier(.4,0,.2,1) forwards; mix-blend-mode: screen }
@media (prefers-reduced-motion: reduce) { .henry-unlock-sweep { display: none } }
`;

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

// ▶ dourado (cor de destaque da marca): plano B do "bom dia, Henry" quando a automação não dispara.
function PlayButton({ onClick, dark = false }) {
  return (
    <button
      type="button"
      onPointerDown={preventTouchSelection}
      onClick={onClick}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition ${dark ? "border border-[#E8B85C]/60 bg-[#E8B85C]/15 hover:bg-[#E8B85C]/25" : "shadow-float ring-1 ring-white/10 hover:ring-[#E8B85C]/60"}`}
      style={{ background: dark ? undefined : BACKDROP, color: "#E8B85C" }}
      aria-label={MORNING_PLAY_LABEL}
      title={MORNING_PLAY_LABEL}
      data-henry-morning-play
    >
      <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4" fill="currentColor" aria-hidden="true">
        <path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.4-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5z" />
      </svg>
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

// Leitor de tela: o anel mostra "pensando" pela rede neural; aqui o mesmo estado em texto (invisível na tela).
function ThinkingStatus({ searching }) {
  return (
    <span className="sr-only" role="status" aria-live="polite">
      {searching ? "Henry pensando…" : ""}
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
