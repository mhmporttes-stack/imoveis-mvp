"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { detectWakeWord, isVisualQuestion } from "@/lib/henry-voice-core.mjs";
import { shouldMinimizeForNavigation } from "@/lib/henry-navigation-core.mjs";
import { henryPulseConfig } from "@/lib/henry-pulse-core.mjs";
import {
  BARGE_DUCK_VOLUME,
  BARGE_SEGMENT_MAX_MS,
  BARGE_SEGMENT_MIN_MS,
  HENRY_END_WAIT_EVENT,
  RECORD_CONTINUE_NO_SPEECH_MS,
  RECORD_MAX_MS,
  RECORD_MIN_MS,
  RECORD_SILENCE_MS,
  interimFinalWaitMs,
  joinCutTranscripts,
  recordVoiceThreshold,
  shouldContinueAfterCut,
  acceptFollowUp,
  classifyArmedUtterance,
  classifyOpenSceneUtterance,
  classifyTapUtterance,
  emptyInterimState,
  forceInterimFinal,
  henryCaptureMode,
  henryListenMode,
  pickRecorderMimeType,
  recordingDecision,
  takeFinalResult,
  trackInterim,
  shouldRunRecognition,
  silentWavDataUri,
  conversationHistory,
  detectBargeIn,
  detectSpeechBargeIn,
  floatToWavBytes,
  henryBargeMode,
  micVoiceSustained,
  shouldRestoreVolume,
  henryCaption as captionFor,
  isConversationEnd,
  isConversationExpired,
  isEchoOf,
  isStopCommand,
  nextRestartDelay,
  MUSIC_DUCK_SAFETY_MS,
  detectMusicBargeIn,
  isMusicGuardActive,
  isMusicPauseCommand,
  musicListenGate,
  HENRY_REPLY_WINDOW_MS,
  henryAsksQuestion,
  isAwaitingReply,
  openPendingReply,
  repeatQuestionFor,
  RECORD_START_GRACE_MS,
  RECORD_VOICE_CONFIRM_TICKS,
  SPONTANEOUS_MAX_AGE_MS,
  canSpeakSpontaneously,
  henryLatencyBreakdown,
  recordLevelThreshold,
  triggeredTranscriptIntent
} from "@/lib/henry-voice-conversation.mjs";
import { henryReserveVoiceChain, pickBestBrowserVoice, pronounceForSpeech, splitSentences } from "@/lib/henry-voice-providers.mjs";
import { HENRY_WAIT_PHRASES, MUSIC_TOPIC, ackToneDurationMs, henryAckContext, henryMusicIntent, isAckPhrase, mergeHenryMusic, musicQueryFromText, narrationWarmBatches, normalizeHenryScene, pickListenAck, pickWaitPhrase, rememberPhrase, shouldAcknowledgeHeard, shouldNarrate, spotifyDeviceRequestKind, waitPhrasesToSynthesize } from "@/lib/henry-voice-narration.mjs";
import { HENRY_LISTEN_PROMPTS, pickVariant, rememberVariant } from "@/lib/henry-voice-persona.mjs";
import {
  ALERT_ANSWER_WAIT_MS,
  ALERT_MAX_CALLS,
  ALERT_MAX_RETRIES,
  ALERT_POLL_MS,
  ALERT_RETRY_MS,
  addAlertSeen,
  classifyAlertAnswer,
  isAlertHour,
  mergeAlertPending,
  pickAlertPhrase,
  pruneAlertPending,
  HENRY_NOTICE_DONE_EVENT,
  HENRY_NOTICE_ITEMS_EVENT,
  HENRY_VOICE_NOTICES_EVENT,
  isReadAlertsCommand,
  noticePendingItems
} from "@/lib/henry-voice-client-alerts-core.mjs";
import { saoPauloNow } from "@/lib/alexa-config-core.mjs";
import { morningPlayRequest, morningPlayWindow } from "@/lib/henry-morning-core.mjs";
import { setHenryFullscreenOpen } from "@/lib/henry-fullscreen-signal.mjs";
import {
  DESKTOP_WAKE_EVENT,
  DESKTOP_WAKE_STATUS_EVENT,
  chunkForLocalVoice,
  desktopCanSpeakLocal,
  desktopCanWake,
  detectScreenCommand,
  readDesktopWakeSetting,
  readDesktopWakeWord,
  readHenryDesktopBridge,
  shouldHandleDesktopWake
} from "@/lib/henry-desktop-core.mjs";
import HenryVoiceView from "./HenryVoiceView";
import { henryOrbMode, thinkingActivity } from "./henry-orb-states.mjs";
import HenryCursor from "./HenryCursor";
import { playHenryOpeningSound } from "./HenryOpeningScene";
import { captureWebcamFrame } from "./webcam-capture";
import { HENRY_VAD_BARGE_OPTIONS, HENRY_VAD_RECORD_OPTIONS, createHenryVad } from "./henry-vad";

// Assistente de voz "Henry" (pedido do dono, 2026-10-22 — docs/BUSINESS_RULES.md HENRY-1). Montado no layout do painel só
// para o DONO (conta real, fora de "Alterar conta"); a rota /api/admin/henry confere de novo. Só no computador (≥ 768px).
// Mãos livres: o Chrome escuta o tempo todo (Web Speech API, pt-BR) e só o que vem DEPOIS do nome "Henry" vira pergunta —
// o resto é descartado aqui mesmo, nunca vai ao servidor. Ícone pequeno no canto; clique abre a tela cheia; Esc minimiza.
// A conversa continua ao trocar de tela (o layout não desmonta). Alt+B liga/desliga o microfone (mudo).
// Sempre ativo (dono, 2026-10-22): a escuta liga sozinha ao abrir o painel; o som de saída é destravado no primeiro clique
// ou tecla em qualquer lugar. Chamado/em conversa → o ícone do canto dobra de tamanho com legenda; clique → tela cheia.
// Modo conversa (dono, 2026-10-22): depois da 1ª chamada ele segue ouvindo sem o nome até ~40 s de silêncio ou
// "obrigado, Henry"/"pode parar"/"tchau"; falando ou pensando, só o nome e "para/espera/pera/chega" valem (corta na hora e
// cancela o pedido). Memória das últimas ~6 trocas só nesta página (zerada ao sair do modo conversa). Regras puras em
// lib/henry-voice-conversation.mjs.
// Celular sem reconhecimento de voz (app instalado no iPhone) ou com reconhecimento que falhou: TOCAR PARA FALAR por
// gravação — toque no anel/microfone grava (MediaRecorder), para no toque ou sozinho depois do "Tempo de espera do fim da
// fala" de silêncio contínuo (padrão 2,0 s; resposta curta a uma pergunta dele, 1,2 s; máx. 25 s — dono, 2026-10-23), com
// histerese (VAD Silero no app de desktop; nível menor depois de ouvir voz). Frase cortada/vazia depois de um corte
// automático: continua ouvindo e junta o trecho seguinte, uma vez (nunca "Não entendi"). O servidor transcreve
// (ElevenLabs Scribe) e o texto segue o caminho normal. O áudio não fica guardado em lugar nenhum.
// Sem silêncio enquanto pensa (dono, 2026-10-22): frases de espera curtas NA VOZ DO HENRY (cache da sessão, mesma fila e
// mesmo elemento de áudio da resposta), depois de ~0,8 s, no máximo 1 a cada ~2,5 s, sem repetir as últimas 5; a resposta
// entra quando a frase atual termina. Sem voz do servidor: silêncio (nunca a voz do navegador). A cena mostra a busca.

const MUTE_KEY = "mm_henry_muted";
// Avisos de cliente novo/transferido (HENRY-1, dono 2026-10-23): estado no navegador, dividido entre as abas do mesmo
// aparelho (só a aba "líder" consulta e fala). Nada disso vai para o banco.
const ALERT_STORE_KEY = "mm-henry-alerts";
const ALERT_LEADER_KEY = "mm-henry-alerts-leader";
const ALERT_LEADER_MS = 70000;
const ALERT_HOLD_POLL_MS = 15000;
const ALERT_OFFER_GAP_MS = 3 * 60 * 1000; // "E aquele aviso, posso falar?" no máximo a cada 3 min

function readAlertStore() {
  try {
    const value = JSON.parse(window.localStorage.getItem(ALERT_STORE_KEY) || "null");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeAlertStore(patch) {
  const next = { ...readAlertStore(), ...patch };
  try {
    window.localStorage.setItem(ALERT_STORE_KEY, JSON.stringify(next));
  } catch {
    // armazenamento cheio/bloqueado: o aviso segue só nesta página
  }
  return next;
}

// Uma aba por aparelho consulta e fala (a mais recente que pegou a vez; a outra assume se esta fechar).
function claimAlertLeader(tabId) {
  try {
    const current = JSON.parse(window.localStorage.getItem(ALERT_LEADER_KEY) || "null");
    if (current?.tab && current.tab !== tabId && Date.now() - Number(current.at || 0) < ALERT_LEADER_MS) return false;
    window.localStorage.setItem(ALERT_LEADER_KEY, JSON.stringify({ tab: tabId, at: Date.now() }));
    return true;
  } catch {
    return true;
  }
}
const IDLE_SLEEP_MS = 30000;

// Diagnóstico (dono, 2026-10-23: "ouve e não responde", "demora muito"): motivo de cada transcrição descartada e tempos
// de cada etapa, só no console do navegador e num contador da página (window.__henryDebug). Nunca o texto nem o áudio.
function henryDebug(event, data = {}) {
  try {
    const store = (window.__henryDebug ||= { discards: {}, timings: [] });
    if (event === "descarte" && data.reason) store.discards[data.reason] = (store.discards[data.reason] || 0) + 1;
    if (event === "tempos") store.timings = [...store.timings, { at: Date.now(), ...data }].slice(-20);
    console.info(`[henry] ${event}`, data);
  } catch {
    // console indisponível: segue
  }
}

// Dia de São Paulo (chave das frases de espera já usadas hoje).
const todayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
// Frases de espera/despedida já faladas HOJE neste aparelho (dono, 2026-10-23: "vocabulário muito repetitivo"): nenhuma
// se repete no dia até o banco do assunto acabar (só os ids, nada da conversa).
const USED_WAITS_KEY = "mm-henry-wait-used";
function readUsedWaits() {
  try {
    const value = JSON.parse(window.localStorage.getItem(USED_WAITS_KEY) || "null");
    return value?.day === todayKey() && Array.isArray(value.ids) ? value.ids : [];
  } catch {
    return [];
  }
}
function rememberUsedWait(id) {
  try {
    window.localStorage.setItem(USED_WAITS_KEY, JSON.stringify({ day: todayKey(), ids: [...readUsedWaits().filter((item) => item !== id), id].slice(-120) }));
  } catch {
    // armazenamento cheio: vale só a memória da página
  }
}
// Frases de espera usadas hoje, em ordem (a última = a mais recente): o que ficou no aparelho + o que esta página falou.
function usedWaitsInOrder(pageIds = []) {
  return pageIds.reduce((list, id) => rememberPhrase(list, id, 200), readUsedWaits());
}
const MUSIC_FINAL_STAGES = new Set(["playing", "error", "control", "device", "opening"]);
const meterBuffer = typeof Uint8Array === "undefined" ? null : new Uint8Array(1024);

// Blob da gravação → data URL (só na memória; vai no corpo do pedido e é descartado).
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("leitura do áudio falhou"));
    reader.readAsDataURL(blob);
  });
}

function getRecognitionClass() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function levelFrom(analyser, buffer) {
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    const value = (buffer[index] - 128) / 128;
    sum += value * value;
  }
  return Math.min(1, Math.sqrt(sum / buffer.length) * 4);
}

