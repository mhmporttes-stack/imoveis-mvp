"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { detectWakeWord, isVisualQuestion } from "@/lib/henry-voice-core.mjs";
import { shouldMinimizeForNavigation } from "@/lib/henry-navigation-core.mjs";
import {
  INTERIM_FINAL_MS,
  RECORD_MIN_MS,
  RECORD_VOICE_LEVEL,
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
  micVoiceSustained,
  henryCaption as captionFor,
  isConversationEnd,
  isConversationExpired,
  isEchoOf,
  isStopCommand,
  nextRestartDelay
} from "@/lib/henry-voice-conversation.mjs";
import { pickBestBrowserVoice, pronounceForSpeech, splitSentences } from "@/lib/henry-voice-providers.mjs";
import { normalizeHenryScene, pickWaitPhrase, rememberPhrase, shouldNarrate } from "@/lib/henry-voice-narration.mjs";
import { HENRY_LISTEN_PROMPTS, pickVariant, rememberVariant } from "@/lib/henry-voice-persona.mjs";
import HenryVoiceView from "./HenryVoiceView";
import HenryCursor from "./HenryCursor";
import { captureWebcamFrame } from "./webcam-capture";

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
// gravação — toque no anel/microfone grava (MediaRecorder), para no toque ou sozinho com ~1,2 s de silêncio (máx. 20 s),
// o servidor transcreve (ElevenLabs Scribe) e o texto segue o caminho normal. O áudio não fica guardado em lugar nenhum.
// Sem silêncio enquanto pensa (dono, 2026-10-22): frases de espera curtas NA VOZ DO HENRY (cache da sessão, mesma fila e
// mesmo elemento de áudio da resposta), depois de ~0,8 s, no máximo 1 a cada ~2,5 s, sem repetir as últimas 5; a resposta
// entra quando a frase atual termina. Sem voz do servidor: silêncio (nunca a voz do navegador). A cena mostra a busca.

