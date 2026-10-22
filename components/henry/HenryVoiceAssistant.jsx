"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { detectWakeWord, isAllowedHenryPath, isVisualQuestion } from "@/lib/henry-voice-core.mjs";
import {
  ACK_DELAY_MS,
  acceptFollowUp,
  henryListenMode,
  shouldRunRecognition,
  silentWavDataUri,
  conversationHistory,
  detectBargeIn,
  henryCaption as captionFor,
  isConversationEnd,
  isConversationExpired,
  isEchoOf,
  isStopCommand,
  nextRestartDelay,
  pickAcknowledgement
} from "@/lib/henry-voice-conversation.mjs";
import { pickBestBrowserVoice, pronounceForSpeech, splitSentences } from "@/lib/henry-voice-providers.mjs";
import HenryVoiceView from "./HenryVoiceView";
import { captureWebcamFrame } from "./webcam-capture";

// Assistente de voz "Henry" (pedido do dono, 2026-10-22 — docs/BUSINESS_RULES.md HENRY-1). Montado no layout do painel só
// para o DONO (conta real, fora de "Alterar conta"); a rota /api/admin/henry confere de novo. Só no computador (≥ 768px).
// Mãos livres: o Chrome escuta o tempo todo (Web Speech API, pt-BR) e só o que vem DEPOIS do nome "Henry" vira pergunta —
// o resto é descartado aqui mesmo, nunca vai ao servidor. Ícone pequeno no canto; clique abre a tela cheia; Esc minimiza.
// A conversa continua ao trocar de tela (o layout não desmonta). Alt+B liga/desliga o microfone (mudo).
// Sempre ativo (dono, 2026-10-22): a escuta liga sozinha ao abrir o painel; o som de saída é destravado no primeiro clique
// ou tecla em qualquer lugar. Chamado/em conversa → o ícone do canto dobra de tamanho com legenda; clique → tela cheia.
// Modo conversa (dono, 2026-10-22): depois da 1ª chamada ele segue ouvindo sem o nome até ~20 s de silêncio ou
// "obrigado, Henry"/"pode parar"/"tchau"; falando ou pensando, só o nome e "para/espera/pera/chega" valem (corta na hora e
// cancela o pedido). Memória das últimas ~6 trocas só nesta página (zerada ao sair do modo conversa). Regras puras em
// lib/henry-voice-conversation.mjs.