export default function HenryVoiceAssistant() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [mobileWake, setMobileWake] = useState(false);
  const [alertsOn, setAlertsOn] = useState(false);
  // "Avisos só por voz (sem card na tela)" (dono, 2026-10-23; nasce ligado): os informativos da Central viram aviso do Henry.
  const [voiceNotices, setVoiceNotices] = useState(false);
  // Pulso do CRM (rascunho HENRY-1 "Pulso"): config do HenryPulse com a configuração salva; null = desligado (nasce assim).
  const [pulseConfig, setPulseConfig] = useState(null);
  const [pendingAlerts, setPendingAlerts] = useState(0);
  // stage: idle | calling (falando o vocativo) | waiting (microfone aberto, esperando "pode falar") | telling (falando a
  // informação). afterAsk = uma pergunta normal está em andamento (ao terminar, oferece o aviso pendente).
  const alertRef = useRef({ stage: "idle", calls: 0, timer: null, afterAsk: false, offer: false, deviceActive: false, nextPollAt: 0 });
  const alertAnswerRef = useRef(() => false);
  const tabIdRef = useRef("");
  if (!tabIdRef.current) tabIdRef.current = `t${Math.random().toString(36).slice(2, 10)}`;
  const desktopRef = useRef(false);
  desktopRef.current = desktop;
  const meterActiveRef = useRef(false);
  const [supported, setSupported] = useState(true);
  const [muted, setMuted] = useState(false);
  const [micState, setMicState] = useState("idle"); // idle | listening | blocked
  const [phase, setPhase] = useState("idle"); // idle | armed | thinking | speaking
  const [expanded, setExpanded] = useState(false);
  const [turns, setTurns] = useState([]);
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState("");
  // Última frase que o reconhecimento entendeu (só na tela, por alguns segundos; nada é gravado) — ajuda a ver por que o
  // nome não foi reconhecido (dono, 2026-10-22: "Ouvindo", mas não reage).
  const [heard, setHeard] = useState({ text: "", at: 0, accepted: false });

  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(false);
  const phaseRef = useRef("idle");
  const turnsRef = useRef([]);
  const lastReplyRef = useRef("");
  const audioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const micAnalyserRef = useRef(null);
  const outAnalyserRef = useRef(null);
  const outSourceRef = useRef(null); // voz do Henry → medidor do anel (captureStream, sem ir ao alto-falante)
  const micStreamRef = useRef(null);
  const micMeterAnalyserRef = useRef(null);
  // Interrupção (dono, 2026-10-23): frase que está tocando, volume abaixado ("ducking") e detector de voz local (VAD).
  const currentClipRef = useRef({ text: "", prevText: "", startedAt: 0 });
  const duckRef = useRef({ ducked: false, lastVoiceAt: 0, waitingSince: 0 });
  const vadRef = useRef({ instance: null, loading: false, failed: false, running: false, speaking: false, lastAt: 0 });
  const micLoudAtRef = useRef(0);
  const bargeBusyRef = useRef(false);
  const askRef = useRef(null);
  const lastHeardRef = useRef(0);
  const lastActivityRef = useRef(Date.now());
  const expandedRef = useRef(false);
  const [sleeping, setSleeping] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [vision, setVision] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const visionRef = useRef(false);
  const browserRateRef = useRef(1); // velocidade escolhida em "Voz e personalidade" (só a voz do navegador usa)
  const [inConversation, setInConversation] = useState(false);
  const conversationRef = useRef({ active: false, lastAt: 0, historyStart: 0 });
  const abortRef = useRef(null); // pedido em andamento (cancelado ao interromper)
  // Bom dia em conversa (dono, 2026-10-23): passo que espera a resposta do dono ("music" → "style" → "birthday"). Vale só
  // dentro da janela de conversa (40 s); qualquer pergunta o consome; o servidor decide o resto.
  const morningRef = useRef(null);
  const webSourceRef = useRef(null); // voz tocando pelo AudioContext (celular)
  const soundRetryRef = useRef(false);
  // Id aleatório deste navegador (só para "um aparelho por vez"; nada identifica o aparelho).
  const deviceIdRef = useRef("");
  if (!deviceIdRef.current && typeof window !== "undefined") {
    try {
      deviceIdRef.current = window.localStorage.getItem("mm-henry-device") || `d${Math.random().toString(36).slice(2, 12)}`;
      window.localStorage.setItem("mm-henry-device", deviceIdRef.current);
    } catch {
      deviceIdRef.current = `d${Math.random().toString(36).slice(2, 12)}`;
    }
  } // esperando o toque que libera o som (esse toque não interrompe a fala)
  const requestIdRef = useRef(0);
  // Tocar para falar por gravação (celular sem reconhecimento de voz): sessão de gravação em andamento.
  const recordRef = useRef(null);
  const recordModeRef = useRef(false);
  const warmedAtRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const [recordHeard, setRecordHeard] = useState(false); // já ouviu voz nesta gravação: "pode continuar"
  const endWaitMsRef = useRef(RECORD_SILENCE_MS); // "Tempo de espera do fim da fala" (Voz e personalidade)
  const [hasRecorder, setHasRecorder] = useState(false);
  const [recognitionFailed, setRecognitionFailed] = useState(false);
  const [iosStandalone, setIosStandalone] = useState(false);
  // App de desktop do dono (desktop-app/, dono 2026-10-23): ponte window.mmDesktop (lista fechada de ações locais). Fora
  // do app fica null e nada muda.
  const [desktopApp, setDesktopApp] = useState(false);
  const desktopBridgeRef = useRef(null);
  const speechQueueRef = useRef({ clips: [], playing: false, done: true });
  const mutedRef = useRef(false);
  // Narração e cena de busca: frases da sessão (voz do Henry), espera do pedido atual e o que a cena mostra.
  const narrationKeyRef = useRef("");
  const narrationRef = useRef({ key: "", phrases: [], loading: false });
  const narrationPendingRef = useRef(new Set()); // ids pedidos ao servidor e ainda sem resposta (nunca pede duas vezes)
  const narrationWarmingRef = useRef(false);
  const narrationActiveRef = useRef(false);
  const waitRef = useRef({ id: 0, startedAt: 0, replied: true, topic: "geral", lastAt: 0, names: [] });
  // Eventos de progresso do pedido atual (rede neural do anel: mais atividade a cada etapa; zera ao começar a pensar).
  const progressRef = useRef({ count: 0, at: 0 });
  const recentPhrasesRef = useRef([]);
  const narratingTextRef = useRef("");
  // Confirmação de escuta (dono, 2026-10-23): liga/desliga "Confirmar que ouviu", último item (nunca repete seguido), fim
  // da última (a frase de espera espera ~2,5 s depois dela) e se a gravação já confirmou antes da transcrição.
  const listenAckRef = useRef(true);
  const ackRef = useRef({ lastId: "", endedAt: 0, preAcked: false });
  // live = já houve ferramenta (ou é o "bom dia"): só então a cena de busca entra; antes disso, as ondas da conversa.
  const [scene, setScene] = useState({ topic: "geral", label: "", brokers: [], live: false });
  // Música (dono, 2026-10-23): cena do Spotify do pedido atual (eventos reais do stream) e "Tocando agora" do player.
  const [music, setMusic] = useState(null);
  const musicRef = useRef(null);
  const deferredTopicRef = useRef(""); // assunto de dados que chegou durante a cena da música (pedido composto)
  const updateMusic = useCallback((next) => {
    const merged = next === null ? null : mergeHenryMusic(musicRef.current, next);
    musicRef.current = merged;
    setMusic(merged);
  }, []);
  const [nowPlaying, setNowPlaying] = useState(null);
  // Música tocando = player `is_playing` OU marcador local logo depois de um play do Henry (o player demora a refletir).
  // explicitUntil = o dono acabou de chamar (onWake do app/atalho): a próxima frase vale sem o nome, menos letra de música.
  const musicGuardRef = useRef({ playerPlaying: false, playedAt: 0, explicitUntil: 0 });
  const musicPlaying = useCallback(() => isMusicGuardActive(musicGuardRef.current), []);
  const markMusicPlayed = useCallback(() => {
    musicGuardRef.current = { ...musicGuardRef.current, playedAt: Date.now() };
  }, []);
  // Pergunta aberta do Henry (dono, 2026-10-23): ele perguntou e espera a resposta — a resposta curta vale sem o nome
  // mesmo com música (isAwaitingReply/musicListenGate), a música fica baixa na espera e, se a resposta não vier, ele
  // repete a pergunta curta uma vez (repeatQuestionFor) em vez de "Não entendi".
  const pendingReplyRef = useRef({ active: false });
  const missedReplyRef = useRef(() => false);
  // Volume do Spotify baixo enquanto ele escuta/responde: previous = volume guardado; keep = não restaurar ("pausa"/volume).
  const spotifyDuckRef = useRef({ previous: null, pending: false, keep: false, timer: 0 });
  const [navRequest, setNavRequest] = useState(null);
  // Ouviu "Henry" no parcial: o ícone já dobra de tamanho, mesmo minimizado (dono, 2026-10-22), antes da frase terminar.
  const [calling, setCalling] = useState(false);
  const callingTimerRef = useRef(null);
  const markCalling = useCallback(() => {
    setCalling(true);
    window.clearTimeout(callingTimerRef.current);
    callingTimerRef.current = window.setTimeout(() => setCalling(false), 6000);
  }, []);
  // "Pode falar…" variado (sorteado a cada vez que ele passa a esperar a pergunta, sem repetir os últimos 5).
  const [listenPrompt, setListenPrompt] = useState(HENRY_LISTEN_PROMPTS[0]);
  const listenPromptsRef = useRef([]);
  useEffect(() => {
    if (phase !== "armed") return;
    const next = pickVariant(HENRY_LISTEN_PROMPTS, listenPromptsRef.current);
    listenPromptsRef.current = rememberVariant(listenPromptsRef.current, next);
    setListenPrompt(next);
  }, [phase]);

  // Marcas de tempo do pedido atual (fim da fala → transcrição → resposta → 1º áudio → começou a tocar), só números.
  const latencyRef = useRef({});
  // Última atividade (fala dele, pedido, gravação): fala espontânea só depois de ~3 s de calma (canSpeakSpontaneously).
  const busyAtRef = useRef(0);
  const spontaneousRef = useRef([]);
  // Fila da fala espontânea (dono, 2026-10-23: "do nada ele corta e começa a falar outra coisa"): nada interrompe uma
  // fala dele nem a escuta da resposta do dono. kind repetido substitui o anterior; allowAwaiting = continuação da MESMA
  // pergunta aberta (2º chamado do aviso, repetição curta), que pode tocar enquanto a janela da resposta ainda conta.
  const saySpontaneous = useCallback((kind, run, { allowAwaiting = false } = {}) => {
    spontaneousRef.current = [...spontaneousRef.current.filter((item) => item.kind !== kind), { kind, run, allowAwaiting, at: Date.now() }];
  }, []);
  const updatePhase = useCallback((value) => {
    busyAtRef.current = Date.now();
    if (value === "thinking" && phaseRef.current !== "thinking") progressRef.current = { count: 0, at: 0 };
    phaseRef.current = value;
    setPhase(value);
    lastActivityRef.current = Date.now();
    setSleeping(false);
  }, []);

  useEffect(() => {
    expandedRef.current = expanded;
    lastActivityRef.current = Date.now();
    setSleeping(false);
  }, [expanded]);

  // Sinal "tela cheia do Henry aberta" (dono, 2026-10-23): avisos fixos no meio da tela esperam a cena fechar.
  useEffect(() => {
    setHenryFullscreenOpen(expanded);
    return () => setHenryFullscreenOpen(false);
  }, [expanded]);

  // Tempo de espera do fim da fala trocado na tela de configuração: vale já, sem recarregar.
  useEffect(() => {
    const onEndWait = (event) => {
      if (Number.isFinite(event?.detail?.ms)) endWaitMsRef.current = event.detail.ms;
      if (typeof event?.detail?.listenAck === "boolean") listenAckRef.current = event.detail.listenAck;
    };
    window.addEventListener(HENRY_END_WAIT_EVENT, onEndWait);
    return () => window.removeEventListener(HENRY_END_WAIT_EVENT, onEndWait);
  }, []);

  // --- Habilitado? (rota confere o dono e o liga/desliga) -------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    const media = window.matchMedia("(min-width: 768px)");
    const syncDesktop = () => setDesktop(media.matches);
    syncDesktop();
    media.addEventListener("change", syncDesktop);
    setSupported(Boolean(getRecognitionClass()));
    setHasRecorder(typeof window.MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia));
    setIosStandalone(window.navigator.standalone === true); // só o Safari do iPhone/iPad tem essa propriedade
    desktopBridgeRef.current = readHenryDesktopBridge(window);
    setDesktopApp(Boolean(desktopBridgeRef.current));
    setMuted(window.localStorage.getItem(MUTE_KEY) === "1");
    fetch("/api/admin/henry", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { enabled: false }))
      .then((data) => {
        if (!alive) return;
        setEnabled(Boolean(data?.enabled));
        visionRef.current = data?.vision === true;
        setVision(data?.vision === true);
        if (Number.isFinite(data?.browserRate)) browserRateRef.current = data.browserRate;
        if (Number.isFinite(data?.endWaitMs)) endWaitMsRef.current = data.endWaitMs;
        listenAckRef.current = data?.listenAck !== false;
        narrationKeyRef.current = typeof data?.narrationKey === "string" ? data.narrationKey : "";
        // Memória do dia (REGRA OFICIAL, dono 2026-10-22): a conversa de hoje volta ao abrir/recarregar (só texto).
        if (Array.isArray(data?.dayTurns) && data.dayTurns.length && !turnsRef.current.length) {
          const restored = data.dayTurns.filter((turn) => turn && typeof turn.text === "string").map((turn) => ({ role: turn.role === "assistant" ? "assistant" : "user", text: turn.text }));
          turnsRef.current = restored;
          setTurns(restored);
        }
        setMobileWake(data?.mobileWake === true);
        setAlertsOn(data?.clientAlerts !== false || data?.teamArrivals !== false || data?.voiceNotices !== false);
        setVoiceNotices(data?.voiceNotices !== false);
        setPulseConfig(data?.pulse?.enabled === true ? henryPulseConfig(data.pulse) : null);
      })
      .catch(() => alive && setEnabled(false))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
      media.removeEventListener("change", syncDesktop);
    };
  }, []);

  // Computador e celular (dono, 2026-10-22). Celular = tocar para falar, salvo a opção "Ouvir 'Henry' com o app aberto".
  const active = ready && enabled;

  // --- Spotify tocando: "Tocando agora" + guarda da escuta (dono, 2026-10-23) ----------------------------------------
  // Consulta leve do player: ~18 s com a tela cheia aberta, ~45 s minimizado (a guarda da letra precisa saber mesmo
  // minimizado); aba oculta não consulta; Spotify não configurado/conectado → para.
  const refreshNowPlayingRef = useRef(() => {});
  useEffect(() => {
    if (!active) return undefined;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      window.clearTimeout(timer);
      if (stopped) return;
      if (document.visibilityState !== "hidden") {
        try {
          const response = await fetch("/api/admin/henry/spotify/player", { cache: "no-store" });
          const data = response.ok ? await response.json().catch(() => null) : null;
          if (data && (data.configured === false || data.connected === false)) {
            stopped = true;
            musicGuardRef.current = { ...musicGuardRef.current, playerPlaying: false };
            setNowPlaying(null);
            return;
          }
          if (data && !stopped) {
            musicGuardRef.current = { ...musicGuardRef.current, playerPlaying: data.isPlaying === true };
            setNowPlaying(data.isPlaying ? data : null);
          }
        } catch {
          // sem rede: tenta na próxima
        }
      }
      if (!stopped) timer = window.setTimeout(poll, expandedRef.current ? 18000 : 45000);
    };
    refreshNowPlayingRef.current = () => {
      if (!stopped) poll();
    };
    timer = window.setTimeout(poll, 1500);
    const onVisible = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      refreshNowPlayingRef.current = () => {};
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);
  useEffect(() => {
    if (expanded) refreshNowPlayingRef.current();
  }, [expanded]);

  const restoreSpotifyVolume = useCallback(() => {
    const duck = spotifyDuckRef.current;
    window.clearTimeout(duck.timer);
    const previous = duck.previous;
    spotifyDuckRef.current = { previous: null, pending: false, keep: false, timer: 0 };
    if (previous === null || duck.keep) return;
    fetch("/api/admin/henry/spotify/player", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", volume: previous }) }).catch(() => {});
  }, []);
  // Abaixa a música (~15%) ao acordar com ela tocando; volta sozinha em ~30 s sem atividade (segurança).
  const duckSpotifyVolume = useCallback(() => {
    if (!musicPlaying()) return;
    const duck = spotifyDuckRef.current;
    window.clearTimeout(duck.timer);
    duck.timer = window.setTimeout(restoreSpotifyVolume, MUSIC_DUCK_SAFETY_MS);
    if (duck.previous !== null || duck.pending) return;
    duck.pending = true;
    duck.promise = fetch("/api/admin/henry/spotify/player", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "duck" }) })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const current = spotifyDuckRef.current;
        current.pending = false;
        if (data?.ducked && Number.isInteger(data.previous)) current.previous = data.previous;
      })
      .catch(() => {
        spotifyDuckRef.current.pending = false;
      });
  }, [musicPlaying, restoreSpotifyVolume]);
  // Mantém a música baixa por mais `ms` (espera da resposta a uma pergunta dele); depois volta sozinha.
  const holdSpotifyDuck = useCallback((ms) => {
    const duck = spotifyDuckRef.current;
    if (duck.previous === null && !duck.pending) return;
    window.clearTimeout(duck.timer);
    duck.timer = window.setTimeout(restoreSpotifyVolume, ms);
  }, [restoreSpotifyVolume]);
  // Terminou de responder (saiu de "falando" sem nova pergunta) → volume de volta, salvo "pausa"/volume. Terminou com uma
  // PERGUNTA → a janela da resposta começa agora, a música segue baixa até o fim dela e, no app de desktop (gravação, sem
  // escuta contínua), o microfone abre sozinho como no chamado do aviso.
  const previousPhaseRef = useRef("idle");
  useEffect(() => {
    const before = previousPhaseRef.current;
    previousPhaseRef.current = phase;
    if (before !== "speaking" || phase === "thinking" || phase === "speaking") return;
    const pending = pendingReplyRef.current;
    if (!pending.active) {
      restoreSpotifyVolume();
      return;
    }
    pendingReplyRef.current = { ...pending, endedAt: Date.now() };
    holdSpotifyDuck(HENRY_REPLY_WINDOW_MS);
    if (pending.kind !== "alert" && recordModeRef.current && desktopBridgeRef.current && !mutedRef.current) startRecordingRef.current?.();
  }, [phase, holdSpotifyDuck, restoreSpotifyVolume]);
  const captureMode = henryCaptureMode({ desktop, desktopApp, hasRecognition: supported, hasRecorder, recognitionFailed, iosStandalone });
  const recordMode = captureMode === "record";
  recordModeRef.current = recordMode;
  // Como interromper enquanto ele fala: Chrome (parcial + VAD), app de desktop (VAD + trecho curto transcrito) ou celular
  // (tocar na tela; chave HENRY_MOBILE_BARGE_IN desligada por causa do eco no iOS 26.2+).
  const bargeMode = henryBargeMode({ desktop, desktopApp, recordMode });
  const bargeModeRef = useRef(bargeMode);
  bargeModeRef.current = bargeMode;
  const listenMode = recordMode ? "tap" : henryListenMode({ desktop, mobileWake });
  const listenModeRef = useRef(listenMode);
  listenModeRef.current = listenMode;
  const sessionOpenRef = useRef(false);
  const startListeningRef = useRef(() => {});
  const stopListeningRef = useRef(() => {});

  // Pré-aquece os números do relatório no servidor (cache curto, ~45 s; nenhuma chamada paga): ao ligar o Henry, ao abrir a
  // tela cheia e ao ouvir o nome. No máximo 1 vez a cada 30 s.
  const warmServer = useCallback(() => {
    if (Date.now() - warmedAtRef.current < 30000) return;
    warmedAtRef.current = Date.now();
    fetch("/api/admin/henry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "warm" }) }).catch(() => {});
  }, []);
  useEffect(() => {
    if (active) warmServer();
  }, [active, warmServer]);

  // Frases de espera na voz do Henry: da sessão do navegador (mesma voz/estilo = mesma chave) ou do servidor (cache dele).
  // O que faltar (pacote que voltou pela metade, frase nova no banco) vem depois em lotes pequenos (warmNarration), só o
  // que ainda não está no cache — nunca sintetiza de novo o que já tem (dono, 2026-10-23: "repete muito a mesma frase").
  const mergeNarration = useCallback((key, incoming) => {
    const state = narrationRef.current;
    if (state.key !== key || !incoming.length) return;
    const byId = new Map(state.phrases.map((phrase) => [phrase.id, phrase]));
    for (const phrase of incoming) byId.set(phrase.id, phrase);
    const phrases = [...byId.values()];
    narrationRef.current = { ...state, phrases };
    try {
      window.sessionStorage.setItem(`mm-henry-narration:${key}`, JSON.stringify({ phrases }));
    } catch {
      // sem espaço na sessão: fica só na memória da página
    }
  }, []);
  const fetchNarrationIds = useCallback((ids) => {
    const key = narrationRef.current.key;
    const pending = narrationPendingRef.current;
    const wanted = ids.filter((id) => !pending.has(id));
    if (!key || !wanted.length) return Promise.resolve(0);
    wanted.forEach((id) => pending.add(id));
    return fetch("/api/admin/henry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "narration", ids: wanted }) })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const phrases = Array.isArray(data?.phrases) ? data.phrases.filter((phrase) => phrase?.id && phrase?.audio?.base64) : [];
        mergeNarration(key, phrases);
        return phrases.length;
      })
      .catch(() => 0)
      .finally(() => wanted.forEach((id) => pending.delete(id)));
  }, [mergeNarration]);
  const warmNarration = useCallback(async () => {
    if (narrationWarmingRef.current) return;
    narrationWarmingRef.current = true;
    try {
      const batches = narrationWarmBatches({ readyIds: narrationRef.current.phrases.map((phrase) => phrase.id) });
      for (const batch of batches) {
        if (!narrationActiveRef.current) break; // Henry desligado no meio: para de pré-aquecer
        // Lote sem nenhum áudio (sem crédito/voz fora do ar): para aqui, sem insistir e gastar à toa.
        if (!(await fetchNarrationIds(batch))) break;
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
    } finally {
      narrationWarmingRef.current = false;
    }
  }, [fetchNarrationIds]);
  const loadNarration = useCallback(() => {
    const key = narrationKeyRef.current;
    const state = narrationRef.current;
    if (!key || state.loading) return;
    if (state.key === key) {
      warmNarration();
      return;
    }
    const storageKey = `mm-henry-narration:${key}`;
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(storageKey) || "null");
      if (Array.isArray(saved?.phrases) && saved.phrases.length) {
        narrationRef.current = { key, phrases: saved.phrases, loading: false };
        warmNarration();
        return;
      }
    } catch {
      // sessão sem espaço ou JSON velho: busca de novo
    }
    narrationRef.current = { ...state, loading: true };
    fetch("/api/admin/henry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "narration" }) })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const phrases = Array.isArray(data?.phrases) ? data.phrases.filter((phrase) => phrase?.id && phrase?.audio?.base64) : [];
        narrationRef.current = { key: phrases.length ? data.voiceKey || key : "", phrases, loading: false };
        if (phrases.length) {
          try {
            window.sessionStorage.setItem(storageKey, JSON.stringify({ phrases }));
          } catch {
            // sem espaço na sessão: fica só na memória da página
          }
          warmNarration();
        }
      })
      .catch(() => {
        narrationRef.current = { key: "", phrases: [], loading: false };
      });
  }, [warmNarration]);
  useEffect(() => {
    narrationActiveRef.current = active;
    if (!active) return undefined;
    const timer = window.setTimeout(loadNarration, 1500); // depois do pré-aquecimento: não disputa a abertura do painel
    return () => window.clearTimeout(timer);
  }, [active, loadNarration]);

  // --- Áudio (WebAudio): nível do microfone e da voz para animar o orbe ---------------------------------------------
  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return null;
      audioCtxRef.current = new Context();
    }
    if (audioCtxRef.current.state === "suspended") audioCtxRef.current.resume().catch(() => {});
    return audioCtxRef.current;
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    // App de desktop: o app libera o som sem gesto (autoplayPolicy no-user-gesture-required) — liga o áudio já.
    if (desktopBridgeRef.current) ensureAudioContext();
    // Autoplay: o navegador só libera o som depois de um gesto. Primeiro clique OU tecla em qualquer lugar da página destrava,
    // em silêncio (o ícone não precisa ser clicado).
    const resume = () => {
      ensureAudioContext();
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
  }, [active, ensureAudioContext]);

  // Sinal do anel (HenryOrb): FONTE ÚNICA do estado visual (henryOrbMode) + nível REAL do áudio. "Ouvindo" = alguém
  // falando perto (resultado parcial do reconhecedor há menos de 1,5 s) ou o Henry esperando a pergunta; "esperando" =
  // conversa aberta sem ninguém falando; "pensando" = rede neural com atividade pelo assunto e pelos eventos de progresso.
  const getSignal = useCallback(() => {
    const now = Date.now();
    const mode = henryOrbMode({
      phase: phaseRef.current,
      recording: Boolean(recordRef.current),
      hearing: now - lastHeardRef.current < 1500,
      micOn: shouldListenRef.current,
      conversationOpen: conversationRef.current.active,
      awaitingReply: isAwaitingReply(pendingReplyRef.current, now)
    });
    if (mode === "speaking") {
      return { mode, level: outAnalyserRef.current && meterActiveRef.current ? levelFrom(outAnalyserRef.current, meterBuffer) : 0.45 + Math.sin(now / 140) * 0.3 };
    }
    if (mode === "listening") return { mode, level: micAnalyserRef.current ? levelFrom(micAnalyserRef.current, meterBuffer) : 0.3 };
    if (mode === "thinking") {
      const wait = waitRef.current;
      const progress = progressRef.current;
      const topic = wait.replied ? "geral" : wait.topic; // transcrevendo: o assunto do pedido anterior não conta
      return { mode, level: 0.1, activity: thinkingActivity({ topic, progress: progress.count }), burst: progress.at ? Math.exp(-(now - progress.at) / 700) : 0 };
    }
    return { mode, level: 0 };
  }, []);

  // Economia de CPU: minimizado e ocioso por mais de 30 s → o anel para no último quadro (acorda com qualquer atividade).
  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setSleeping(false);
  }, []);
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => {
      if (!expandedRef.current && phaseRef.current === "idle" && Date.now() - lastActivityRef.current > IDLE_SLEEP_MS) setSleeping(true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [active]);

  const startMicMeter = useCallback(async () => {
    if (micStreamRef.current || !navigator.mediaDevices?.getUserMedia) return;
    try {
      // Cancelamento de eco ligado (a voz dele sai do microfone); supressão de ruído desligada (ela abafava a voz do dono
      // por cima da fala dele e o medidor não passava do limiar). O VAD usa este mesmo microfone.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
      micStreamRef.current = stream;
      const context = ensureAudioContext();
      if (!context) return;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      micAnalyserRef.current = analyser;
      micMeterAnalyserRef.current = analyser;
    } catch {
      // Sem permissão: o reconhecimento também vai falhar e mostrar "microfone bloqueado".
    }
  }, [ensureAudioContext]);

  const stopMicMeter = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    // Só solta o medidor dele (a gravação do tocar para falar tem o próprio).
    if (micAnalyserRef.current === micMeterAnalyserRef.current) micAnalyserRef.current = null;
    micMeterAnalyserRef.current = null;
  }, []);

  // --- Sons sutis de início/fim de escuta (respeitam o mudo) ------------------------------------------------------------
  const chime = useCallback((kind = "start") => {
    if (mutedRef.current) return;
    const context = ensureAudioContext();
    if (!context || context.state !== "running") return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.frequency.setValueAtTime(kind === "end" ? 784 : 587, now);
    oscillator.frequency.exponentialRampToValueAtTime(kind === "end" ? 523 : 880, now + 0.16);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(now + 0.25);
  }, [ensureAudioContext]);

  // Som curto de "entendi" (confirmação de escuta): duas notas suaves sintetizadas aqui, sem arquivo. Devolve quanto dura
  // (0 = não tocou: som ainda bloqueado pelo navegador).
  const playAckTone = useCallback((tone) => {
    const context = ensureAudioContext();
    if (!context || context.state !== "running" || !tone?.notes?.length) return 0;
    let at = context.currentTime + 0.01;
    for (const [frequency, ms] of tone.notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const length = ms / 1000;
      oscillator.type = tone.wave || "sine";
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(tone.wave === "triangle" ? 0.09 : 0.06, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + length + 0.02);
      at += length + 0.02;
    }
    return ackToneDurationMs(tone);
  }, [ensureAudioContext]);

  // --- Modo conversa ------------------------------------------------------------------------------------------------
  const touchConversation = useCallback(() => {
    if (conversationRef.current.active) conversationRef.current.lastAt = Date.now();
  }, []);

  const startConversation = useCallback(({ sound = false } = {}) => {
    if (conversationRef.current.active) {
      conversationRef.current.lastAt = Date.now();
      return;
    }
    conversationRef.current = { active: true, lastAt: Date.now(), historyStart: conversationRef.current.historyStart };
    setInConversation(true);
    if (sound) chime("start");
  }, [chime]);

  // Sai do modo conversa: memória zerada (as próximas perguntas não levam as trocas anteriores) e som de fim.
  const endConversation = useCallback(({ sound = true } = {}) => {
    if (!conversationRef.current.active) return;
    conversationRef.current = { active: false, lastAt: 0, historyStart: turnsRef.current.length };
    morningRef.current = null;
    pendingReplyRef.current = { active: false };
    setInConversation(false);
    if (phaseRef.current === "armed") updatePhase("idle");
    if (sound) chime("end");
  }, [chime, updatePhase]);

  // Depois de falar (ou de ser interrompido): em conversa segue ouvindo sem o nome; fora dela, volta a esperar o nome.
  // Gravação (tocar para falar): não há escuta contínua — volta a "toque para falar", mantendo a memória da conversa.
  const listenAgain = useCallback(() => {
    if (recordModeRef.current) {
      if (conversationRef.current.active) conversationRef.current.lastAt = Date.now();
      updatePhase("idle");
      return;
    }
    if (conversationRef.current.active) {
      conversationRef.current.lastAt = Date.now();
      updatePhase("armed");
    } else {
      updatePhase("idle");
    }
  }, [updatePhase]);

  // --- Fala do Henry (fila: a 1ª frase toca enquanto o resto chega) -------------------------------------------------
  const speakBrowser = useCallback((text, onDone) => {
    const synth = window.speechSynthesis;
    if (!synth || !text) {
      onDone?.();
      return;
    }
    // Reserva sem voz do servidor: a melhor voz pt-BR do navegador ("Natural"/"Online"/Google) e uma frase por utterance,
    // todas enfileiradas de uma vez (sem pausa longa entre elas; o Chrome corta falas longas).
    const voice = pickBestBrowserVoice(synth.getVoices());
    const sentences = splitSentences(text);
    sentences.forEach((sentence, index) => {
      const utterance = new SpeechSynthesisUtterance(pronounceForSpeech(sentence));
      utterance.lang = voice?.lang || "pt-BR";
      utterance.rate = browserRateRef.current;
      if (voice) utterance.voice = voice;
      if (index === sentences.length - 1) {
        utterance.onend = () => onDone?.();
        utterance.onerror = () => onDone?.();
      }
      synth.speak(utterance);
    });
    if (!sentences.length) onDone?.();
  }, []);

  // Corta a voz na hora (áudio do servidor e voz do navegador) e esvazia a fila.
  const stopSpeaking = useCallback(() => {
    speechQueueRef.current = { clips: [], playing: false, done: true };
    narratingTextRef.current = "";
    currentClipRef.current = { text: "", prevText: "", startedAt: 0 };
    duckRef.current = { ducked: false, lastVoiceAt: 0, waitingSince: 0 };
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.onplaying = null;
      if (!audio.paused) audio.pause();
      audio.volume = 1;
    }
    try {
      if (webSourceRef.current) {
        webSourceRef.current.onended = null;
        webSourceRef.current.stop();
      }
    } catch {
      // já terminou
    }
    webSourceRef.current = null;
    if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending) window.speechSynthesis.cancel();
    if (phaseRef.current === "speaking") listenAgain();
  }, [listenAgain]);

  // Cancela o pedido em andamento (o dono interrompeu enquanto ele pensava).
  const abortRequest = useCallback(() => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setCapturing(false);
    if (phaseRef.current === "thinking") listenAgain();
  }, [listenAgain]);

  // Elemento de áudio único. A voz sai DIRETO dele para o alto-falante (dono, 2026-10-23: "ele não para quando é
  // interrompido"): passar o som pelo WebAudio (fonte do elemento → destino) desligava o cancelamento de eco do
  // Chrome, que só cancela o áudio tocado direto por <audio>, e o microfone ouvia o próprio Henry.
  const getAudioElement = useCallback(() => {
    if (!audioRef.current) {
      const element = new Audio();
      element.setAttribute("playsinline", "");
      element.preload = "auto";
      audioRef.current = element;
    }
    return audioRef.current;
  }, []);

  // Anel do computador: lê a voz por audio.captureStream() → AnalyserNode que NÃO vai ao alto-falante (só mede). Sem
  // captureStream (ou contexto parado), o anel usa o pulso simulado. Chamado a cada parte que começa a tocar.
  const meterOutput = useCallback((element) => {
    const context = audioCtxRef.current;
    const capture = element.captureStream || element.mozCaptureStream;
    if (!desktopRef.current || !context || context.state !== "running" || typeof capture !== "function") return false;
    try {
      const stream = capture.call(element);
      if (!stream.getAudioTracks().length) return false;
      if (!outAnalyserRef.current) {
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        outAnalyserRef.current = analyser;
      }
      outSourceRef.current?.disconnect();
      const source = context.createMediaStreamSource(stream);
      source.connect(outAnalyserRef.current); // NÃO liga a context.destination
      outSourceRef.current = source;
      return true;
    } catch {
      return false;
    }
  }, []);

  // Volume abaixado enquanto o dono pode estar falando por cima (1ª etapa da interrupção). Só no <audio> do computador.
  const setDuck = useCallback((on) => {
    duckRef.current.ducked = on;
    if (!on) duckRef.current.waitingSince = 0;
    const element = audioRef.current;
    if (element && desktopRef.current) element.volume = on ? BARGE_DUCK_VOLUME : 1;
  }, []);

  // iPhone (Safari 16.4+): "playback" manda a voz para o alto-falante e ignora a chave de silencioso; para ouvir de novo
  // volta para "play-and-record". Dono, 2026-10-22: no app a resposta aparecia escrita e não saía som.
  const setAudioSession = useCallback((type) => {
    try {
      if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type;
    } catch {
      // navegador sem a API
    }
  }, []);

  // Celular: toca a voz pelo AudioContext destravado no toque (o elemento <audio> é recusado pelo iOS depois do
  // reconhecimento de voz). Devolve false se não deu para tocar assim (contexto suspenso/sem suporte).
  const playClipWebAudio = useCallback(async (clip, onEnded) => {
    const context = audioCtxRef.current;
    if (!context || context.state !== "running" || !clip?.audio?.base64) return false;
    try {
      const binary = atob(clip.audio.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const buffer = await context.decodeAudioData(bytes.buffer);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = onEnded;
      webSourceRef.current = source;
      source.start();
      return true;
    } catch {
      return false;
    }
  }, []);

  // Toque que abre o Henry no celular: destrava o áudio (elemento único + voz do navegador) dentro do gesto.
  const unlockAudio = useCallback(() => {
    ensureAudioContext();
    const context = audioCtxRef.current;
    if (context) {
      const source = context.createBufferSource(); // 1 amostra de silêncio: destrava o contexto no iOS
      source.buffer = context.createBuffer(1, 1, 22050);
      source.connect(context.destination);
      source.start(0);
    }
    const element = getAudioElement();
    if (element.paused && !element.src) {
      element.src = silentWavDataUri();
      element.play().catch(() => {});
    }
    const synth = window.speechSynthesis;
    if (synth && !synth.speaking) {
      const primer = new SpeechSynthesisUtterance(" ");
      primer.volume = 0;
      synth.speak(primer);
    }
  }, [ensureAudioContext, getAudioElement]);

  const playNextRef = useRef(() => {});
  playNextRef.current = () => {
    const queue = speechQueueRef.current;
    if (queue.acking) {
      queue.acking = false;
      ackRef.current = { ...ackRef.current, endedAt: Date.now() };
    }
    const clip = queue.clips.shift();
    if (!clip) {
      queue.playing = false;
      if (queue.done && phaseRef.current === "speaking") listenAgain();
      return;
    }
    queue.playing = true;
    queue.narrating = Boolean(clip.narration);
    queue.acking = Boolean(clip.ack);
    narratingTextRef.current = clip.narration ? clip.text : "";
    currentClipRef.current = { text: clip.text || "", prevText: currentClipRef.current.text, startedAt: Date.now() };
    busyAtRef.current = Date.now();
    if (!clip.narration) {
      const marks = latencyRef.current;
      if (marks.asked && !marks.playing) {
        marks.playing = Date.now();
        henryDebug("tempos", henryLatencyBreakdown(marks));
      }
    }
    const advance = () => {
      if (speechQueueRef.current === queue) playNextRef.current();
    };
    if (clip.tone) {
      // Confirmação de escuta em som (WebAudio, sem arquivo): a fila só segue quando ele termina (nunca sobrepõe).
      window.setTimeout(advance, playAckTone(clip.tone));
      return;
    }
    if (clip.narration && !clip.audio?.base64) {
      advance(); // frase de espera só na voz do Henry; sem áudio, nada
      return;
    }
    if (!clip.audio?.base64) {
      // Servidor sem áudio (ElevenLabs e OpenAI falharam/ausentes): reserva do aparelho — no app de desktop, o Piper do PC
      // (pelo mesmo <audio>, com anel e interrupção); fora dele, a voz do navegador. Ordem só em henryReserveVoiceChain.
      const [reserve] = henryReserveVoiceChain({ desktopLocalVoice: desktopCanSpeakLocal(desktopBridgeRef.current) });
      if (reserve === "piper-local" && clip.text) {
        const [first, ...rest] = chunkForLocalVoice(clip.text);
        if (rest.length) queue.clips.unshift(...rest.map((text) => ({ ...clip, text })));
        Promise.resolve(desktopBridgeRef.current.speakLocal(pronounceForSpeech(first || "")))
          .catch(() => null)
          .then((result) => {
            if (speechQueueRef.current !== queue) return; // interrompido enquanto o PC preparava a voz
            if (result?.ok && result.audio?.base64) playWithElement({ ...clip, text: first, audio: result.audio }, queue, advance);
            else {
              meterActiveRef.current = false;
              speakBrowser(first, advance);
            }
          });
        return;
      }
      meterActiveRef.current = false; // voz do navegador: o anel usa o pulso simulado
      speakBrowser(clip.text, advance);
      return;
    }
    if (!desktopRef.current) {
      setAudioSession("playback");
      playClipWebAudio(clip, advance).then((played) => {
        if (played || speechQueueRef.current !== queue) return;
        playWithElement(clip, queue, advance);
      });
      return;
    }
    playWithElement(clip, queue, advance);
  };

  // UM elemento de áudio reaproveitado por todas as partes (o Safari do iOS só deixa tocar o elemento destravado no toque).
  // Recusado: guarda a parte e toca no próximo toque/tecla (dentro do gesto), em vez de cair na voz do navegador muda.
  const playWithElement = (clip, queue, advance) => {
    const element = getAudioElement();
    meterActiveRef.current = false;
    element.onplaying = () => {
      meterActiveRef.current = meterOutput(element);
    };
    element.volume = desktopRef.current && duckRef.current.ducked ? BARGE_DUCK_VOLUME : 1;
    element.onended = advance;
    element.onerror = advance;
    element.src = `data:${clip.audio.contentType || "audio/mpeg"};base64,${clip.audio.base64}`;
    element.play().catch(() => {
      if (speechQueueRef.current !== queue) return;
      if (clip.narration) {
        advance(); // som ainda bloqueado: pula a frase de espera (a resposta pede o toque, se precisar)
        return;
      }
      setNotice(desktopRef.current ? "Clique ou aperte uma tecla na página para liberar o som do Henry." : "Toque na tela para ouvir o Henry.");
      soundRetryRef.current = true;
      const retry = () => {
        window.setTimeout(() => {
          soundRetryRef.current = false;
        }, 600);
        window.removeEventListener("pointerdown", retry, true);
        window.removeEventListener("keydown", retry, true);
        if (speechQueueRef.current !== queue) return;
        ensureAudioContext();
        setNotice("");
        element.play().catch(() => speakBrowser(clip.text, advance));
      };
      window.addEventListener("pointerdown", retry, true);
      window.addEventListener("keydown", retry, true);
    });
  };

  const beginSpeech = useCallback((text) => {
    if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending) window.speechSynthesis.cancel();
    lastReplyRef.current = text;
    const queue = speechQueueRef.current;
    if (queue.playing && queue.narrating) {
      // Frase de espera tocando: termina a frase (nunca corta no meio de uma palavra) e a resposta entra logo depois.
      queue.clips = [];
      queue.done = false;
    } else {
      speechQueueRef.current = { clips: [], playing: false, done: false };
    }
    updatePhase("speaking");
  }, [updatePhase]);

  const enqueueClip = useCallback((clip) => {
    const queue = speechQueueRef.current;
    queue.clips.push(clip);
    if (!queue.playing) playNextRef.current();
  }, []);

  const endSpeech = useCallback(() => {
    const queue = speechQueueRef.current;
    queue.done = true;
    if (!queue.playing) playNextRef.current();
  }, []);

  // Spotify fechado: abre a URI pelo protocolo spotify: (âncora na mesma aba) e pede ao servidor para esperar o aparelho
  // (~10 s) e tocar nele. Tocou → silêncio (a música fala por si). Não pegou (ou iPhone sem play) → frase curta pedindo um
  // play no Spotify — só se o dono não fez outra pergunta nesse meio-tempo. Nunca força nada além disso.
  const openSpotifyAndPlay = useCallback(async (uri, requestId, volume = null) => {
    try {
      // App de desktop: o próprio app abre o Spotify (sem o "Abrir Spotify?" do navegador).
      if (desktopBridgeRef.current) {
        await desktopBridgeRef.current.openSpotify(uri);
      } else {
        const link = document.createElement("a");
        link.href = uri;
        link.rel = "noopener";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch {
      // protocolo recusado: o servidor ainda espera um aparelho e, sem ele, pede o play
    }
    let data = null;
    try {
      const response = await fetch("/api/admin/henry/spotify/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Nome do que a busca achou (a cena já mostra): "Pronto, tá tocando! <nome>." — no bom dia (volume baixo) não fala
        // por cima do relatório.
        body: JSON.stringify({ uri, ...(volume === null ? {} : { volume, announce: false }), name: musicRef.current?.name || "", artists: musicRef.current?.artists || "" })
      });
      data = await response.json().catch(() => null);
      if (!response.ok) data = { ok: false, reply: data?.error || "Não consegui tocar no Spotify. Dá play uma vez nele." };
    } catch {
      data = { ok: false, reply: "Não consegui tocar no Spotify. Dá play uma vez nele." };
    }
    if (requestIdRef.current === requestId) {
      if (data?.ok) {
        markMusicPlayed();
        updateMusic({ stage: "playing" });
        window.setTimeout(() => refreshNowPlayingRef.current(), 2500);
      } else updateMusic({ stage: "error", error: String(data?.reply || "O Spotify não respondeu agora.").slice(0, 80) });
    }
    if (!data?.reply || requestIdRef.current !== requestId) return;
    // Chega ~10 s depois: entra na fila da fala espontânea (nunca corta outra fala nem a escuta do dono).
    saySpontaneous("spotify", () => {
      if (requestIdRef.current !== requestId) return; // o dono já pediu outra coisa
      const withReply = [...turnsRef.current, { role: "assistant", text: data.reply }];
      turnsRef.current = withReply;
      setTurns(withReply);
      beginSpeech(data.reply);
      enqueueClip({ audio: data.audio || null, text: data.reply });
      endSpeech();
    });
  }, [beginSpeech, endSpeech, enqueueClip, markMusicPlayed, saySpontaneous, updateMusic]);

  // Despedida na voz do Henry ("obrigado, Henry"): do mesmo cache das frases de espera, sem repetir as últimas 5. Sem voz
  // do servidor: só o som de fim (nunca a voz do navegador).
  const sayGoodbye = useCallback(() => {
    const byes = narrationRef.current.phrases.filter((phrase) => phrase.topics?.includes("bye"));
    if (!byes.length || mutedRef.current) return;
    const usedToday = usedWaitsInOrder(recentPhrasesRef.current);
    const choice = pickWaitPhrase({ topic: "bye", recentIds: usedToday, phrases: byes, avoid: 5 });
    if (!choice?.audio?.base64) return;
    recentPhrasesRef.current = rememberPhrase(recentPhrasesRef.current, choice.id);
    rememberUsedWait(choice.id);
    speechQueueRef.current = { clips: [{ audio: choice.audio, text: choice.text, narration: true }], playing: false, done: true };
    playNextRef.current();
  }, []);

  // Confirmação de escuta (dono, 2026-10-23: "não deixe o silêncio; às vezes ele nem precisa falar, só fazer um som que
  // entendeu"): logo depois do fim da fala, antes da transcrição/IA. Som, interjeição ou frase curta (pickListenAck), na
  // fila de sempre (marcada como narração: a resposta espera só ela terminar). Nunca com outra fala tocando, resposta a
  // uma pergunta dele (aviso, passo do bom dia) ou comando resolvido na hora.
  const acknowledgeHeard = useCallback(({ mode = "question", question = "", awaitingReply = false, instant = false } = {}) => {
    const queue = speechQueueRef.current;
    const allowed = shouldAcknowledgeHeard({
      enabled: listenAckRef.current,
      muted: mutedRef.current,
      heard: true,
      awaitingReply: awaitingReply || Boolean(morningRef.current),
      instant,
      speaking: queue.playing
    });
    if (!allowed) return false;
    const usedToday = [...readUsedWaits(), ...recentPhrasesRef.current];
    const choice = pickListenAck({ context: henryAckContext({ mode, question }), lastId: ackRef.current.lastId, usedToday, phrases: narrationRef.current.phrases });
    if (!choice) return false;
    ackRef.current = { ...ackRef.current, lastId: choice.id };
    if (choice.kind !== "tone") {
      recentPhrasesRef.current = rememberPhrase(recentPhrasesRef.current, choice.id);
      rememberUsedWait(choice.id);
    }
    queue.clips.push(choice.kind === "tone" ? { tone: choice.tone, text: "", narration: true, ack: true } : { audio: choice.audio, text: choice.text, narration: true, ack: true });
    // Pedido já em andamento (escuta do navegador: a confirmação vem logo depois do ask) → a espera conta da confirmação.
    if (!waitRef.current.replied && waitRef.current.id === requestIdRef.current) waitRef.current = { ...waitRef.current, acked: true };
    if (!queue.playing) playNextRef.current();
    return true;
  }, []);

  // --- Cena de busca e narração ------------------------------------------------------------------------------------
  // Evento de progresso do servidor → assunto da cena, legenda e cards de corretor (até 3; o achado ganha os números).
  const applyProgress = useCallback((message) => {
    progressRef.current = { count: progressRef.current.count + 1, at: Date.now() };
    let topic = typeof message.topic === "string" ? message.topic : "geral";
    if (message.music) {
      updateMusic(message.music);
      if (message.music.stage === "playing") markMusicPlayed();
    }
    // Pedido composto ("toca X e me fala do Gabriel", dono 2026-10-23: a cena da música não rodou): a cena do Spotify
    // segue até a música chegar ao fim (tocando/erro); o assunto de dados que chegou no meio entra logo depois.
    const musicBusy = Boolean(musicRef.current) && !MUSIC_FINAL_STAGES.has(musicRef.current.stage);
    if (topic !== MUSIC_TOPIC && waitRef.current.topic === MUSIC_TOPIC && musicBusy) {
      deferredTopicRef.current = topic;
      topic = MUSIC_TOPIC;
    } else if (topic === MUSIC_TOPIC && !musicBusy && deferredTopicRef.current) {
      topic = deferredTopicRef.current;
      deferredTopicRef.current = "";
    }
    waitRef.current = { ...waitRef.current, topic };
    setScene((current) => {
      let brokers = current.brokers;
      const broker = message.broker;
      if (broker?.id) {
        const card = {
          id: String(broker.id),
          firstName: String(broker.firstName || "").slice(0, 30),
          photoUrl: typeof broker.photoUrl === "string" && /^https:\/\//.test(broker.photoUrl) ? broker.photoUrl : "",
          stats: Array.isArray(broker.stats) ? broker.stats.slice(0, 2).map((stat) => ({ label: String(stat?.label || ""), value: String(stat?.value || "") })) : [],
          found: message.progress === "corretor_achado",
          // Selo de posição no ranking do período (só vem quando a pergunta envolve ranking/pontos).
          ...(Number.isInteger(broker.position) && broker.position > 0 ? { position: broker.position } : {})
        };
        const others = brokers.filter((item) => item.id !== card.id);
        const previous = brokers.find((item) => item.id === card.id);
        brokers = [...others, previous && !card.found ? previous : { ...previous, ...card, stats: card.stats.length ? card.stats : previous?.stats || [] }].slice(-3);
      }
      // Música nunca liga a cena de números (dono, 2026-10-23).
      const label = topic === message.topic || !current.label ? String(message.label || "").slice(0, 80) : current.label;
      return { topic, label, brokers, live: topic === MUSIC_TOPIC ? false : current.live || message.progress !== "inicio" };
    });
  }, [markMusicPlayed, updateMusic]);

  // Enquanto pensa: frase de espera na voz do Henry quando a regra deixa (shouldNarrate); primeiro a frase com o nome do
  // corretor, se veio; depois as do assunto, sem repetir no dia (pickWaitPhrase). Todas as prontas já usadas hoje e ainda
  // há frase nova sem áudio → silêncio (a cena de "pensando" continua) e pede a síntese dela para a próxima.
  useEffect(() => {
    if (phase !== "thinking") return undefined;
    const timer = window.setInterval(() => {
      const wait = waitRef.current;
      const queue = speechQueueRef.current;
      const { phrases } = narrationRef.current;
      const name = wait.names.find((item) => !recentPhrasesRef.current.includes(item.id));
      const waits = phrases.filter((phrase) => !phrase.topics?.includes("bye") && !isAckPhrase(phrase)); // despedidas só no fim; confirmações só no fim da fala
      const hasAudio = Boolean(name) || waits.length > 0;
      if (!shouldNarrate({ now: Date.now(), startedAt: wait.startedAt, lastNarrationAt: wait.lastAt, playing: queue.playing, replied: wait.replied || wait.id !== requestIdRef.current, hasAudio, ackEndedAt: ackRef.current.endedAt, acked: wait.acked })) return;
      const usedToday = usedWaitsInOrder(recentPhrasesRef.current);
      const readyIds = waits.map((phrase) => phrase.id);
      const picked = name ? null : pickWaitPhrase({ topic: wait.topic, recentIds: usedToday, usedToday, available: readyIds, phrases: HENRY_WAIT_PHRASES });
      const choice = name || (picked && waits.find((phrase) => phrase.id === picked.id));
      if (!choice?.audio?.base64) {
        if (!name && !wait.synthAsked) {
          waitRef.current = { ...wait, synthAsked: true };
          const ids = waitPhrasesToSynthesize({ topic: wait.topic, usedToday, available: readyIds });
          if (ids.length) fetchNarrationIds(ids);
        }
        return;
      }
      waitRef.current = { ...wait, lastAt: Date.now(), names: name ? wait.names.filter((item) => item !== name) : wait.names };
      recentPhrasesRef.current = rememberPhrase(recentPhrasesRef.current, choice.id);
      if (!name) rememberUsedWait(choice.id);
      queue.clips.push({ audio: choice.audio, text: choice.text, narration: true });
      if (!queue.playing) playNextRef.current();
    }, 200);
    return () => window.clearInterval(timer);
  }, [phase, fetchNarrationIds]);

  // --- Pergunta ao servidor ---------------------------------------------------------------------------------------
  // Interrompe o que estiver em andamento (pedido e voz) e faz a nova pergunta. Memória: só as trocas do modo conversa
  // atual (no máximo ~6), só desta página — nada vai para o banco.
  const ask = useCallback(async ({ mode, question, shown }) => {
    // Resposta ao chamado do aviso digitada ou transcrita (a falada já passa por handleFinal).
    if (mode === "question" && alertAnswerRef.current(question)) return;
    // "Henry, leia os avisos" (dono, 2026-10-23): fala tudo o que está acumulado, sem ir ao modelo.
    if (mode === "question" && isReadAlertsCommand(question)) {
      const withTurn = [...turnsRef.current, { role: "user", text: shown || question }];
      turnsRef.current = withTurn;
      setTurns(withTurn);
      abortRequest();
      stopSpeaking();
      setNotice("");
      startConversation();
      readAlertsRef.current?.();
      return;
    }
    // App de desktop: "desliga a tela"/"liga a tela" é feito aqui mesmo pelo app (não vai ao servidor).
    const screen = mode === "question" && desktopBridgeRef.current ? detectScreenCommand(question) : null;
    if (screen) {
      const reply = screen === "off" ? "Desligando a tela." : "Ligando a tela.";
      const withTurns = [...turnsRef.current, { role: "user", text: shown || question }, { role: "assistant", text: reply }];
      turnsRef.current = withTurns;
      setTurns(withTurns);
      const run = screen === "off" ? desktopBridgeRef.current.screenOff() : desktopBridgeRef.current.screenOn();
      Promise.resolve(run)
        .then((result) => {
          if (result && result.ok === false) setNotice("O app não conseguiu mudar a tela.");
        })
        .catch(() => setNotice("O app não conseguiu mudar a tela."));
      listenAgain();
      return;
    }
    alertRef.current.afterAsk = true;
    const ackedBeforeAsk = ackRef.current.preAcked; // gravação: a confirmação tocou antes da transcrição
    ackRef.current = { ...ackRef.current, preAcked: false };
    pendingReplyRef.current = { active: false }; // a resposta à pergunta dele (se havia) é esta
    const pendingMorning = morningRef.current;
    morningRef.current = null;
    const conversationNow = conversationRef.current;
    const morning = mode === "question" && pendingMorning && conversationNow.active && !isConversationExpired(conversationNow.lastAt) ? { step: pendingMorning.step } : null;
    // Resposta da música/estilo segue como "bom dia" (relatório, com a visão como no bom dia); aniversário = pergunta.
    if (morning && morning.step !== "birthday") mode = "report";
    abortRequest();
    // Confirmação de escuta tocando (gravação já confirmou antes da transcrição): termina o som/interjeição e a resposta
    // entra logo depois (beginSpeech) — nunca corta no meio nem atrasa mais que isso.
    if (speechQueueRef.current.playing && speechQueueRef.current.acking) speechQueueRef.current.clips = [];
    else stopSpeaking();
    setNotice("");
    const id = requestIdRef.current + 1;
    requestIdRef.current = id;
    const askedAt = Date.now();
    const previousMarks = latencyRef.current;
    latencyRef.current = previousMarks.transcribed && !previousMarks.asked && askedAt - previousMarks.transcribed < 4000 ? { ...previousMarks, asked: askedAt } : { asked: askedAt };
    const marks = latencyRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const history = conversationHistory(turnsRef.current, conversationRef.current.historyStart);
    const nextTurns = [...turnsRef.current, { role: "user", text: shown || question }];
    turnsRef.current = nextTurns;
    setTurns(nextTurns);
    updatePhase("thinking");
    startConversation(); // depois de qualquer resposta, ~40 s em que frases sem o nome valem (também no computador)
    // Pedido de música (texto ou resposta da música do bom dia): narração e cena do Spotify desde o início, sem números.
    const musicIntent = henryMusicIntent({ mode, question, morningStep: morning?.step || "" });
    const startTopic = musicIntent ? MUSIC_TOPIC : mode === "report" ? "relatorio" : "geral";
    waitRef.current = { id, startedAt: Date.now(), replied: false, topic: startTopic, lastAt: 0, names: [], acked: ackedBeforeAsk, synthAsked: false };
    // Pedido novo: toda cena do pedido anterior sai (cards de corretor, música, assunto adiado) — nenhuma fica órfã.
    deferredTopicRef.current = "";
    setScene({ topic: startTopic, label: "", brokers: [], live: mode === "report" && !musicIntent });
    updateMusic(null);
    // Troca de aparelho ("toca na Alexa", "volta pro computador"): cena do aparelho, sem campo de busca.
    const deviceKind = mode === "question" && !morning ? spotifyDeviceRequestKind(question) : "";
    if (deviceKind) updateMusic({ stage: "device", device: deviceKind });
    else if (musicIntent) {
      const query = morning ? "" : musicQueryFromText(question);
      updateMusic({ stage: "connect", ...(query ? { query } : {}) });
    }
    // Música tocando: abaixa enquanto ele responde; "pausa"/volume não restauram depois.
    if (musicPlaying()) {
      duckSpotifyVolume();
      if (mode === "question" && (isMusicPauseCommand(question) || (musicIntent && /\b(volume|som|aumenta|abaixa|baixa)\b/i.test(question)))) spotifyDuckRef.current.keep = true;
    }
    touchConversation();
    // "Esquece a conversa de hoje": a tela também começa do zero.
    const clearTurns = () => {
      turnsRef.current = [];
      conversationRef.current = { ...conversationRef.current, historyStart: 0 };
      setTurns([]);
    };
    const onReply = (reply, navigate, detail = null, rawScene = null, openUrl = null, spotify = null, nextMorning = null, musicNow = false, spotifyMoved = false) => {
      if (requestIdRef.current === id) {
        // Música passou para outro aparelho: o servidor já devolveu o volume no de origem; o novo fica com o volume dele.
        if (spotifyMoved) spotifyDuckRef.current.keep = true;
        morningRef.current = nextMorning?.step ? { step: nextMorning.step } : null;
        // Resposta que termina em pergunta (ou passo do bom dia) = pergunta aberta: espera a resposta curta, sem o nome.
        pendingReplyRef.current = nextMorning?.step || henryAsksQuestion(reply) ? openPendingReply(nextMorning?.step || "question") : { active: false };
        // Bom dia com o Spotify já tocando (o servidor conferiu o player): música baixa enquanto ele fala.
        if (musicNow) {
          musicGuardRef.current = { ...musicGuardRef.current, playerPlaying: true };
          duckSpotifyVolume();
        }
      }
      if (waitRef.current.id === id) waitRef.current = { ...waitRef.current, replied: true };
      // Cena da resposta (HenryAnswerScenes), escolhida no servidor pelas ferramentas chamadas.
      const answerScene = normalizeHenryScene(rawScene);
      if (answerScene?.kind === "musica" && answerScene.music && requestIdRef.current === id) {
        updateMusic(answerScene.music);
        if (answerScene.music.stage === "playing") {
          markMusicPlayed();
          window.setTimeout(() => refreshNowPlayingRef.current(), 2500);
        } else if (answerScene.music.stage === "device" && answerScene.music.moved) window.setTimeout(() => refreshNowPlayingRef.current(), 2500);
      }
      const withReply = [...turnsRef.current, { role: "assistant", text: reply, ...(detail ? { detail } : {}), ...(answerScene ? { scene: answerScene } : {}) }];
      turnsRef.current = withReply;
      setTurns(withReply);
      // Navegação guiada: minimiza a tela cheia e o cursor do Henry mostra o caminho (HenryCursor faz a navegação).
      if (shouldMinimizeForNavigation(navigate)) {
        setExpanded(false);
        setNavRequest({ ...navigate, id: Date.now() });
      }
      // Spotify sem conexão (fallback): abre a busca no Spotify Web numa aba nova. Se o navegador bloquear, o link fica no
      // detalhe da tela (o servidor só manda open.spotify.com).
      if (typeof openUrl === "string" && /^https:\/\/open\.spotify\.com\//.test(openUrl)) {
        try {
          if (desktopBridgeRef.current) desktopBridgeRef.current.openUrl(openUrl);
          else window.open(openUrl, "_blank", "noopener,noreferrer");
        } catch {
          // bloqueado: o link continua no detalhe
        }
      }
      beginSpeech(reply);
      // Spotify fechado (`open_spotify`): abre o app pela URI na MESMA aba (âncora, sem aba nova — no PC abre o app
      // desktop; o navegador pode perguntar "Abrir Spotify?" na 1ª vez) e o servidor espera o aparelho e dá o play.
      if (spotify?.action === "open_spotify" && typeof spotify.uri === "string" && /^spotify:(track|playlist|album|artist):[A-Za-z0-9]+$/.test(spotify.uri)) {
        openSpotifyAndPlay(spotify.uri, id, Number.isInteger(spotify.volume) ? spotify.volume : null);
      }
    };
    try {
      // Visão (HENRY-2): 1 quadro da webcam só no "bom dia" ou em pergunta visual, com a visão ligada. Falhou → sem imagem.
      let image = null;
      if (visionRef.current && (mode === "report" || isVisualQuestion(question))) {
        setCapturing(true);
        image = await captureWebcamFrame();
        setCapturing(false);
      }
      // Troca de aparelho com a música baixa: espera (até 1,5 s) o volume guardado para o servidor devolvê-lo no aparelho de origem.
      if (deviceKind && spotifyDuckRef.current.pending && spotifyDuckRef.current.promise) await Promise.race([spotifyDuckRef.current.promise, new Promise((resolve) => window.setTimeout(resolve, 1500))]);
      if (requestIdRef.current !== id) return;
      const spotifyVolume = deviceKind && Number.isInteger(spotifyDuckRef.current.previous) ? spotifyDuckRef.current.previous : null;
      const response = await fetch("/api/admin/henry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, question, history, ...(image ? { image } : {}), ...(morning ? { morning } : {}), ...(spotifyVolume !== null ? { spotifyVolume } : {}), stream: true, deviceId: deviceIdRef.current }),
        signal: controller.signal
      });
      image = null;
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "Não consegui responder agora.");
      }
      if (!(response.headers.get("content-type") || "").includes("ndjson") || !response.body) {
        const data = await response.json().catch(() => ({}));
        if (requestIdRef.current !== id) return;
        if (data?.skipped === "other_device") {
          // Outro aparelho está conversando: este fica calado e sai da conversa.
          const withoutQuestion = turnsRef.current.slice(0, -1);
          turnsRef.current = withoutQuestion;
          setTurns(withoutQuestion);
          endConversation({ sound: false });
          updatePhase("idle");
          return;
        }
        if (data.memoryCleared) clearTurns();
        onReply(data.reply || "", data.navigate, data.detail || null, data.scene || null, data.openUrl || null, data.spotify || null, data.morning || null, data.musicPlaying === true, data.spotifyMoved === true);
        enqueueClip({ audio: data.audio, text: data.reply || "" });
        endSpeech();
        return;
      }
      // Linhas: { reply, navigate } → { text, audio } por parte → { done }.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (requestIdRef.current !== id) {
          reader.cancel().catch(() => {});
          return;
        }
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line) continue;
          let message = null;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (typeof message?.reply === "string") {
            if (!marks.reply) marks.reply = Date.now();
            if (message.memoryCleared) clearTurns();
            onReply(message.reply, message.navigate, message.detail || null, message.scene || null, message.openUrl || null, message.spotify || null, message.morning || null, message.musicPlaying === true, message.spotifyMoved === true);
          }
          else if (typeof message?.text === "string") {
            if (!marks.firstAudio) marks.firstAudio = Date.now();
            enqueueClip({ audio: message.audio, text: message.text });
          } else if (message?.timing && typeof message.timing === "object") marks.server = message.timing;
          else if (message?.done) endSpeech();
          else if (typeof message?.progress === "string") applyProgress(message);
          else if (message?.narration?.audio?.base64 && waitRef.current.id === id) waitRef.current.names.push({ id: `n:${message.narration.text}`, text: message.narration.text, audio: message.narration.audio });
          else if (typeof message?.error === "string") throw new Error(message.error);
        }
      }
      if (requestIdRef.current === id && !speechQueueRef.current.done) endSpeech();
    } catch (error) {
      if (error?.name === "AbortError" || requestIdRef.current !== id) return;
      setCapturing(false);
      listenAgain();
      setNotice(error?.message || "Não consegui responder agora.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [abortRequest, applyProgress, beginSpeech, duckSpotifyVolume, endConversation, endSpeech, enqueueClip, listenAgain, markMusicPlayed, musicPlaying, openSpotifyAndPlay, router, startConversation, stopSpeaking, touchConversation, updateMusic, updatePhase]);

  // Botão de câmera da tela cheia = liga/desliga a visão (mesma configuração do cartão em /admin/alexa).
  const toggleVision = useCallback(async () => {
    const next = !visionRef.current;
    try {
      const response = await fetch("/api/admin/henry", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vision: next }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Não foi possível mudar a visão.");
      visionRef.current = Boolean(data.vision);
      setVision(Boolean(data.vision));
    } catch (error) {
      setNotice(error?.message || "Não foi possível mudar a visão.");
    }
  }, []);
  askRef.current = ask;

  // --- Tocar para falar por gravação (celular sem reconhecimento de voz) ---------------------------------------------
  // VAD Silero (mesma instância da interrupção): no app de desktop também decide o fim da fala na gravação (histerese —
  // dono, 2026-10-23). getStream entrega o microfone da gravação quando há uma, senão o da interrupção.
  const ensureVad = useCallback(async () => {
    const vad = vadRef.current;
    if (vad.instance) return vad.instance;
    if (vad.failed || vad.loading) return null;
    const context = ensureAudioContext();
    if (!context) return null;
    vad.loading = true;
    try {
      vad.instance = await createHenryVad({
        audioContext: context,
        getStream: async () => recordRef.current?.stream || micStreamRef.current,
        onSpeechStart: () => {
          vad.speaking = true;
          vad.lastAt = Date.now();
        },
        onMisfire: () => {
          vad.speaking = false;
          vad.lastAt = Date.now();
        },
        onSpeechEnd: (samples) => {
          vad.speaking = false;
          vad.lastAt = Date.now();
          confirmBargeRef.current?.(samples);
        }
      });
    } catch {
      vad.failed = true; // sem os arquivos (ex.: next dev sem prebuild): segue só com o medidor
    } finally {
      vad.loading = false;
    }
    return vad.instance;
  }, [ensureAudioContext]);

  // VAD da gravação desligado e de volta ao ajuste da interrupção.
  const releaseRecordVad = useCallback((session) => {
    if (!session?.vad) return;
    const vad = vadRef.current;
    session.vad = false;
    vad.running = false;
    vad.speaking = false;
    vad.instance?.pause().catch(() => {});
    try {
      vad.instance?.setOptions(HENRY_VAD_BARGE_OPTIONS);
    } catch {
      // instância destruída
    }
  }, []);

  const recordingDoneRef = useRef(null);

  // Fecha a gravação: microfone desligado na hora (o som volta ao alto-falante) e, se houve voz, manda o áudio para
  // transcrever. O áudio só existe na memória desta função e no corpo do pedido.
  const finishRecording = useCallback(async (session) => {
    if (session.finished) return;
    session.finished = true;
    window.clearInterval(session.timer);
    releaseRecordVad(session);
    session.stream?.getTracks().forEach((track) => track.stop());
    try {
      session.source?.disconnect();
    } catch {
      // já desligado
    }
    if (recordRef.current === session) recordRef.current = null;
    if (micAnalyserRef.current === session.analyser) micAnalyserRef.current = null;
    setRecording(false);
    setRecordHeard(false);
    const durationMs = Date.now() - session.startedAt;
    // Só o tipo base (o iPhone manda 'audio/mp4; codecs="mp4a.40.2"' ou nada): o servidor confere o formato de novo.
    const rawType = session.recorder?.mimeType || session.chunks[0]?.type || "";
    const type = String(rawType).split(";")[0].trim().toLowerCase() || "audio/mp4";
    const blob = session.chunks.length ? new Blob(session.chunks, { type }) : null;
    session.chunks = [];
    if (session.discard || !blob || !blob.size || durationMs < RECORD_MIN_MS) {
      // Continuação depois de um corte sem voz nova: vale o trecho que já tinha (nunca "Não ouvi"/"Não entendi").
      if (session.prefix && session.discard !== "cancel") {
        recordingDoneRef.current?.(session.prefix, session);
        return;
      }
      updatePhase("idle");
      henryDebug("descarte", { reason: session.discard === "cancel" ? "cancelada" : session.discard === "silence" ? "sem_voz" : "curta_demais" });
      if (session.discard !== "cancel" && missedReplyRef.current({ silent: session.discard === "silence" })) return; // pergunta aberta: repete curta, sem "Não ouvi"
      if (session.discard === "silence") setNotice("Não ouvi nada. Toque no Henry e fale.");
      return;
    }
    const id = requestIdRef.current + 1;
    requestIdRef.current = id;
    const controller = new AbortController();
    abortRef.current = controller;
    latencyRef.current = { speechEnd: session.lastVoiceAt || Date.now() };
    updatePhase("thinking");
    // Fala confirmada (voz no medidor/VAD): confirma que ouviu já, antes da transcrição. Continuação de um corte que já
    // confirmou não confirma de novo.
    if (session.heardVoice && !(session.continued && ackRef.current.preAcked)) {
      ackRef.current = { ...ackRef.current, preAcked: acknowledgeHeard({ awaitingReply: isAwaitingReply(pendingReplyRef.current) }) || ackRef.current.preAcked };
    }
    try {
      const audio = await blobToDataUrl(blob);
      const response = await fetch("/api/admin/henry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "transcribe", audio, durationMs, deviceId: deviceIdRef.current }),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (requestIdRef.current !== id) {
        henryDebug("descarte", { reason: "pedido_mais_novo" }); // outro pedido começou enquanto transcrevia
        return;
      }
      if (!response.ok) throw new Error(data?.error || "Não consegui entender o áudio agora. Tente de novo.");
      latencyRef.current = { ...latencyRef.current, transcribed: Date.now(), ...(Number.isFinite(data?.ms) ? { sttMs: data.ms } : {}) };
      recordingDoneRef.current?.(joinCutTranscripts(session.prefix, String(data?.text || "").trim()), session);
    } catch (error) {
      if (error?.name === "AbortError" || requestIdRef.current !== id) return;
      updatePhase("idle");
      setNotice(error?.message || "Não consegui entender o áudio agora. Tente de novo.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [acknowledgeHeard, releaseRecordVad, updatePhase]);

  const stopRecording = useCallback((discard = false, { autoCut = false } = {}) => {
    const session = recordRef.current;
    if (!session) return;
    session.discard = discard;
    session.autoCut = autoCut;
    window.clearInterval(session.timer);
    if (session.recorder && session.recorder.state !== "inactive") {
      try {
        session.recorder.stop(); // onstop → finishRecording (com o último pedaço do áudio)
        return;
      } catch {
        // segue para fechar
      }
    }
    finishRecording(session);
  }, [finishRecording]);

  // Começa a gravar DENTRO do toque (o iPhone exige gesto para microfone e som). Corta a fala/pedido em andamento.
  // prefix/continued = continuação depois de um corte automático (o trecho já ouvido entra na frente do próximo).
  const startRecording = useCallback(async ({ prefix = "", continued = false } = {}) => {
    if (recordRef.current) return;
    if (!continued) ackRef.current = { ...ackRef.current, preAcked: false };
    unlockAudio();
    stopSpeaking();
    abortRequest();
    setNotice("");
    setAudioSession("play-and-record");
    const session = { chunks: [], startedAt: Date.now(), firstVoiceAt: 0, lastVoiceAt: 0, heardVoice: false, finished: false, discard: false, autoCut: false, prefix, continued, vad: false, floor: 0, floorReads: 0, loudTicks: 0 };
    busyAtRef.current = Date.now();
    recordRef.current = session;
    setRecording(true);
    setRecordHeard(Boolean(prefix));
    startConversation();
    updatePhase("armed");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      session.stream = stream;
      if (recordRef.current !== session) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mimeType = pickRecorderMimeType((type) => window.MediaRecorder.isTypeSupported?.(type));
      const recorder = new window.MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 });
      session.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data?.size) session.chunks.push(event.data);
      };
      recorder.onstop = () => finishRecording(session);
      recorder.start(250);
      session.startedAt = Date.now();
      const context = ensureAudioContext();
      if (context) {
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        session.source = context.createMediaStreamSource(stream);
        session.source.connect(analyser);
        session.analyser = analyser;
        micAnalyserRef.current = analyser; // o anel reage ao volume real
      }
      // App de desktop: o VAD Silero confirma o fim da fala (se os arquivos estiverem disponíveis; senão, só o medidor).
      if (desktopBridgeRef.current) {
        ensureVad()
          .then(async (instance) => {
            if (!instance || recordRef.current !== session || session.finished) return;
            const vad = vadRef.current;
            instance.setOptions(HENRY_VAD_RECORD_OPTIONS);
            vad.speaking = false;
            vad.lastAt = 0;
            await instance.start();
            if (recordRef.current !== session || session.finished) {
              instance.pause().catch(() => {});
              instance.setOptions(HENRY_VAD_BARGE_OPTIONS);
              return;
            }
            session.vad = true;
            vad.running = true;
          })
          .catch(() => {});
      }
      session.timer = window.setInterval(() => {
        const now = Date.now();
        busyAtRef.current = now;
        // Contexto suspenso (iOS) não mede: sem medidor, só o toque ou o limite de 25 s param.
        const hasMeter = Boolean(session.analyser) && audioCtxRef.current?.state === "running";
        const vad = vadRef.current;
        // Música tocando (dono, 2026-10-23: gravações presas até 25 s): o VAD ouve a letra como voz — com a música, só o
        // medidor decide, contra o ruído de fundo medido no começo da gravação.
        const vadRunning = session.vad && vad.running && !isMusicGuardActive(musicGuardRef.current);
        const level = hasMeter ? levelFrom(session.analyser, meterBuffer) : 0;
        // Primeiros ~350 ms: só mede o ruído de fundo (o fim da fala dele no alto-falante não conta como o dono falando).
        if (hasMeter && now - session.startedAt < RECORD_START_GRACE_MS) {
          session.floor = (session.floor * session.floorReads + level) / (session.floorReads + 1);
          session.floorReads += 1;
        } else {
          const loudNow = hasMeter && level >= recordLevelThreshold({ heardVoice: session.heardVoice, floor: session.floor });
          session.loudTicks = loudNow ? session.loudTicks + 1 : 0;
          // Começo da voz: 2 leituras seguidas (~200 ms); depois de ouvir voz, 1 leitura já mantém a fala viva.
          const loud = loudNow && (session.heardVoice || session.loudTicks >= RECORD_VOICE_CONFIRM_TICKS);
          if (loud || (vadRunning && vad.speaking)) {
            if (!session.heardVoice) setRecordHeard(true);
            if (!session.firstVoiceAt) session.firstVoiceAt = now;
            session.heardVoice = true;
            session.lastVoiceAt = now;
            lastHeardRef.current = now;
            markActivity();
          }
        }
        const decision = recordingDecision({
          startedAt: session.startedAt,
          firstVoiceAt: session.firstVoiceAt,
          lastVoiceAt: session.lastVoiceAt,
          heardVoice: session.heardVoice,
          hasMeter,
          now,
          waitMs: endWaitMsRef.current,
          awaitingReply: isAwaitingReply(pendingReplyRef.current, now),
          vadRunning,
          vadSpeaking: vad.speaking,
          vadEndedAt: vad.lastAt,
          // Continuação de um corte com trecho já ouvido espera menos; continuação de transcrição vazia (nada ouvido
          // ainda — a resposta pode estar chegando agora) espera o tempo normal.
          noSpeechMs: session.continued && session.prefix ? RECORD_CONTINUE_NO_SPEECH_MS : undefined
        });
        // Corte automático por silêncio (não pelo limite de tempo): a transcrição curta/vazia pode continuar ouvindo.
        if (decision) stopRecording(decision === "discard" ? "silence" : false, { autoCut: decision === "send" && now - session.startedAt < RECORD_MAX_MS });
      }, 100);
    } catch {
      if (recordRef.current === session) recordRef.current = null;
      session.stream?.getTracks().forEach((track) => track.stop());
      setRecording(false);
      setRecordHeard(false);
      updatePhase("idle");
      setNotice("Não consegui abrir o microfone. Libere o microfone para o app (Ajustes do iPhone > Safari > Microfone).");
    }
  }, [abortRequest, ensureAudioContext, ensureVad, finishRecording, markActivity, setAudioSession, startConversation, stopRecording, stopSpeaking, unlockAudio, updatePhase]);

  // Texto da gravação (já com o trecho anterior, se foi continuação) → pedido. Depois de um corte automático, frase vazia
  // ou cortada continua ouvindo UMA vez e junta o próximo trecho (dono, 2026-10-23: nunca "Não entendi" depois de um corte).
  recordingDoneRef.current = (text, session) => {
    const awaitingReply = isAwaitingReply(pendingReplyRef.current);
    if (shouldContinueAfterCut(text, { autoCut: session.autoCut, continued: session.continued, awaitingReply })) {
      henryDebug("continua", { reason: text ? "frase_cortada" : "vazia" });
      updatePhase("idle");
      startRecording({ prefix: text, continued: true });
      return;
    }
    const afterCut = session.autoCut || session.continued;
    // Gravação aberta pelo próprio Henry (toque, atalho, nome no app, depois de uma pergunta dele): texto NÃO vazio SEMPRE
    // vira pedido (dono, 2026-10-23). Só o eco evidente da frase que ele acabou de falar é descartado. A guarda da música
    // e da "letra" vale só para a escuta contínua sem gatilho (handleFinal), nunca aqui.
    const spoken = [lastReplyRef.current, currentClipRef.current.text].filter(Boolean);
    const intent = triggeredTranscriptIntent(text, { spoken, continued: session.continued });
    if (intent.kind === "report") askRef.current?.({ mode: "report", question: "", shown: text });
    else if (intent.kind === "question") askRef.current?.({ mode: "question", question: intent.question, shown: text });
    else if (intent.kind === "wake") {
      // Só o nome: continua ouvindo (uma vez) para o pedido; de novo só o nome, vira pergunta (triggeredTranscriptIntent).
      henryDebug("continua", { reason: "so_o_nome" });
      updatePhase("idle");
      startRecording({ prefix: "", continued: true });
    } else {
      henryDebug("descarte", { reason: intent.reason || "vazia" });
      updatePhase("idle");
      // Transcrição vazia com pergunta aberta (ex.: "Posso dar play?" e a música abafou o "pode"): repete curta, uma vez.
      if (intent.reason === "empty" && missedReplyRef.current()) return;
      setNotice(intent.reason === "echo" ? "Ouvi a minha própria voz. Toque no Henry e fale de novo." : afterCut ? "Não ouvi nada. Toque no Henry e fale." : "Não entendi. Toque no Henry e fale de novo.");
    }
  };

  const startRecordingRef = useRef(null);
  startRecordingRef.current = startRecording;

  // Toque no anel ou no microfone (modo gravação): começa a gravar; tocando de novo, envia.
  const talk = useCallback(() => {
    if (recordRef.current) stopRecording(false);
    else startRecording();
  }, [startRecording, stopRecording]);

  // Saiu do modo gravação ou desmontou: microfone desligado.
  useEffect(() => () => recordRef.current && stopRecording("cancel"), [stopRecording]);

  // O que o Henry está falando agora (filtro de eco da interrupção) = a parte da fila QUE ESTÁ TOCANDO (dono, 2026-10-23),
  // mais a parte anterior no 1,5 s inicial (o reconhecedor entrega o fim da frase anterior com atraso). Antes de a 1ª parte
  // tocar, a resposta inteira. Pensando: a frase de espera que está tocando (ele nunca interrompe a si mesmo).
  const currentSpeech = useCallback(() => {
    if (phaseRef.current === "thinking") return narratingTextRef.current;
    const clip = currentClipRef.current;
    if (!clip.text) return lastReplyRef.current;
    return clip.prevText && Date.now() - clip.startedAt < 1500 ? `${clip.prevText} ${clip.text}` : clip.text;
  }, []);

  // Voz do dono confirmada no microfone (cancelamento de eco ligado): pelo VAD quando ele está rodando; senão pelo medidor.
  const voiceConfirmed = useCallback((windowMs = 1500) => {
    const vad = vadRef.current;
    const now = Date.now();
    if (vad.running) return vad.speaking || now - vad.lastAt < windowMs;
    return !micAnalyserRef.current || now - micLoudAtRef.current < windowMs;
  }, []);

  // Interrupção: corta a voz e cancela o pedido (chamado já no resultado parcial, para parar em menos de 0,5 s).
  const interrupt = useCallback(() => {
    stopSpeaking();
    abortRequest();
  }, [abortRequest, stopSpeaking]);

  // App de desktop (sem reconhecimento do Chrome), 2ª etapa da interrupção: o trecho em que o VAD ouviu voz (só ele, só na
  // memória) vai para a transcrição; parada/nome ou fala do dono que não é eco → para de vez e ouve o pedido (a fala com
  // pergunta já vira o pedido). Nada confirmado → o volume volta sozinho.
  const confirmBargeByTranscript = useCallback(async (samples) => {
    if (bargeModeRef.current !== "transcribe" || phaseRef.current !== "speaking" || bargeBusyRef.current) return;
    const durationMs = Math.round((samples?.length || 0) / 16);
    if (durationMs < BARGE_SEGMENT_MIN_MS) return;
    const clipText = currentSpeech();
    const piece = durationMs > BARGE_SEGMENT_MAX_MS ? samples.subarray(0, BARGE_SEGMENT_MAX_MS * 16) : samples;
    bargeBusyRef.current = true;
    duckRef.current.waitingSince = Date.now();
    try {
      const audio = await blobToDataUrl(new Blob([floatToWavBytes(piece, 16000)], { type: "audio/wav" }));
      const response = await fetch("/api/admin/henry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "transcribe", audio, durationMs: Math.min(durationMs, BARGE_SEGMENT_MAX_MS), deviceId: deviceIdRef.current })
      });
      const data = await response.json().catch(() => ({}));
      const text = response.ok ? String(data?.text || "").trim() : "";
      if (!text || phaseRef.current !== "speaking") {
        henryDebug("descarte", { reason: text ? "interrupcao_tarde" : "interrupcao_vazia" });
        return;
      }
      const withMusic = isMusicGuardActive(musicGuardRef.current); // música tocando: só comando forte
      const named = withMusic ? detectMusicBargeIn(text) : detectBargeIn(text, clipText);
      const barge = named.interrupt || withMusic ? named : detectSpeechBargeIn(text, clipText, { final: true });
      if (!barge.interrupt) {
        henryDebug("descarte", { reason: "interrupcao_nao_confirmada" }); // trecho ouvido enquanto ele falava (eco/sala)
        return;
      }
      interrupt();
      startConversation();
      setHeard({ text: text.slice(0, 80), at: Date.now(), accepted: true });
      if (barge.kind === "question") askRef.current?.({ mode: "question", question: barge.question, shown: text });
      else if (barge.kind === "report") askRef.current?.({ mode: "report", question: "", shown: text });
      else startRecordingRef.current?.(); // "para"/"Henry": já ouve o pedido
    } catch {
      // sem rede: o volume volta e ele segue falando (tocar continua interrompendo)
    } finally {
      bargeBusyRef.current = false;
      duckRef.current.waitingSince = 0;
    }
  }, [currentSpeech, interrupt, startConversation]);

  // Frase final reconhecida. Fora do modo conversa só age se começar pelo nome; em conversa, qualquer frase (menos eco e
  // ruído) vira pergunta. Falando/pensando, só o nome e as palavras de parada valem. O resto é descartado aqui.
  // Devolve true quando a frase foi aceita (virou pedido, parada ou fim de conversa) — o status mostra "Ouvi: …" e, só
  // quando foi ignorada, "(diga 'Henry' antes)". Tela cheia aberta = já está chamando (sem o nome; dono, 2026-10-22).
  // armed = o parcial deste trecho trouxe o nome e a final veio sem ele (o Chrome corta o "Henry" da final, principalmente
  // logo depois de reiniciar): vale como chamada (dono, 2026-10-22: minimizado "escuta, mas não responde").
  const handleFinal = useCallback((raw, { armed = false } = {}) => {
    const text = String(raw || "").trim();
    if (!text) return false;
    if (alertAnswerRef.current(text)) return true; // resposta ao "Chefe?" do aviso de cliente
    const conversation = conversationRef.current;
    const spoken = [lastReplyRef.current];
    const ask = (mode, question) => {
      // Lidos ANTES do pedido (ask zera a pergunta aberta): resposta a uma pergunta dele e comando resolvido na hora não
      // ganham confirmação de escuta.
      const awaitingReply = isAwaitingReply(pendingReplyRef.current);
      const instant = mode === "question" && (isReadAlertsCommand(question) || Boolean(desktopBridgeRef.current && detectScreenCommand(question)));
      askRef.current?.({ mode, question, shown: text });
      acknowledgeHeard({ mode, question, awaitingReply, instant });
    };
    if (conversation.active && isConversationEnd(text) && !isEchoOf(text, spoken)) {
      interrupt();
      endConversation();
      sayGoodbye();
      return true;
    }
    if (phaseRef.current === "speaking" || phaseRef.current === "thinking") {
      // Falando (computador): qualquer frase dele que não seja eco interrompe e vira a nova pergunta; pensando: só o nome
      // e as palavras de parada. Fala comum (e parada que também está na frase dele) só com a voz confirmada no microfone.
      // Música tocando: só comando forte (nome no começo, "para", "espera", "pausa") — a letra nunca interrompe.
      const withMusic = isMusicGuardActive(musicGuardRef.current);
      const named = withMusic ? detectMusicBargeIn(text) : detectBargeIn(text, currentSpeech());
      const speechBarge = !withMusic && phaseRef.current === "speaking" && bargeModeRef.current !== "tap";
      const barge = named.interrupt || !speechBarge ? named : detectSpeechBargeIn(text, currentSpeech(), { final: true });
      if (!barge.interrupt) return false;
      if ((named.interrupt ? named.echoRisk : true) && !voiceConfirmed(3000)) return false;
      interrupt();
      startConversation();
      if (barge.kind === "question") ask("question", barge.question); // "Henry, e ontem?" → responde direto, sem bipe
      else if (barge.kind === "report") ask("report", "");
      else listenAgain();
      return true;
    }
    // Música tocando (dono, 2026-10-23: "o Henry fica respondendo as músicas"): sem conversa sem o nome, nem tela cheia
    // "já chamando" — só o NOME no começo da frase; logo depois de um chamado (nome sozinho, atalho/app), a frase seguinte
    // vale sem o nome, menos a que tem cara de letra. Acordou → a música abaixa enquanto ele escuta e responde.
    if (isMusicGuardActive(musicGuardRef.current)) {
      const explicit = musicGuardRef.current.explicitUntil > Date.now();
      const awaitingReply = isAwaitingReply(pendingReplyRef.current); // ele perguntou: resposta curta vale sem o nome
      const gate = musicListenGate(text, { explicit, awaitingReply });
      if (!gate.accept || isEchoOf(text, spoken)) {
        henryDebug("descarte", { reason: gate.accept ? "eco" : `musica_${gate.reason}` });
        return false;
      }
      musicGuardRef.current = { ...musicGuardRef.current, explicitUntil: 0 };
      duckSpotifyVolume();
      const intent = gate.named ? classifyArmedUtterance(text, spoken) : classifyTapUtterance(text);
      if (intent.kind === "report" || intent.kind === "question") {
        startConversation();
        ask(intent.kind, intent.question);
        return true;
      }
      if (intent.kind === "wake") {
        musicGuardRef.current = { ...musicGuardRef.current, explicitUntil: Date.now() + 10000 };
        startConversation({ sound: true });
        listenAgain();
        return true;
      }
      return false;
    }
    const detected = detectWakeWord(text);
    if (detected.called && !isEchoOf(text, spoken)) {
      startConversation({ sound: detected.kind === "wake" });
      if (detected.kind === "report") ask("report", "");
      else if (detected.kind === "question") ask("question", detected.question);
      else listenAgain();
      return true;
    }
    if (armed && !isEchoOf(text, spoken)) {
      const intent = classifyArmedUtterance(text, spoken);
      if (intent.kind) {
        startConversation({ sound: intent.kind === "wake" });
        if (intent.kind === "wake") listenAgain();
        else ask(intent.kind, intent.question);
        return true;
      }
    }
    if (expandedRef.current) {
      const intent = classifyOpenSceneUtterance(text, spoken);
      if (intent.kind === "report" || intent.kind === "question") {
        startConversation();
        ask(intent.kind, intent.question);
        return true;
      }
      if (isStopCommand(text)) {
        listenAgain();
        return true;
      }
      return false;
    }
    if (!conversation.active || isConversationExpired(conversation.lastAt)) return false;
    if (isStopCommand(text)) {
      listenAgain();
      return true;
    }
    if (acceptFollowUp(text, spoken)) {
      ask("question", text);
      return true;
    }
    return false;
  }, [acknowledgeHeard, currentSpeech, duckSpotifyVolume, endConversation, interrupt, listenAgain, sayGoodbye, startConversation, voiceConfirmed]);

  // --- Avisos de cliente novo e transferido (HENRY-1, dono 2026-10-23) -----------------------------------------------
  // "Sempre depois de chefe? Ou patrão? etc., ele aguarda uma resposta minha, como 'sim, pode falar' ou 'oi', aí ele me
  // passa a informação." Consulta leve a cada ~30 s com o Henry parado (só no aparelho ativo, uma aba por aparelho, 7h–22h,
  // fora do mudo). Evento novo → fala só o vocativo e abre o microfone (janela de conversa). "Pode falar" → a informação;
  // "agora não" → "depois te falo" e tenta em ~10 min; sem resposta em ~9 s → chama de novo; de novo sem resposta → fica
  // pendente (indicador na tela; tocar faz ele falar); outra pergunta → responde e depois oferece o aviso.
  const alertIdle = () => phaseRef.current === "idle" && !conversationRef.current.active && !recordRef.current && !mutedRef.current;

  const alertAudioKey = (text) => `mm-henry-alert-audio:${narrationKeyRef.current}:${text}`;
  const alertPhraseAudio = useCallback(async (text) => {
    try {
      const cached = JSON.parse(window.sessionStorage.getItem(alertAudioKey(text)) || "null");
      if (cached?.base64) return cached;
    } catch {
      // sem cache
    }
    try {
      const response = await fetch("/api/admin/henry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "client_alerts", action: "phrase", text }) });
      const data = await response.json().catch(() => ({}));
      if (data?.audio?.base64) {
        try {
          window.sessionStorage.setItem(alertAudioKey(text), JSON.stringify(data.audio));
        } catch {
          // sessão cheia: toca sem guardar
        }
      }
      return data?.audio || null;
    } catch {
      return null;
    }
  }, []);

  const syncPending = useCallback((pending) => setPendingAlerts(Array.isArray(pending) ? pending.length : 0), []);

  // Fala uma linha do aviso pela mesma fila da resposta (texto também na tela, sem card).
  const sayAlertLine = useCallback((text, audio) => {
    const withLine = [...turnsRef.current, { role: "assistant", text }];
    turnsRef.current = withLine;
    setTurns(withLine);
    beginSpeech(text);
    enqueueClip({ audio: audio || null, text });
    endSpeech();
  }, [beginSpeech, endSpeech, enqueueClip]);

  // Chamado: só o vocativo (ou "posso falar?"), depois o microfone fica aberto esperando a resposta.
  // Fila da fala espontânea: toca o primeiro da fila quando o Henry está ocioso há ~3 s (canSpeakSpontaneously).
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => {
      const queue = spontaneousRef.current;
      if (!queue.length) return;
      const now = Date.now();
      const fresh = queue.filter((item) => now - item.at < SPONTANEOUS_MAX_AGE_MS);
      if (fresh.length !== queue.length) spontaneousRef.current = fresh;
      const next = fresh[0];
      if (!next || mutedRef.current) return;
      const free = canSpeakSpontaneously({
        phase: phaseRef.current,
        recording: Boolean(recordRef.current),
        playing: speechQueueRef.current.playing,
        awaitingReply: !next.allowAwaiting && isAwaitingReply(pendingReplyRef.current, now),
        busyAt: busyAtRef.current,
        heardAt: lastHeardRef.current,
        now
      });
      if (!free) return;
      spontaneousRef.current = spontaneousRef.current.filter((item) => item !== next);
      henryDebug("fala_espontanea", { kind: next.kind, esperou_ms: now - next.at });
      next.run();
    }, 400);
    return () => window.clearInterval(timer);
  }, [active]);

  const callForAlertNow = useCallback(async ({ kind = "vocative", text = "", audio = null } = {}) => {
    if (mutedRef.current) return;
    const store = readAlertStore();
    let line = text;
    if (!line) {
      const recentKey = kind === "vocative" ? "vocatives" : `phrases_${kind}`;
      const picked = pickAlertPhrase(kind, Array.isArray(store[recentKey]) ? store[recentKey] : []);
      writeAlertStore({ [recentKey]: picked.recent });
      line = picked.text;
    }
    const token = requestIdRef.current;
    const voice = audio || (await alertPhraseAudio(line));
    // Enquanto a voz do chamado carregava o dono pediu outra coisa (ou abriu a gravação): não chama por cima.
    if (requestIdRef.current !== token || recordRef.current || phaseRef.current === "thinking" || phaseRef.current === "speaking") {
      henryDebug("fala_espontanea", { kind: "aviso", adiada: true });
      return;
    }
    window.clearTimeout(alertRef.current.timer);
    alertRef.current = { ...alertRef.current, stage: "calling", calls: alertRef.current.stage === "calling" || alertRef.current.stage === "waiting" ? alertRef.current.calls + 1 : 1, offer: kind !== "vocative" };
    startConversation(); // a resposta vale sem dizer "Henry" (janela de conversa)
    pendingReplyRef.current = openPendingReply("alert");
    if (musicPlaying()) duckSpotifyVolume(); // música baixa no chamado e na espera da resposta
    // App de desktop com a janela escondida/minimizada: aviso do Windows (sem nome nem dado do cliente); clicar abre o CRM.
    if (desktopBridgeRef.current && document.visibilityState === "hidden") {
      Promise.resolve(desktopBridgeRef.current.notify("Henry", "Chefe? Tenho um aviso de cliente para você.")).catch(() => {});
    }
    sayAlertLine(line, voice);
  }, [alertPhraseAudio, duckSpotifyVolume, musicPlaying, sayAlertLine, startConversation]);
  const callForAlert = useCallback((options = {}, { allowAwaiting = false } = {}) => saySpontaneous("aviso", () => callForAlertNow(options), { allowAwaiting }), [callForAlertNow, saySpontaneous]);

  // "Pode falar" (ou toque no indicador): a informação, com os dados relidos agora; um resumo quando são vários.
  const tellAlerts = useCallback(async ({ command = false } = {}) => {
    window.clearTimeout(alertRef.current.timer);
    const store = readAlertStore();
    const pending = pruneAlertPending(store.pending || []);
    if (!pending.length) {
      alertRef.current = { ...alertRef.current, stage: "idle", calls: 0 };
      syncPending([]);
      // "Leia os avisos" sem nada guardado: diz que não tem (frase fixa, na voz dele).
      if (command) {
        const picked = pickAlertPhrase("none", Array.isArray(store.phrases_none) ? store.phrases_none : []);
        writeAlertStore({ phrases_none: picked.recent });
        const audio = await alertPhraseAudio(picked.text);
        sayAlertLine(picked.text, audio);
      }
      return;
    }
    alertRef.current = { ...alertRef.current, stage: "telling", calls: 0 };
    updatePhase("thinking");
    const token = requestIdRef.current;
    const noticeIds = pending.filter((item) => item.kind === "notice" && item.noticeId).map((item) => item.noticeId);
    let data = null;
    try {
      const response = await fetch("/api/admin/henry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "client_alerts", action: "speak", clientIds: pending.filter((item) => item.clientId).map((item) => item.clientId), userIds: pending.filter((item) => item.kind === "arrival" && item.userId).map((item) => item.userId), noticeIds, recent: store.recent || null, away: store.away === true, voice: !mutedRef.current })
      });
      data = await response.json().catch(() => null);
      if (!response.ok) data = null;
    } catch {
      data = null;
    }
    // O dono pediu outra coisa enquanto o aviso carregava: não fala por cima (o aviso continua pendente).
    if (requestIdRef.current !== token || recordRef.current) {
      alertRef.current = { ...alertRef.current, stage: "idle" };
      henryDebug("fala_espontanea", { kind: "aviso_conteudo", adiada: true });
      return;
    }
    if (!data) {
      alertRef.current = { ...alertRef.current, stage: "idle" };
      listenAgain();
      if (command) setNotice("Não consegui ler os avisos agora. Tente de novo.");
      return; // falhou: o aviso continua pendente (indicador) para tentar de novo
    }
    // Avisos da Central lidos: "visto" pelo MESMO caminho da tela e fora do pendente; a Central não mostra mais o card.
    const readNotices = Array.isArray(data.noticeIds) ? data.noticeIds : [];
    if (readNotices.length) {
      fetch("/api/admin/alerts/shown", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: readNotices }) }).catch(() => {});
      window.dispatchEvent(new CustomEvent(HENRY_NOTICE_DONE_EVENT, { detail: { ids: readNotices } }));
    }
    const left = pending.filter((item) => item.kind === "notice" && !readNotices.includes(item.noticeId));
    writeAlertStore({ pending: left, away: false, retries: 0, retryAt: 0, recent: data.recent || store.recent || null });
    syncPending(left);
    alertRef.current = { ...alertRef.current, stage: "idle" };
    if (data.text) sayAlertLine(data.text, data.audio);
    else listenAgain();
  }, [alertPhraseAudio, listenAgain, sayAlertLine, syncPending, updatePhase]);
  const readAlertsRef = useRef(null);
  readAlertsRef.current = () => tellAlerts({ command: true });

  // Sem resposta: chama mais uma vez; depois disso fica pendente (nada é falado) e tenta em ~10 min (até 3 vezes).
  const alertNoAnswer = useCallback(() => {
    if (alertRef.current.stage !== "waiting") return;
    if (alertRef.current.calls < ALERT_MAX_CALLS && !alertRef.current.offer && !mutedRef.current) {
      const store = readAlertStore();
      const picked = pickAlertPhrase("vocative", Array.isArray(store.vocatives) ? store.vocatives : []);
      writeAlertStore({ vocatives: picked.recent });
      callForAlert({ text: picked.text }, { allowAwaiting: true });
      return;
    }
    const store = readAlertStore();
    const retries = Number(store.retries || 0) + 1;
    writeAlertStore({ away: true, retries, retryAt: retries < ALERT_MAX_RETRIES ? Date.now() + ALERT_RETRY_MS : 0 });
    alertRef.current = { ...alertRef.current, stage: "idle", calls: 0 };
    endConversation({ sound: false });
  }, [callForAlert, endConversation]);

  // Resposta do dono enquanto espera (devolve true quando a frase foi consumida pelo aviso).
  alertAnswerRef.current = (raw) => {
    const current = alertRef.current;
    if (current.stage !== "waiting" && current.stage !== "calling") return false;
    const text = String(raw || "").trim();
    if (!text || isEchoOf(text, [lastReplyRef.current])) return false;
    const answer = classifyAlertAnswer(text);
    if (answer === "noise") {
      henryDebug("descarte", { reason: "ruido_no_aviso" });
      return true;
    }
    window.clearTimeout(current.timer);
    pendingReplyRef.current = { active: false };
    if (answer === "yes") {
      stopSpeaking();
      tellAlerts();
      return true;
    }
    if (answer === "no") {
      stopSpeaking();
      alertRef.current = { ...current, stage: "idle", calls: 0 };
      writeAlertStore({ retryAt: Date.now() + ALERT_RETRY_MS, retries: 0 });
      callLaterRef.current();
      return true;
    }
    // Outra coisa (ex.: uma pergunta): segue como pergunta e, no fim da resposta, oferece o aviso.
    alertRef.current = { ...current, stage: "idle", calls: 0 };
    return false;
  };
  // Resposta à pergunta aberta não veio (gravação vazia, só silêncio ou descartada pela guarda da música): em vez de
  // "Não entendi", repete a pergunta curta UMA vez ("Posso dar play?"); de novo sem resposta, fica no aguardo (o passo do
  // bom dia continua valendo na janela de conversa). Chamado do aviso: o próprio aviso chama de novo (alertNoAnswer).
  // Devolve true quando cuidou do caso (a tela não mostra o aviso antigo).
  // silent = só silêncio: pergunta comum não ganha "Não peguei" (ele não ouviu nada) — só sai do aguardo, sem aviso.
  missedReplyRef.current = ({ silent = false } = {}) => {
    const pending = pendingReplyRef.current;
    if (!pending.active || mutedRef.current) return false;
    if (pending.kind === "alert") return true;
    if (silent && pending.kind === "question") {
      pendingReplyRef.current = { active: false };
      return true;
    }
    const text = repeatQuestionFor(pending);
    if (!text) {
      pendingReplyRef.current = { active: false };
      setNotice("Fico no aguardo: toque no Henry quando quiser responder.");
      return true;
    }
    pendingReplyRef.current = { ...pending, retried: true };
    saySpontaneous("repetir_pergunta", () => {
      pendingReplyRef.current = { ...openPendingReply(pending.kind), retried: true };
      startConversation();
      if (musicPlaying()) duckSpotifyVolume();
      const token = requestIdRef.current;
      alertPhraseAudio(text).then((audio) => {
        if (requestIdRef.current !== token || recordRef.current) return; // o dono já falou outra coisa
        sayAlertLine(text, audio);
      });
    }, { allowAwaiting: true });
    return true;
  };
  const callLaterRef = useRef(() => {});
  callLaterRef.current = () => {
    const store = readAlertStore();
    const picked = pickAlertPhrase("later", Array.isArray(store.phrases_later) ? store.phrases_later : []);
    writeAlertStore({ phrases_later: picked.recent });
    const token = requestIdRef.current;
    alertPhraseAudio(picked.text).then((audio) => {
      if (requestIdRef.current !== token || recordRef.current) return;
      sayAlertLine(picked.text, audio);
    });
  };

  // Fim da fala: chamado terminou → espera a resposta; pergunta normal terminou com aviso pendente → oferece.
  useEffect(() => {
    if (phase === "speaking" || phase === "thinking") return;
    const current = alertRef.current;
    if (current.stage === "calling") {
      if (recordModeRef.current && desktopBridgeRef.current) {
        // App de desktop (sem reconhecimento do Chrome): o app abre o microfone sozinho e grava a resposta. Gravando ou
        // transcrevendo, a espera é estendida (não chama de novo por cima da resposta).
        const waitForAnswer = () => {
          if (recordRef.current || phaseRef.current === "thinking") {
            alertRef.current.timer = window.setTimeout(waitForAnswer, 3000);
            return;
          }
          alertNoAnswer();
        };
        alertRef.current = { ...current, stage: "waiting", timer: window.setTimeout(waitForAnswer, ALERT_ANSWER_WAIT_MS) };
        startRecording();
        return;
      }
      if (recordModeRef.current) {
        // Celular por gravação: sem microfone aberto sozinho — fica pendente; tocar no indicador faz ele falar.
        alertRef.current = { ...current, stage: "idle", calls: 0 };
        writeAlertStore({ away: true });
        return;
      }
      alertRef.current = { ...current, stage: "waiting", timer: window.setTimeout(() => alertNoAnswer(), ALERT_ANSWER_WAIT_MS) };
      return;
    }
    if (!current.afterAsk) return;
    alertRef.current = { ...current, afterAsk: false };
    const pending = pruneAlertPending(readAlertStore().pending || []);
    if (!pending.length || current.stage !== "idle" || mutedRef.current || !current.deviceActive || !isAlertHour(saoPauloNow().minutes)) return;
    if (Date.now() - Number(current.offeredAt || 0) < ALERT_OFFER_GAP_MS) return; // não insiste a cada resposta
    alertRef.current.offeredAt = Date.now();
    callForAlert({ kind: readAlertStore().away ? "resume" : "offer" });
  }, [phase, alertNoAnswer, callForAlert, startRecording]);

  // Consulta periódica + nova tentativa dos pendentes.
  useEffect(() => {
    if (!active || !alertsOn) return undefined;
    const initial = readAlertStore();
    const kept = pruneAlertPending(initial.pending || []);
    writeAlertStore({ pending: kept });
    syncPending(kept);
    let busy = false;
    const tick = async () => {
      // Avisos da Central que passaram de 2 h sem serem lidos: voltam como card na tela (nunca somem).
      const before = readAlertStore().pending || [];
      const expired = before.filter((item) => item.kind === "notice" && !pruneAlertPending([item]).length).map((item) => item.noticeId);
      if (expired.length) {
        writeAlertStore({ pending: before.filter((item) => !expired.includes(item.noticeId)) });
        window.dispatchEvent(new CustomEvent(HENRY_NOTICE_DONE_EVENT, { detail: { ids: expired, release: true } }));
      }
      if (busy || !claimAlertLeader(tabIdRef.current)) return;
      const now = Date.now();
      const store = readAlertStore();
      // Aviso novo da Central: o mesmo chamado do aviso de cliente ("Ô, patrão?" → "pode falar" → conta).
      if (noticeCallRef.current && alertRef.current.stage === "idle" && alertIdle() && alertRef.current.deviceActive && isAlertHour(saoPauloNow().minutes) && pruneAlertPending(store.pending || []).some((item) => item.kind === "notice")) {
        noticeCallRef.current = false;
        writeAlertStore({ retries: 0 });
        callForAlert({ kind: "vocative" });
      }
      if (alertRef.current.stage !== "idle" || !alertIdle()) return;
      if (now >= Number(alertRef.current.nextPollAt || 0)) {
        busy = true;
        alertRef.current.nextPollAt = now + ALERT_POLL_MS;
        try {
          const seen = (store.seen || []).map((item) => item.key);
          const picked = pickAlertPhrase("vocative", Array.isArray(store.vocatives) ? store.vocatives : []);
          const response = await fetch("/api/admin/henry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "client_alerts", action: "poll", since: store.cursor || "", seen, deviceId: deviceIdRef.current, call: picked.text, voice: !mutedRef.current })
          });
          const data = response.ok ? await response.json().catch(() => null) : null;
          if (data?.disabled) {
            setAlertsOn(false);
            return;
          }
          if (!data) return;
          alertRef.current.deviceActive = data.skipped !== "other_device";
          if (data.hold) {
            alertRef.current.nextPollAt = Date.now() + ALERT_HOLD_POLL_MS;
            return;
          }
          const events = Array.isArray(data.events) ? data.events : [];
          const latest = readAlertStore();
          const pending = mergeAlertPending(pruneAlertPending(latest.pending || []), events);
          writeAlertStore({ cursor: data.cursor || latest.cursor || "", pending, seen: addAlertSeen(latest.seen || [], events.map((item) => item.key)) });
          syncPending(pending);
          // Fora do horário ou no mudo: fica pendente e tenta de novo depois (às 7h, ou ao sair do mudo).
          if (events.length && data.quiet && !Number(latest.retryAt || 0)) writeAlertStore({ retryAt: Date.now() + ALERT_RETRY_MS });
          if (events.length && !data.quiet && alertIdle()) {
            writeAlertStore({ vocatives: picked.recent, retries: 0 });
            callForAlert({ text: picked.text, audio: data.callAudio || null });
          }
        } catch {
          // rede: tenta na próxima rodada
        } finally {
          busy = false;
        }
        return;
      }
      // Pendente adiado ("agora não") ou sem resposta: nova tentativa em ~10 min.
      const retryAt = Number(store.retryAt || 0);
      if (retryAt && now >= retryAt && alertRef.current.deviceActive && pruneAlertPending(store.pending || []).length && isAlertHour(saoPauloNow().minutes)) {
        writeAlertStore({ retryAt: 0 });
        callForAlert({ kind: "vocative" });
      }
    };
    const timer = window.setInterval(tick, 5000);
    tick();
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(alertRef.current.timer);
    };
  }, [active, alertsOn, callForAlert, syncPending]);

  // --- Avisos da Central por voz (dono, 2026-10-23) ---------------------------------------------------------------
  // Ativo = Henry ligado nesta página, opção ligada, fora do mudo, aparelho ativo dos avisos e 7h–22h. A Central de
  // Alertas (AlertCenterGate) guarda os INFORMATIVOS enquanto isso vale e os manda para cá; desligou/fechou → voltam
  // como card. Os IMPORTANTES (bloqueiam o CRM) nunca passam por aqui.
  const noticeCallRef = useRef(false);
  useEffect(() => {
    let current = false;
    const publish = (value) => {
      if (value === current) return;
      current = value;
      window.__mmHenryVoiceNotices = { active: value };
      window.dispatchEvent(new CustomEvent(HENRY_VOICE_NOTICES_EVENT, { detail: { active: value } }));
    };
    const sync = () => publish(Boolean(active && alertsOn && voiceNotices && !mutedRef.current && alertRef.current.deviceActive && isAlertHour(saoPauloNow().minutes)));
    sync();
    const timer = window.setInterval(sync, 3000);
    return () => {
      window.clearInterval(timer);
      publish(false);
    };
  }, [active, alertsOn, voiceNotices]);
  useEffect(() => {
    const onItems = (event) => {
      const items = noticePendingItems(event?.detail?.items || []).map((item) => ({ ...item, at: new Date().toISOString() })); // prazo de 2 h conta daqui
      if (!items.length) return;
      const store = readAlertStore();
      const known = new Set((store.pending || []).map((item) => item.key));
      const fresh = items.filter((item) => !known.has(item.key));
      if (!fresh.length) return;
      const pending = mergeAlertPending(pruneAlertPending(store.pending || []), fresh);
      writeAlertStore({ pending });
      syncPending(pending);
      noticeCallRef.current = true; // chama quando ele estiver ocioso (tick dos avisos)
    };
    window.addEventListener(HENRY_NOTICE_ITEMS_EVENT, onItems);
    return () => window.removeEventListener(HENRY_NOTICE_ITEMS_EVENT, onItems);
  }, [syncPending]);

  // Toque no indicador "Aviso pendente (N)": fala na hora (o toque também libera o som no celular).
  const hearPendingAlerts = useCallback(() => {
    unlockAudio();
    stopSpeaking();
    tellAlerts();
  }, [stopSpeaking, tellAlerts, unlockAudio]);

  // Fim do modo conversa por silêncio (~40 s sem troca; nunca no meio de uma resposta).
  useEffect(() => {
    if (!inConversation) return undefined;
    const timer = window.setInterval(() => {
      const current = conversationRef.current;
      if (!current.active || phaseRef.current === "thinking" || phaseRef.current === "speaking") return;
      if (isConversationExpired(current.lastAt)) endConversation();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [inConversation, endConversation]);

  // Enquanto ele fala (computador e app de desktop): microfone com cancelamento de eco + detector de voz local (VAD).
  // 1ª etapa: VAD ouviu voz e o medidor confirma volume (~0,055 por ~150 ms) → volume dele a 25% na hora. 2ª etapa: o
  // parcial do Chrome (onresult) ou o trecho transcrito (app de desktop) confirma → para de vez. Sem confirmação em ~1,5 s
  // depois que a voz acabou → o volume volta. Sem VAD (arquivo não carregou), só o medidor confirma o parcial, sem baixar
  // o volume. Celular: nada disso (tocar para interromper).
  const micLoudRef = useRef(false);
  const bargeActive = phase === "speaking" && bargeMode !== "tap" && active && !muted;
  useEffect(() => {
    if (!bargeActive) {
      micLoudRef.current = false;
      if (duckRef.current.ducked) setDuck(false);
      return undefined;
    }
    let cancelled = false;
    const vad = vadRef.current;
    // App de desktop: não há escuta contínua — o microfone abre só enquanto ele fala e fecha depois.
    const ownsMic = bargeModeRef.current === "transcribe";
    const begin = async () => {
      if (!micStreamRef.current) await startMicMeter();
      if (cancelled) {
        if (ownsMic && phaseRef.current !== "speaking") stopMicMeter(); // abriu depois que ele parou
        return;
      }
      if (!micStreamRef.current || vad.failed) return;
      await ensureVad();
      if (cancelled || !vad.instance || !micStreamRef.current) return;
      try {
        vad.instance.setOptions(HENRY_VAD_BARGE_OPTIONS);
        await vad.instance.start();
        vad.running = !cancelled;
        if (cancelled) vad.instance.pause().catch(() => {});
      } catch {
        vad.running = false;
      }
    };
    begin();
    let since = 0;
    const timer = window.setInterval(() => {
      const analyser = micAnalyserRef.current;
      if (!analyser || !meterBuffer) return;
      const now = Date.now();
      const state = micVoiceSustained({ level: levelFrom(analyser, meterBuffer), since, now });
      since = state.since;
      micLoudRef.current = state.sustained;
      if (state.sustained) micLoudAtRef.current = now;
      if (!vad.running) return;
      const duck = duckRef.current;
      const voiceActive = vad.speaking && now - micLoudAtRef.current < 400;
      if (voiceActive) {
        duck.lastVoiceAt = now;
        if (!duck.ducked) setDuck(true);
      } else if (shouldRestoreVolume({ ducked: duck.ducked, voiceActive, lastVoiceAt: duck.lastVoiceAt, waitingSince: duck.waitingSince, now })) {
        setDuck(false);
      }
    }, 50);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      vad.speaking = false;
      if (vad.running) {
        vad.running = false;
        vad.instance?.pause().catch(() => {});
      }
      if (ownsMic) stopMicMeter();
    };
  }, [bargeActive, ensureVad, setDuck, startMicMeter, stopMicMeter]);
  const confirmBargeRef = useRef(null);
  confirmBargeRef.current = confirmBargeByTranscript;
  useEffect(() => () => {
    vadRef.current.instance?.destroy().catch(() => {});
    vadRef.current = { instance: null, loading: false, failed: false, running: false, speaking: false, lastAt: 0 };
  }, []);

  // --- Escuta contínua --------------------------------------------------------------------------------------------
  // Handlers por ref: o reconhecimento NÃO é recriado quando a identidade de uma função muda (recriar aborta a sessão e
  // perde palavras — o "Henry" do começo da frase). Só liga/desliga com active/supported/muted/recordMode/listenMode.
  const handleFinalRef = useRef(handleFinal);
  handleFinalRef.current = handleFinal;
  const recognitionHandlersRef = useRef({});
  recognitionHandlersRef.current = { markActivity, startMicMeter, stopMicMeter, currentSpeech, interrupt, warmServer, markCalling, voiceConfirmed };
  useEffect(() => {
    const { startMicMeter, stopMicMeter } = recognitionHandlersRef.current;
    const Recognition = getRecognitionClass();
    shouldListenRef.current = Boolean(active && supported && !muted && Recognition && !recordMode);
    if (!shouldListenRef.current) {
      recognitionRef.current?.abort?.();
      recognitionRef.current = null;
      stopMicMeter();
      setMicState("idle");
      return undefined;
    }
    // Sempre ativo: liga sozinha (o navegador pede o microfone uma vez). Caiu (fim de sessão, erro de rede) → religa com
    // espera crescente (nextRestartDelay), sem loop agressivo; aba voltou a ficar visível → religa na hora.
    let stopped = false;
    let failures = 0;
    let startedAt = 0;
    let restartTimer = null;
    // Rede de segurança: parcial sem resultado novo por ~1,2 s vira frase final (o isFinal às vezes nunca chega).
    let interim = emptyInterimState();
    let interimTimer = null;
    const deliverFinal = (text, named = false) => {
      const accepted = handleFinalRef.current(text, { armed: named });
      setHeard({ text: text.trim().slice(0, 80), at: Date.now(), accepted });
    };
    const recognition = new Recognition();
    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;
    // Celular (tocar para falar): só roda com a cena aberta ou em conversa; computador ou "ouvir com o app aberto": sempre.
    // Celular: enquanto o Henry fala, o microfone fica DESLIGADO — com o microfone aberto o iOS/Android manda a voz para o
    // alto-falante de ligação (baixinho ou mudo). Dono, 2026-10-22: "mostra que ele está falando e não sai áudio".
    const wantsRun = () => shouldRunRecognition({ mode: listenModeRef.current, sessionOpen: sessionOpenRef.current }) && !(bargeModeRef.current === "tap" && phaseRef.current === "speaking");
    const startSafe = () => {
      if (stopped || !shouldListenRef.current || !wantsRun()) return;
      try {
        recognition.start();
      } catch {
        // já está rodando
      }
    };
    startListeningRef.current = startSafe; // o toque no ícone chama isto DENTRO do gesto (o iOS exige)
    stopListeningRef.current = () => {
      window.clearTimeout(restartTimer);
      try {
        recognition.stop();
      } catch {
        // já parado
      }
    };
    recognition.onstart = () => {
      startedAt = Date.now();
      interim = { ...interim, consumed: emptyInterimState().consumed }; // sessão nova: os índices recomeçam do zero
      setMicState("listening");
    };
    recognition.onresult = (event) => {
      failures = 0;
      window.clearTimeout(interimTimer);
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript || "";
        lastHeardRef.current = Date.now(); // alguém falando perto: o anel passa a "ouvindo" (nada é enviado)
        const handlers = recognitionHandlersRef.current;
        handlers.markActivity();
        if (result.isFinal) {
          // Final atrasado de um trecho que a rede de segurança já usou → só o que sobrar (normalmente nada).
          const taken = takeFinalResult(interim, { index, text });
          interim = taken.state;
          if (taken.text) deliverFinal(taken.text, taken.named);
          continue;
        }
        interim = trackInterim(interim, { index, text, now: Date.now() });
        const withMusic = isMusicGuardActive(musicGuardRef.current); // música tocando: nome só no começo, sem fala comum
        const heardName = detectWakeWord(text);
        if (heardName.called && !(withMusic && heardName.anywhere)) {
          handlers.warmServer(); // ouviu "Henry": já aquece o relatório enquanto ele fala
          handlers.markCalling(); // e o ícone já cresce
        }
        if (phaseRef.current === "speaking" || phaseRef.current === "thinking") {
          const named = withMusic ? detectMusicBargeIn(text) : detectBargeIn(text, handlers.currentSpeech());
          if (named.interrupt && (!named.echoRisk || handlers.voiceConfirmed())) {
            handlers.interrupt(); // resultado parcial: corta na hora; a frase final decide se já tem pergunta
          } else if (!withMusic && !named.interrupt && phaseRef.current === "speaking" && bargeModeRef.current !== "tap" && detectSpeechBargeIn(text, handlers.currentSpeech()).interrupt && handlers.voiceConfirmed()) {
            handlers.interrupt(); // ele começou a falar por cima (fala que não é eco da frase atual, voz confirmada no microfone)
          }
        }
      }
      if (interim.text) {
        // Mesmo "Tempo de espera do fim da fala" da gravação (curto com pergunta aberta dele) — dono, 2026-10-23.
        const waitMs = interimFinalWaitMs({ waitMs: endWaitMsRef.current, awaitingReply: isAwaitingReply(pendingReplyRef.current) });
        interimTimer = window.setTimeout(() => {
          const forced = forceInterimFinal(interim, Date.now(), waitMs);
          interim = forced.state;
          if (forced.text) deliverFinal(forced.text, forced.named);
        }, waitMs);
      }
    };
    recognition.onerror = (event) => {
      // Celular: reconhecimento recusado/indisponível (app instalado no iPhone) → passa para a gravação.
      if (!desktopRef.current && ["service-not-allowed", "not-allowed", "audio-capture", "network", "language-not-supported"].includes(event.error)) {
        stopped = true;
        setRecognitionFailed(true);
        return;
      }
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        stopped = true;
        setMicState("blocked");
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        failures += 1;
        if (!desktopRef.current && failures >= 3) {
          stopped = true;
          setRecognitionFailed(true);
        }
      }
    };
    recognition.onend = () => {
      if (stopped || !shouldListenRef.current) return;
      if (!wantsRun()) {
        setMicState("idle");
        return;
      }
      if (startedAt && Date.now() - startedAt < 2000) failures += 1; // caiu logo depois de ligar
      window.clearTimeout(restartTimer);
      restartTimer = window.setTimeout(startSafe, nextRestartDelay(failures));
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      failures = 0;
      window.clearTimeout(restartTimer);
      startSafe();
    };
    document.addEventListener("visibilitychange", onVisible);
    recognitionRef.current = recognition;
    startSafe();
    // Medidor do microfone só no computador (no celular, abrir o microfone duas vezes atrapalha o reconhecimento).
    if (desktopRef.current) startMicMeter();
    return () => {
      stopped = true;
      window.clearTimeout(restartTimer);
      window.clearTimeout(interimTimer);
      document.removeEventListener("visibilitychange", onVisible);
      recognition.onend = null;
      recognition.abort();
    };
  }, [active, supported, muted, recordMode, listenMode]);

  // Celular, meia via: fala do Henry → microfone e medidor desligados (o som vai para o alto-falante); acabou de falar e a
  // conversa segue → volta a ouvir. Para interromper no celular: tocar na tela (onInterrupt).
  useEffect(() => {
    if (bargeMode !== "tap") return;
    if (phase === "speaking") {
      stopListeningRef.current?.();
      stopMicMeter();
    } else if (phase === "armed" && sessionOpenRef.current) {
      setAudioSession("play-and-record");
      startListeningRef.current?.();
    } else if (phase === "idle") {
      setAudioSession("auto");
    }
  }, [phase, bargeMode, stopMicMeter, setAudioSession]);

  // Celular: abrir a cena ou estar em conversa mantém a escuta; fechou e a conversa acabou → para de ouvir (bateria).
  useEffect(() => {
    sessionOpenRef.current = expanded || inConversation;
    if (listenMode !== "tap") return;
    if (sessionOpenRef.current) startListeningRef.current?.();
    else stopListeningRef.current?.();
  }, [expanded, inConversation, listenMode]);

  // Cena aberta: sem rolagem da página por trás e o botão/gesto "voltar" minimiza (entrada própria no histórico, com o
  // estado do Next preservado para o App Router não recarregar).
  useEffect(() => {
    if (!expanded) return undefined;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    if (!window.history.state?.henryOpen) window.history.pushState({ ...(window.history.state || {}), henryOpen: true }, "");
    const onPop = () => {
      if (!window.history.state?.henryOpen) setExpanded(false);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      root.style.overflow = previous;
      document.body.style.overflow = "";
      if (window.history.state?.henryOpen) window.history.back();
    };
  }, [expanded]);

  // Toque no ícone. Computador: abre a cena. Celular: abre a cena JÁ OUVINDO — destrava o áudio e liga o reconhecimento
  // dentro do próprio toque (exigência do iOS), entra em conversa com o som de início.
  const openScene = useCallback(() => {
    setExpanded(true);
    warmServer();
    if (listenModeRef.current !== "tap") return;
    if (recordModeRef.current) {
      // Gravação: o toque que abre a tela já começa a gravar (anel "ouvindo"); tocar de novo envia.
      fetch("/api/admin/henry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "claim", deviceId: deviceIdRef.current }) }).catch(() => {});
      startRecording();
      return;
    }
    unlockAudio();
    sessionOpenRef.current = true;
    startListeningRef.current?.();
    // Reserva a conversa para este aparelho (o computador, que também ouve, fica calado).
    fetch("/api/admin/henry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "claim", deviceId: deviceIdRef.current }) }).catch(() => {});
    startConversation({ sound: true });
    listenAgain();
  }, [listenAgain, startConversation, startRecording, unlockAudio, warmServer]);

  // Botão ▶ "Começar o bom dia" (HENRY-1, dono 2026-10-23: plano B "caso a automação não funcione"). Visível até 11:00 de
  // São Paulo e some/volta sozinho (timer até a próxima troca, sem recarregar). O clique — gesto do usuário — destrava o
  // som (também no iPhone), abre a tela cheia, toca a cena de abertura e, ao terminar (ou pular), faz o MESMO pedido do
  // "bom dia, Henry" falado (morningPlayRequest → ask). Pode repetir no mesmo dia: nada aqui guarda "bom dia feito".
  const [morningPlay, setMorningPlay] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    let timer = 0;
    const sync = () => {
      const { visible, msUntilChange } = morningPlayWindow(new Date());
      setMorningPlay(visible);
      timer = window.setTimeout(sync, Math.min(msUntilChange + 500, 60 * 60 * 1000));
    };
    sync();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      sync(); // aba/PC voltando da suspensão: timers atrasam, recalcula na hora
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);

  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const startMorningPlay = useCallback(() => {
    unlockAudio();
    if (!mutedRef.current) playHenryOpeningSound(audioCtxRef.current);
    abortRequest();
    stopSpeaking();
    setExpanded(true);
    warmServer();
    fetch("/api/admin/henry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "claim", deviceId: deviceIdRef.current }) }).catch(() => {});
    // Celular que ouve pelo navegador: liga a escuta dentro do toque (exigência do iOS) para responder à pergunta da música.
    if (listenModeRef.current === "tap" && !recordModeRef.current) {
      sessionOpenRef.current = true;
      startListeningRef.current?.();
    }
    openingRef.current = true;
    setOpening(true);
  }, [abortRequest, stopSpeaking, unlockAudio, warmServer]);
  const finishOpening = useCallback(() => {
    if (!openingRef.current) return;
    openingRef.current = false;
    setOpening(false);
    askRef.current?.(morningPlayRequest());
  }, []);
  // Minimizou ("voltar"/arrastar) no meio da cena: pula para o bom dia em vez de deixar a cena pendurada.
  useEffect(() => {
    if (!expanded && openingRef.current) finishOpening();
  }, [expanded, finishOpening]);

  // App de desktop: atalho global Ctrl+Shift+H (o app traz a janela) ou o nome ouvido pelo app → abre o Henry já ouvindo.
  const activateFromDesktop = useCallback(() => {
    if (recordRef.current) return; // já gravando: o toque no Henry envia
    // Música tocando: o nome ouvido pelo app/atalho vale como chamado só para a PRÓXIMA frase (sem cara de letra) e a
    // música abaixa enquanto ele escuta (mesma regra do nome no começo da frase).
    if (isMusicGuardActive(musicGuardRef.current)) {
      musicGuardRef.current = { ...musicGuardRef.current, explicitUntil: Date.now() + 10000 };
      duckSpotifyVolume();
    }
    openScene();
    if (!recordModeRef.current) {
      startConversation({ sound: true });
      listenAgain();
    }
  }, [duckSpotifyVolume, listenAgain, openScene, startConversation]);

  useEffect(() => {
    const bridge = desktopBridgeRef.current;
    if (!active || !bridge || typeof bridge.onActivate !== "function") return undefined;
    const unsubscribe = bridge.onActivate(activateFromDesktop);
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [active, activateFromDesktop]);

  // Fase 1.1: "Henry" ouvido pelo app (Vosk, offline, áudio nunca sai do PC). Assinar liga a escuta no app; cancelar
  // (liga/desliga "Ouvir 'Henry' sem atalho" em Voz e personalidade, Henry desligado, página fechada) desliga o microfone dele.
  const [desktopWake, setDesktopWake] = useState(true);
  // 1.3.0: palavra de chamada (Voz e personalidade, deste PC) vai ao app pelo mesmo onWake; trocar = assinar de novo.
  const [desktopWakeWord, setDesktopWakeWord] = useState("henry");
  useEffect(() => {
    const read = () => {
      setDesktopWake(readDesktopWakeSetting(window.localStorage));
      setDesktopWakeWord(readDesktopWakeWord(window.localStorage));
    };
    read();
    window.addEventListener(DESKTOP_WAKE_EVENT, read);
    return () => window.removeEventListener(DESKTOP_WAKE_EVENT, read);
  }, []);
  useEffect(() => {
    const bridge = desktopBridgeRef.current;
    if (!active || !desktopWake || !desktopCanWake(bridge)) return undefined;
    const unsubscribe = bridge.onWake(
      () => {
        if (!shouldHandleDesktopWake({ phase: phaseRef.current, recording: Boolean(recordRef.current), muted: mutedRef.current })) return;
        activateFromDesktop();
      },
      {
        wakeWord: desktopWakeWord,
        // App 1.3.0+: qual palavra ele está usando de verdade (fora do vocabulário do modelo → volta para "Henry").
        onStatus: (status) => window.dispatchEvent(new CustomEvent(DESKTOP_WAKE_STATUS_EVENT, { detail: status }))
      }
    );
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [active, desktopWake, desktopWakeWord, activateFromDesktop]);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      mutedRef.current = next;
      if (next) {
        stopSpeaking();
        endConversation({ sound: false });
      }
      return next;
    });
  }, [endConversation, stopSpeaking]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === "b" || event.key === "B" || event.code === "KeyB")) {
        event.preventDefault();
        toggleMute();
      } else if (event.key === "Escape" && expanded && !openingRef.current) {
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, expanded, toggleMute]);

  if (!active) return null;

  const status = capturing
    ? "Olhando pela câmera…"
    : recordMode
      ? recording
        ? recordHeard ? "Ouvindo… pode continuar (toque para enviar)" : "Ouvindo… pode falar"
        : phase === "thinking"
          ? scene.label || "Pensando…"
          : phase === "speaking"
            ? "Falando… toque na tela para interromper"
            : desktopApp ? "Toque no Henry ou Ctrl+Shift+H para falar" : "Toque no Henry para falar"
    : !supported
    ? "Este navegador não reconhece voz — use o Chrome ou digite"
    : micState === "blocked"
      ? "Microfone bloqueado — libere no cadeado da barra de endereço"
      : muted
        ? "Mudo (Alt+B para ligar)"
        : phase === "thinking"
          ? scene.label || "Pensando…"
          : phase === "speaking"
            ? desktop ? "Falando… diga “Henry” para interromper" : "Falando… toque na tela para interromper"
            : phase === "armed"
              ? inConversation
                ? "Em conversa — pode falar sem dizer o nome (“obrigado, Henry” encerra)"
                : listenPrompt
              : micState === "listening"
                ? heard.text && Date.now() - heard.at < 8000 ? heard.accepted ? `Ouvi: “${heard.text}”` : `Ouvi: “${heard.text}” (diga “Henry” antes)` : expanded ? "Ouvindo — pode falar" : "Ouvindo — diga “Henry”"
                : listenMode === "tap"
                  ? "Toque no Henry para falar"
                  : "Ligando o microfone…";
  const submitTyped = (event) => {
    event.preventDefault();
    const text = typed.trim();
    if (!text) return;
    setTyped("");
    const detected = detectWakeWord(text);
    if (detected.called && detected.kind === "report") ask({ mode: "report", question: "", shown: text });
    else ask({ mode: "question", question: detected.called && detected.question ? detected.question : text, shown: text });
  };

  return (
    <>
    <HenryVoiceView
      expanded={expanded}
      onExpand={openScene}
      onMinimize={() => setExpanded(false)}
      speaking={phase === "speaking"}
      onInterrupt={() => {
        if (!soundRetryRef.current) interrupt();
      }}
      mobile={!desktop}
      tapToTalk={listenMode === "tap"}
      status={status}
      engaged={inConversation || phase !== "idle" || recording || calling}
      heardHint={!heard.accepted && heard.text && Date.now() - heard.at < 8000 ? `Ouvi: “${heard.text}” (diga “Henry” antes)` : ""}
      inConversation={inConversation}
      caption={recording ? status : captionFor(phase, turns)} /* gravando: "Ouvindo…" também no ícone minimizado */
      turns={turns}
      notice={notice}
      micOff={recordMode ? !recording : muted || !supported || micState === "blocked"}
      onToggleMute={recordMode ? talk : toggleMute}
      recordMode={recordMode}
      recording={recording}
      onTalk={recordMode ? talk : undefined}
      getSignal={getSignal}
      sleeping={sleeping}
      showKeyboard={showKeyboard || (!supported && !recordMode)}
      onToggleKeyboard={() => setShowKeyboard((current) => !current)}
      typed={typed}
      onTyped={setTyped}
      onSubmitTyped={submitTyped}
      busy={phase === "thinking"}
      vision={vision}
      capturing={capturing}
      onToggleVision={toggleVision}
      searching={phase === "thinking" && !capturing}
      dataScene={phase === "thinking" && !capturing && scene.live}
      sceneTopic={scene.topic}
      brokers={phase === "thinking" || phase === "speaking" ? scene.brokers : []}
      music={music}
      nowPlaying={nowPlaying}
      pendingAlerts={pendingAlerts}
      onPendingAlerts={hearPendingAlerts}
      morningPlay={morningPlay}
      onMorningPlay={startMorningPlay}
      opening={opening}
      onOpeningDone={finishOpening}
      pulse={pulseConfig}
      onPulseOpen={(link) => {
        // Card do Pulso: mesma navegação guiada das respostas (minimiza + cursor); só destino da lista fechada.
        const navigate = { key: "pulso", path: link?.path || "", label: "Pulso do CRM", ...(link?.clientId ? { clientId: link.clientId } : {}) };
        if (!shouldMinimizeForNavigation(navigate)) return;
        setExpanded(false);
        setNavRequest({ ...navigate, id: Date.now() });
      }}
    />
    <HenryCursor request={navRequest} mobile={!desktop} />
    </>
  );
}