const MUTE_KEY = "mm_henry_muted";
const IDLE_SLEEP_MS = 30000;
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
  const micStreamRef = useRef(null);
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
  const [hasRecorder, setHasRecorder] = useState(false);
  const [recognitionFailed, setRecognitionFailed] = useState(false);
  const [iosStandalone, setIosStandalone] = useState(false);
  const speechQueueRef = useRef({ clips: [], playing: false, done: true });
  const mutedRef = useRef(false);
  // Narração e cena de busca: frases da sessão (voz do Henry), espera do pedido atual e o que a cena mostra.
  const narrationKeyRef = useRef("");
  const narrationRef = useRef({ key: "", phrases: [], loading: false });
  const waitRef = useRef({ id: 0, startedAt: 0, replied: true, topic: "geral", lastAt: 0, names: [] });
  const recentPhrasesRef = useRef([]);
  const narratingTextRef = useRef("");
  // live = já houve ferramenta (ou é o "bom dia"): só então a cena de busca entra; antes disso, as ondas da conversa.
  const [scene, setScene] = useState({ topic: "geral", label: "", brokers: [], live: false });
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

  const updatePhase = useCallback((value) => {
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
    setMuted(window.localStorage.getItem(MUTE_KEY) === "1");
    fetch("/api/admin/henry", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { enabled: false }))
      .then((data) => {
        if (!alive) return;
        setEnabled(Boolean(data?.enabled));
        visionRef.current = data?.vision === true;
        setVision(data?.vision === true);
        if (Number.isFinite(data?.browserRate)) browserRateRef.current = data.browserRate;
        narrationKeyRef.current = typeof data?.narrationKey === "string" ? data.narrationKey : "";
        // Memória do dia (REGRA OFICIAL, dono 2026-10-22): a conversa de hoje volta ao abrir/recarregar (só texto).
        if (Array.isArray(data?.dayTurns) && data.dayTurns.length && !turnsRef.current.length) {
          const restored = data.dayTurns.filter((turn) => turn && typeof turn.text === "string").map((turn) => ({ role: turn.role === "assistant" ? "assistant" : "user", text: turn.text }));
          turnsRef.current = restored;
          setTurns(restored);
        }
        setMobileWake(data?.mobileWake === true);
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
  const captureMode = henryCaptureMode({ desktop, hasRecognition: supported, hasRecorder, recognitionFailed, iosStandalone });
  const recordMode = captureMode === "record";
  recordModeRef.current = recordMode;
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
  const loadNarration = useCallback(() => {
    const key = narrationKeyRef.current;
    const state = narrationRef.current;
    if (!key || state.loading || state.key === key) return;
    const storageKey = `mm-henry-narration:${key}`;
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(storageKey) || "null");
      if (Array.isArray(saved?.phrases) && saved.phrases.length) {
        narrationRef.current = { key, phrases: saved.phrases, loading: false };
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
        }
      })
      .catch(() => {
        narrationRef.current = { key: "", phrases: [], loading: false };
      });
  }, []);
  useEffect(() => {
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

  // Sinal do anel (HenryOrb): estado + nível REAL do áudio. "Ouvindo" = alguém falando perto (resultado parcial do
  // reconhecedor há menos de 1,5 s) ou o Henry esperando a pergunta; fora disso o anel só respira.
  const getSignal = useCallback(() => {
    const current = phaseRef.current;
    if (current === "speaking") {
      return { mode: "speaking", level: outAnalyserRef.current && meterActiveRef.current ? levelFrom(outAnalyserRef.current, meterBuffer) : 0.45 + Math.sin(Date.now() / 140) * 0.3 };
    }
    if (recordRef.current) return { mode: "listening", level: micAnalyserRef.current ? levelFrom(micAnalyserRef.current, meterBuffer) : 0.3 };
    if (current === "thinking") return { mode: "thinking", level: 0.1 };
    const hearing = current === "armed" || Date.now() - lastHeardRef.current < 1500;
    if (hearing && shouldListenRef.current) {
      return { mode: "listening", level: micAnalyserRef.current ? levelFrom(micAnalyserRef.current, meterBuffer) : 0.3 };
    }
    return { mode: "idle", level: 0 };
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      micStreamRef.current = stream;
      const context = ensureAudioContext();
      if (!context) return;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      micAnalyserRef.current = analyser;
    } catch {
      // Sem permissão: o reconhecimento também vai falhar e mostrar "microfone bloqueado".
    }
  }, [ensureAudioContext]);

  const stopMicMeter = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    micAnalyserRef.current = null;
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
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      if (!audio.paused) audio.pause();
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

  // Elemento de áudio único. No computador passa pelo medidor (WebAudio) para o anel seguir a voz — ligado UMA vez e só
  // com o contexto rodando (ligado a um contexto suspenso tocaria mudo). No celular não passa (o iOS suspende o contexto
  // e calaria a voz); o anel usa o pulso simulado.
  const getAudioElement = useCallback(() => {
    if (!audioRef.current) {
      const element = new Audio();
      element.setAttribute("playsinline", "");
      element.preload = "auto";
      audioRef.current = element;
    }
    const element = audioRef.current;
    const context = audioCtxRef.current;
    if (!element.dataset.metered && desktopRef.current && context && context.state === "running") {
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaElementSource(element).connect(analyser);
      analyser.connect(context.destination);
      outAnalyserRef.current = analyser;
      element.dataset.metered = "1";
    }
    return element;
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
    const clip = queue.clips.shift();
    if (!clip) {
      queue.playing = false;
      if (queue.done && phaseRef.current === "speaking") listenAgain();
      return;
    }
    queue.playing = true;
    queue.narrating = Boolean(clip.narration);
    narratingTextRef.current = clip.narration ? clip.text : "";
    const advance = () => {
      if (speechQueueRef.current === queue) playNextRef.current();
    };
    if (clip.narration && !clip.audio?.base64) {
      advance(); // frase de espera só na voz do Henry; sem áudio, nada
      return;
    }
    if (!clip.audio?.base64) {
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
    meterActiveRef.current = Boolean(element.dataset.metered);
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
      const link = document.createElement("a");
      link.href = uri;
      link.rel = "noopener";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      // protocolo recusado: o servidor ainda espera um aparelho e, sem ele, pede o play
    }
    let data = null;
    try {
      const response = await fetch("/api/admin/henry/spotify/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(volume === null ? { uri } : { uri, volume })
      });
      data = await response.json().catch(() => null);
      if (!response.ok) data = { ok: false, reply: data?.error || "Não consegui tocar no Spotify. Dá play uma vez nele." };
    } catch {
      data = { ok: false, reply: "Não consegui tocar no Spotify. Dá play uma vez nele." };
    }
    if (data?.ok || !data?.reply || requestIdRef.current !== requestId) return;
    const withReply = [...turnsRef.current, { role: "assistant", text: data.reply }];
    turnsRef.current = withReply;
    setTurns(withReply);
    beginSpeech(data.reply);
    enqueueClip({ audio: data.audio || null, text: data.reply });
    endSpeech();
  }, [beginSpeech, endSpeech, enqueueClip]);

  // Despedida na voz do Henry ("obrigado, Henry"): do mesmo cache das frases de espera, sem repetir as últimas 5. Sem voz
  // do servidor: só o som de fim (nunca a voz do navegador).
  const sayGoodbye = useCallback(() => {
    const byes = narrationRef.current.phrases.filter((phrase) => phrase.topics?.includes("bye"));
    if (!byes.length || mutedRef.current) return;
    const choice = pickWaitPhrase({ topic: "bye", recentIds: recentPhrasesRef.current, phrases: byes });
    if (!choice?.audio?.base64) return;
    recentPhrasesRef.current = rememberPhrase(recentPhrasesRef.current, choice.id);
    speechQueueRef.current = { clips: [{ audio: choice.audio, text: choice.text, narration: true }], playing: false, done: true };
    playNextRef.current();
  }, []);

  // --- Cena de busca e narração ------------------------------------------------------------------------------------
  // Evento de progresso do servidor → assunto da cena, legenda e cards de corretor (até 3; o achado ganha os números).
  const applyProgress = useCallback((message) => {
    const topic = typeof message.topic === "string" ? message.topic : "geral";
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
      return { topic, label: String(message.label || "").slice(0, 80), brokers, live: current.live || message.progress !== "inicio" };
    });
  }, []);

  // Enquanto pensa: frase de espera na voz do Henry quando a regra deixa (shouldNarrate); primeiro a frase com o nome do
  // corretor, se veio; depois as do assunto, sem repetir as últimas 5.
  useEffect(() => {
    if (phase !== "thinking") return undefined;
    const timer = window.setInterval(() => {
      const wait = waitRef.current;
      const queue = speechQueueRef.current;
      const { phrases } = narrationRef.current;
      const name = wait.names.find((item) => !recentPhrasesRef.current.includes(item.id));
      const waits = phrases.filter((phrase) => !phrase.topics?.includes("bye")); // despedidas só no fim da conversa
      const hasAudio = Boolean(name) || waits.length > 0;
      if (!shouldNarrate({ now: Date.now(), startedAt: wait.startedAt, lastNarrationAt: wait.lastAt, playing: queue.playing, replied: wait.replied || wait.id !== requestIdRef.current, hasAudio })) return;
      const choice = name || pickWaitPhrase({ topic: wait.topic, recentIds: recentPhrasesRef.current, phrases: waits });
      if (!choice?.audio?.base64) return;
      waitRef.current = { ...wait, lastAt: Date.now(), names: name ? wait.names.filter((item) => item !== name) : wait.names };
      recentPhrasesRef.current = rememberPhrase(recentPhrasesRef.current, choice.id);
      queue.clips.push({ audio: choice.audio, text: choice.text, narration: true });
      if (!queue.playing) playNextRef.current();
    }, 200);
    return () => window.clearInterval(timer);
  }, [phase]);

  // --- Pergunta ao servidor ---------------------------------------------------------------------------------------
  // Interrompe o que estiver em andamento (pedido e voz) e faz a nova pergunta. Memória: só as trocas do modo conversa
  // atual (no máximo ~6), só desta página — nada vai para o banco.
  const ask = useCallback(async ({ mode, question, shown }) => {
    const pendingMorning = morningRef.current;
    morningRef.current = null;
    const conversationNow = conversationRef.current;
    const morning = mode === "question" && pendingMorning && conversationNow.active && !isConversationExpired(conversationNow.lastAt) ? { step: pendingMorning.step } : null;
    // Resposta da música/estilo segue como "bom dia" (relatório, com a visão como no bom dia); aniversário = pergunta.
    if (morning && morning.step !== "birthday") mode = "report";
    abortRequest();
    stopSpeaking();
    setNotice("");
    const id = requestIdRef.current + 1;
    requestIdRef.current = id;
    const controller = new AbortController();
    abortRef.current = controller;
    const history = conversationHistory(turnsRef.current, conversationRef.current.historyStart);
    const nextTurns = [...turnsRef.current, { role: "user", text: shown || question }];
    turnsRef.current = nextTurns;
    setTurns(nextTurns);
    updatePhase("thinking");
    startConversation(); // depois de qualquer resposta, ~40 s em que frases sem o nome valem (também no computador)
    waitRef.current = { id, startedAt: Date.now(), replied: false, topic: mode === "report" ? "relatorio" : "geral", lastAt: 0, names: [] };
    setScene({ topic: mode === "report" ? "relatorio" : "geral", label: "", brokers: [], live: mode === "report" });
    touchConversation();
    // "Esquece a conversa de hoje": a tela também começa do zero.
    const clearTurns = () => {
      turnsRef.current = [];
      conversationRef.current = { ...conversationRef.current, historyStart: 0 };
      setTurns([]);
    };
    const onReply = (reply, navigate, detail = null, rawScene = null, openUrl = null, spotify = null, nextMorning = null) => {
      if (requestIdRef.current === id) morningRef.current = nextMorning?.step ? { step: nextMorning.step } : null;
      if (waitRef.current.id === id) waitRef.current = { ...waitRef.current, replied: true };
      // Cena da resposta (HenryAnswerScenes), escolhida no servidor pelas ferramentas chamadas.
      const answerScene = normalizeHenryScene(rawScene);
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
          window.open(openUrl, "_blank", "noopener,noreferrer");
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
      if (requestIdRef.current !== id) return;
      const response = await fetch("/api/admin/henry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, question, history, ...(image ? { image } : {}), ...(morning ? { morning } : {}), stream: true, deviceId: deviceIdRef.current }),
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
        onReply(data.reply || "", data.navigate, data.detail || null, data.scene || null, data.openUrl || null, data.spotify || null, data.morning || null);
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
            if (message.memoryCleared) clearTurns();
            onReply(message.reply, message.navigate, message.detail || null, message.scene || null, message.openUrl || null, message.spotify || null, message.morning || null);
          }
          else if (typeof message?.text === "string") enqueueClip({ audio: message.audio, text: message.text });
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
  }, [abortRequest, applyProgress, beginSpeech, endConversation, endSpeech, enqueueClip, listenAgain, openSpotifyAndPlay, router, startConversation, stopSpeaking, touchConversation, updatePhase]);

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
  // Fecha a gravação: microfone desligado na hora (o som volta ao alto-falante) e, se houve voz, manda o áudio para
  // transcrever. O áudio só existe na memória desta função e no corpo do pedido.
  const finishRecording = useCallback(async (session) => {
    if (session.finished) return;
    session.finished = true;
    window.clearInterval(session.timer);
    session.stream?.getTracks().forEach((track) => track.stop());
    try {
      session.source?.disconnect();
    } catch {
      // já desligado
    }
    if (recordRef.current === session) recordRef.current = null;
    if (micAnalyserRef.current === session.analyser) micAnalyserRef.current = null;
    setRecording(false);
    const durationMs = Date.now() - session.startedAt;
    // Só o tipo base (o iPhone manda 'audio/mp4; codecs="mp4a.40.2"' ou nada): o servidor confere o formato de novo.
    const rawType = session.recorder?.mimeType || session.chunks[0]?.type || "";
    const type = String(rawType).split(";")[0].trim().toLowerCase() || "audio/mp4";
    const blob = session.chunks.length ? new Blob(session.chunks, { type }) : null;
    session.chunks = [];
    if (session.discard || !blob || !blob.size || durationMs < RECORD_MIN_MS) {
      updatePhase("idle");
      if (session.discard === "silence") setNotice("Não ouvi nada. Toque no Henry e fale.");
      return;
    }
    const id = requestIdRef.current + 1;
    requestIdRef.current = id;
    const controller = new AbortController();
    abortRef.current = controller;
    updatePhase("thinking");
    try {
      const audio = await blobToDataUrl(blob);
      const response = await fetch("/api/admin/henry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "transcribe", audio, durationMs, deviceId: deviceIdRef.current }),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (requestIdRef.current !== id) return;
      if (!response.ok) throw new Error(data?.error || "Não consegui entender o áudio agora. Tente de novo.");
      const text = String(data?.text || "").trim();
      const intent = classifyTapUtterance(text);
      if (intent.kind === "report") askRef.current?.({ mode: "report", question: "", shown: text });
      else if (intent.kind === "question") askRef.current?.({ mode: "question", question: intent.question, shown: text });
      else {
        updatePhase("idle");
        setNotice(intent.kind === "wake" ? "Pode perguntar: toque no Henry e fale." : "Não entendi. Toque no Henry e fale de novo.");
      }
    } catch (error) {
      if (error?.name === "AbortError" || requestIdRef.current !== id) return;
      updatePhase("idle");
      setNotice(error?.message || "Não consegui entender o áudio agora. Tente de novo.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [updatePhase]);

  const stopRecording = useCallback((discard = false) => {
    const session = recordRef.current;
    if (!session) return;
    session.discard = discard;
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
  const startRecording = useCallback(async () => {
    if (recordRef.current) return;
    unlockAudio();
    stopSpeaking();
    abortRequest();
    setNotice("");
    setAudioSession("play-and-record");
    const session = { chunks: [], startedAt: Date.now(), lastVoiceAt: 0, heardVoice: false, finished: false, discard: false };
    recordRef.current = session;
    setRecording(true);
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
      session.timer = window.setInterval(() => {
        const now = Date.now();
        // Contexto suspenso (iOS) não mede: sem medidor, só o toque ou o limite de 20 s param.
        const hasMeter = Boolean(session.analyser) && audioCtxRef.current?.state === "running";
        if (hasMeter && levelFrom(session.analyser, meterBuffer) >= RECORD_VOICE_LEVEL) {
          session.heardVoice = true;
          session.lastVoiceAt = now;
          lastHeardRef.current = now;
          markActivity();
        }
        const decision = recordingDecision({ startedAt: session.startedAt, lastVoiceAt: session.lastVoiceAt, heardVoice: session.heardVoice, hasMeter, now });
        if (decision) stopRecording(decision === "discard" ? "silence" : false);
      }, 100);
    } catch {
      if (recordRef.current === session) recordRef.current = null;
      session.stream?.getTracks().forEach((track) => track.stop());
      setRecording(false);
      updatePhase("idle");
      setNotice("Não consegui abrir o microfone. Libere o microfone para o app (Ajustes do iPhone > Safari > Microfone).");
    }
  }, [abortRequest, ensureAudioContext, finishRecording, markActivity, setAudioSession, startConversation, stopRecording, stopSpeaking, unlockAudio, updatePhase]);

  // Toque no anel ou no microfone (modo gravação): começa a gravar; tocando de novo, envia.
  const talk = useCallback(() => {
    if (recordRef.current) stopRecording(false);
    else startRecording();
  }, [startRecording, stopRecording]);

  // Saiu do modo gravação ou desmontou: microfone desligado.
  useEffect(() => () => recordRef.current && stopRecording("cancel"), [stopRecording]);

  // O que o Henry está falando agora (filtro de eco da interrupção).
  // Pensando: a frase de espera que está tocando (o "só um instante" dele nunca interrompe a si mesmo).
  const currentSpeech = useCallback(() => (phaseRef.current === "thinking" ? narratingTextRef.current : lastReplyRef.current), []);

  // Interrupção: corta a voz e cancela o pedido (chamado já no resultado parcial, para parar em menos de 0,5 s).
  const interrupt = useCallback(() => {
    stopSpeaking();
    abortRequest();
  }, [abortRequest, stopSpeaking]);

  // Frase final reconhecida. Fora do modo conversa só age se começar pelo nome; em conversa, qualquer frase (menos eco e
  // ruído) vira pergunta. Falando/pensando, só o nome e as palavras de parada valem. O resto é descartado aqui.
  // Devolve true quando a frase foi aceita (virou pedido, parada ou fim de conversa) — o status mostra "Ouvi: …" e, só
  // quando foi ignorada, "(diga 'Henry' antes)". Tela cheia aberta = já está chamando (sem o nome; dono, 2026-10-22).
  // armed = o parcial deste trecho trouxe o nome e a final veio sem ele (o Chrome corta o "Henry" da final, principalmente
  // logo depois de reiniciar): vale como chamada (dono, 2026-10-22: minimizado "escuta, mas não responde").
  const handleFinal = useCallback((raw, { armed = false } = {}) => {
    const text = String(raw || "").trim();
    if (!text) return false;
    const conversation = conversationRef.current;
    const spoken = [lastReplyRef.current];
    const ask = (mode, question) => askRef.current?.({ mode, question, shown: text });
    if (conversation.active && isConversationEnd(text) && !isEchoOf(text, spoken)) {
      interrupt();
      endConversation();
      sayGoodbye();
      return true;
    }
    if (phaseRef.current === "speaking" || phaseRef.current === "thinking") {
      // Falando (computador): qualquer frase dele que não seja eco interrompe e vira a nova pergunta; pensando: só o nome
      // e as palavras de parada.
      const barge = phaseRef.current === "speaking" && desktopRef.current ? detectSpeechBargeIn(text, currentSpeech(), { final: true }) : detectBargeIn(text, currentSpeech());
      if (!barge.interrupt) return false;
      interrupt();
      startConversation();
      if (barge.kind === "question") ask("question", barge.question); // "Henry, e ontem?" → responde direto, sem bipe
      else if (barge.kind === "report") ask("report", "");
      else listenAgain();
      return true;
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
  }, [currentSpeech, endConversation, interrupt, listenAgain, sayGoodbye, startConversation]);

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

  // Medidor do microfone enquanto ele fala (computador): voz do dono por ~300 ms confirma a interrupção por fala.
  const micLoudRef = useRef(false);
  useEffect(() => {
    if (phase !== "speaking" || !desktop) {
      micLoudRef.current = false;
      return undefined;
    }
    let since = 0;
    const timer = window.setInterval(() => {
      const analyser = micAnalyserRef.current;
      if (!analyser || !meterBuffer) return;
      const state = micVoiceSustained({ level: levelFrom(analyser, meterBuffer), since });
      since = state.since;
      micLoudRef.current = state.sustained;
    }, 50);
    return () => window.clearInterval(timer);
  }, [phase, desktop]);

  // --- Escuta contínua --------------------------------------------------------------------------------------------
  // Handlers por ref: o reconhecimento NÃO é recriado quando a identidade de uma função muda (recriar aborta a sessão e
  // perde palavras — o "Henry" do começo da frase). Só liga/desliga com active/supported/muted/recordMode/listenMode.
  const handleFinalRef = useRef(handleFinal);
  handleFinalRef.current = handleFinal;
  const recognitionHandlersRef = useRef({});
  recognitionHandlersRef.current = { markActivity, startMicMeter, stopMicMeter, currentSpeech, interrupt, warmServer, markCalling };
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
    const wantsRun = () => shouldRunRecognition({ mode: listenModeRef.current, sessionOpen: sessionOpenRef.current }) && !(!desktopRef.current && phaseRef.current === "speaking");
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
        if (detectWakeWord(text).called) {
          handlers.warmServer(); // ouviu "Henry": já aquece o relatório enquanto ele fala
          handlers.markCalling(); // e o ícone já cresce
        }
        if ((phaseRef.current === "speaking" || phaseRef.current === "thinking") && detectBargeIn(text, handlers.currentSpeech()).interrupt) {
          handlers.interrupt(); // resultado parcial: corta na hora; a frase final decide se já tem pergunta
        } else if (phaseRef.current === "speaking" && desktopRef.current && detectSpeechBargeIn(text, handlers.currentSpeech()).interrupt && (!micAnalyserRef.current || micLoudRef.current)) {
          handlers.interrupt(); // ele começou a falar por cima (3+ palavras que não são eco, voz confirmada no microfone)
        }
      }
      if (interim.text) {
        interimTimer = window.setTimeout(() => {
          const forced = forceInterimFinal(interim);
          interim = forced.state;
          if (forced.text) deliverFinal(forced.text, forced.named);
        }, INTERIM_FINAL_MS);
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
    if (desktop) return;
    if (phase === "speaking") {
      stopListeningRef.current?.();
      stopMicMeter();
    } else if (phase === "armed" && sessionOpenRef.current) {
      setAudioSession("play-and-record");
      startListeningRef.current?.();
    } else if (phase === "idle") {
      setAudioSession("auto");
    }
  }, [phase, desktop, stopMicMeter, setAudioSession]);

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
      } else if (event.key === "Escape" && expanded) {
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
        ? "Ouvindo… toque de novo para enviar"
        : phase === "thinking"
          ? scene.label || "Pensando…"
          : phase === "speaking"
            ? "Falando… toque na tela para interromper"
            : "Toque no Henry para falar"
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
      caption={captionFor(phase, turns)}
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
    />
    <HenryCursor request={navRequest} mobile={!desktop} />
    </>
  );
}