const MUTE_KEY = "mm_henry_muted";
const IDLE_SLEEP_MS = 30000;
const meterBuffer = typeof Uint8Array === "undefined" ? null : new Uint8Array(1024);

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
  const [heard, setHeard] = useState({ text: "", at: 0 });

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
  const webSourceRef = useRef(null); // voz tocando pelo AudioContext (celular)
  const soundRetryRef = useRef(false); // esperando o toque que libera o som (esse toque não interrompe a fala)
  const requestIdRef = useRef(0);
  const ackTimerRef = useRef(null);
  const lastAckRef = useRef("");
  const speechQueueRef = useRef({ clips: [], playing: false, done: true });
  const mutedRef = useRef(false);

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
    setMuted(window.localStorage.getItem(MUTE_KEY) === "1");
    fetch("/api/admin/henry", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { enabled: false }))
      .then((data) => {
        if (!alive) return;
        setEnabled(Boolean(data?.enabled));
        visionRef.current = data?.vision === true;
        setVision(data?.vision === true);
        if (Number.isFinite(data?.browserRate)) browserRateRef.current = data.browserRate;
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
  const listenMode = henryListenMode({ desktop, mobileWake });
  const listenModeRef = useRef(listenMode);
  listenModeRef.current = listenMode;
  const sessionOpenRef = useRef(false);
  const startListeningRef = useRef(() => {});
  const stopListeningRef = useRef(() => {});

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
    setInConversation(false);
    if (phaseRef.current === "armed") updatePhase("idle");
    if (sound) chime("end");
  }, [chime, updatePhase]);

  // Depois de falar (ou de ser interrompido): em conversa segue ouvindo sem o nome; fora dela, volta a esperar o nome.
  const listenAgain = useCallback(() => {
    if (conversationRef.current.active) {
      conversationRef.current.lastAt = Date.now();
      updatePhase("armed");
    } else {
      updatePhase("idle");
    }
  }, [updatePhase]);

  // --- Fala do Henry (fila: a 1ª frase toca enquanto o resto chega) -------------------------------------------------
  const cancelAck = useCallback(() => {
    window.clearTimeout(ackTimerRef.current);
    ackTimerRef.current = null;
  }, []);

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
    cancelAck();
    speechQueueRef.current = { clips: [], playing: false, done: true };
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
  }, [cancelAck, listenAgain]);

  // Cancela o pedido em andamento (o dono interrompeu enquanto ele pensava).
  const abortRequest = useCallback(() => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    cancelAck();
    setCapturing(false);
    if (phaseRef.current === "thinking") listenAgain();
  }, [cancelAck, listenAgain]);

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
    const advance = () => {
      if (speechQueueRef.current === queue) playNextRef.current();
    };
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
    cancelAck();
    if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending) window.speechSynthesis.cancel(); // corta o "Deixa eu ver…"
    lastReplyRef.current = text;
    speechQueueRef.current = { clips: [], playing: false, done: false };
    updatePhase("speaking");
  }, [cancelAck, updatePhase]);

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

  // --- Pergunta ao servidor ---------------------------------------------------------------------------------------
  // Interrompe o que estiver em andamento (pedido e voz) e faz a nova pergunta. Memória: só as trocas do modo conversa
  // atual (no máximo ~6), só desta página — nada vai para o banco.
  const ask = useCallback(async ({ mode, question, shown }) => {
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
    touchConversation();
    // Demorou mais de ~1,2 s → confirmação curta na voz do navegador (sem IA, sem chamada paga).
    if (!mutedRef.current) {
      ackTimerRef.current = window.setTimeout(() => {
        if (requestIdRef.current !== id || phaseRef.current !== "thinking") return;
        const phrase = pickAcknowledgement(lastAckRef.current);
        lastAckRef.current = phrase;
        speakBrowser(phrase);
      }, ACK_DELAY_MS);
    }
    const onReply = (reply, navigate) => {
      const withReply = [...turnsRef.current, { role: "assistant", text: reply }];
      turnsRef.current = withReply;
      setTurns(withReply);
      if (navigate?.path && isAllowedHenryPath(navigate.path)) router.push(navigate.path);
      beginSpeech(reply);
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
        body: JSON.stringify(image ? { mode, question, history, image, stream: true } : { mode, question, history, stream: true }),
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
        onReply(data.reply || "", data.navigate);
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
          if (typeof message?.reply === "string") onReply(message.reply, message.navigate);
          else if (typeof message?.text === "string") enqueueClip({ audio: message.audio, text: message.text });
          else if (message?.done) endSpeech();
        }
      }
      if (requestIdRef.current === id && !speechQueueRef.current.done) endSpeech();
    } catch (error) {
      if (error?.name === "AbortError" || requestIdRef.current !== id) return;
      cancelAck();
      setCapturing(false);
      listenAgain();
      setNotice(error?.message || "Não consegui responder agora.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [abortRequest, beginSpeech, cancelAck, endSpeech, enqueueClip, listenAgain, router, speakBrowser, stopSpeaking, touchConversation, updatePhase]);

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

  // O que o Henry está falando agora (filtro de eco da interrupção).
  const currentSpeech = useCallback(() => (phaseRef.current === "thinking" ? lastAckRef.current : lastReplyRef.current), []);

  // Interrupção: corta a voz e cancela o pedido (chamado já no resultado parcial, para parar em menos de 0,5 s).
  const interrupt = useCallback(() => {
    stopSpeaking();
    abortRequest();
  }, [abortRequest, stopSpeaking]);

  // Frase final reconhecida. Fora do modo conversa só age se começar pelo nome; em conversa, qualquer frase (menos eco e
  // ruído) vira pergunta. Falando/pensando, só o nome e as palavras de parada valem. O resto é descartado aqui.
  const handleFinal = useCallback((raw) => {
    const text = String(raw || "").trim();
    if (!text) return;
    const conversation = conversationRef.current;
    const spoken = [lastReplyRef.current, lastAckRef.current];
    const ask = (mode, question) => askRef.current?.({ mode, question, shown: text });
    if (conversation.active && isConversationEnd(text) && !isEchoOf(text, spoken)) {
      interrupt();
      endConversation();
      return;
    }
    if (phaseRef.current === "speaking" || phaseRef.current === "thinking") {
      const barge = detectBargeIn(text, currentSpeech());
      if (!barge.interrupt) return;
      interrupt();
      startConversation();
      if (barge.kind === "question") ask("question", barge.question); // "Henry, e ontem?" → responde direto, sem bipe
      else if (barge.kind === "report") ask("report", "");
      else listenAgain();
      return;
    }
    const detected = detectWakeWord(text);
    if (detected.called) {
      startConversation({ sound: detected.kind === "wake" });
      if (detected.kind === "report") ask("report", "");
      else if (detected.kind === "question") ask("question", detected.question);
      else listenAgain();
      return;
    }
    if (!conversation.active || isConversationExpired(conversation.lastAt)) return;
    if (isStopCommand(text)) {
      listenAgain();
      return;
    }
    if (acceptFollowUp(text, spoken)) ask("question", text);
  }, [currentSpeech, endConversation, interrupt, listenAgain, startConversation]);

  // Fim do modo conversa por silêncio (~20 s sem troca; nunca no meio de uma resposta).
  useEffect(() => {
    if (!inConversation) return undefined;
    const timer = window.setInterval(() => {
      const current = conversationRef.current;
      if (!current.active || phaseRef.current === "thinking" || phaseRef.current === "speaking") return;
      if (isConversationExpired(current.lastAt)) endConversation();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [inConversation, endConversation]);

  // --- Escuta contínua --------------------------------------------------------------------------------------------
  useEffect(() => {
    const Recognition = getRecognitionClass();
    shouldListenRef.current = Boolean(active && supported && !muted && Recognition);
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
      setMicState("listening");
    };
    recognition.onresult = (event) => {
      failures = 0;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript || "";
        lastHeardRef.current = Date.now(); // alguém falando perto: o anel passa a "ouvindo" (nada é enviado)
        markActivity();
        if (result.isFinal) {
          setHeard({ text: text.trim().slice(0, 80), at: Date.now() });
          handleFinal(text);
        }
        else if ((phaseRef.current === "speaking" || phaseRef.current === "thinking") && detectBargeIn(text, currentSpeech()).interrupt) {
          interrupt(); // resultado parcial: corta na hora; a frase final decide se já tem pergunta
        }
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        stopped = true;
        setMicState("blocked");
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        failures += 1;
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
      document.removeEventListener("visibilitychange", onVisible);
      recognition.onend = null;
      recognition.abort();
    };
  }, [active, supported, muted, listenMode, handleFinal, markActivity, startMicMeter, stopMicMeter, currentSpeech, interrupt]);

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
    if (listenModeRef.current !== "tap") return;
    unlockAudio();
    sessionOpenRef.current = true;
    startListeningRef.current?.();
    startConversation({ sound: true });
    listenAgain();
  }, [listenAgain, startConversation, unlockAudio]);

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
    : !supported
    ? "Este navegador não reconhece voz — use o Chrome ou digite"
    : micState === "blocked"
      ? "Microfone bloqueado — libere no cadeado da barra de endereço"
      : muted
        ? "Mudo (Alt+B para ligar)"
        : phase === "thinking"
          ? "Pensando…"
          : phase === "speaking"
            ? desktop ? "Falando… diga “Henry” para interromper" : "Falando… toque na tela para interromper"
            : phase === "armed"
              ? inConversation
                ? "Em conversa — pode falar sem dizer o nome (“obrigado, Henry” encerra)"
                : "Pode falar…"
              : micState === "listening"
                ? heard.text && Date.now() - heard.at < 8000 ? `Ouvi: “${heard.text}” — diga “Henry”` : "Ouvindo — diga “Henry”"
                : listenMode === "tap"
                  ? "Toque no anel para falar"
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
      engaged={inConversation || phase !== "idle"}
      inConversation={inConversation}
      caption={captionFor(phase, turns)}
      turns={turns}
      notice={notice}
      micOff={muted || !supported || micState === "blocked"}
      onToggleMute={toggleMute}
      getSignal={getSignal}
      sleeping={sleeping}
      showKeyboard={showKeyboard || !supported}
      onToggleKeyboard={() => setShowKeyboard((current) => !current)}
      typed={typed}
      onTyped={setTyped}
      onSubmitTyped={submitTyped}
      busy={phase === "thinking"}
      vision={vision}
      capturing={capturing}
      onToggleVision={toggleVision}
    />
  );
}
