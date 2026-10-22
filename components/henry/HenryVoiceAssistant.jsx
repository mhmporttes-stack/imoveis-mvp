"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { detectWakeWord, isAllowedHenryPath, isVisualQuestion, looksLikeEcho, HENRY_HISTORY_TURNS } from "@/lib/henry-voice-core.mjs";
import HenryVoiceView from "./HenryVoiceView";
import { captureWebcamFrame } from "./webcam-capture";

// Assistente de voz "Henry" (pedido do dono, 2026-10-22 — docs/BUSINESS_RULES.md HENRY-1). Montado no layout do painel só
// para o DONO (conta real, fora de "Alterar conta"); a rota /api/admin/henry confere de novo. Só no computador (≥ 768px).
// Mãos livres: o Chrome escuta o tempo todo (Web Speech API, pt-BR) e só o que vem DEPOIS do nome "Henry" vira pergunta —
// o resto é descartado aqui mesmo, nunca vai ao servidor. Ícone pequeno no canto; clique abre a tela cheia; Esc minimiza.
// A conversa continua ao trocar de tela (o layout não desmonta). Alt+B liga/desliga o microfone (mudo).

const MUTE_KEY = "mm_henry_muted";
const FOLLOW_UP_MS = 8000; // depois de o Henry falar (ou de ouvir só "Henry"), a próxima frase vale sem repetir o nome
const RESTART_DELAY_MS = 400;
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
  const [supported, setSupported] = useState(true);
  const [muted, setMuted] = useState(false);
  const [micState, setMicState] = useState("idle"); // idle | listening | blocked
  const [phase, setPhase] = useState("idle"); // idle | armed | thinking | speaking
  const [expanded, setExpanded] = useState(false);
  const [turns, setTurns] = useState([]);
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState("");

  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(false);
  const phaseRef = useRef("idle");
  const turnsRef = useRef([]);
  const armedUntilRef = useRef(0);
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
      })
      .catch(() => alive && setEnabled(false))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
      media.removeEventListener("change", syncDesktop);
    };
  }, []);

  const active = ready && enabled && desktop;

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
    const resume = () => ensureAudioContext();
    window.addEventListener("pointerdown", resume, { once: true });
    return () => window.removeEventListener("pointerdown", resume);
  }, [active, ensureAudioContext]);

  // Sinal do anel (HenryOrb): estado + nível REAL do áudio. "Ouvindo" = alguém falando perto (resultado parcial do
  // reconhecedor há menos de 1,5 s) ou o Henry esperando a pergunta; fora disso o anel só respira.
  const getSignal = useCallback(() => {
    const current = phaseRef.current;
    if (current === "speaking") {
      return { mode: "speaking", level: outAnalyserRef.current ? levelFrom(outAnalyserRef.current, meterBuffer) : 0.45 + Math.sin(Date.now() / 140) * 0.3 };
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

  // --- Fala do Henry -----------------------------------------------------------------------------------------------
  const finishSpeaking = useCallback(() => {
    if (phaseRef.current !== "speaking") return;
    armedUntilRef.current = Date.now() + FOLLOW_UP_MS;
    updatePhase("armed");
    window.setTimeout(() => {
      if (phaseRef.current === "armed" && Date.now() >= armedUntilRef.current) updatePhase("idle");
    }, FOLLOW_UP_MS + 50);
  }, [updatePhase]);

  const stopSpeaking = useCallback(() => {
    const audio = audioRef.current;
    if (audio && !audio.paused) audio.pause();
    if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel();
    if (phaseRef.current === "speaking") updatePhase("idle");
  }, [updatePhase]);

  const speakWithBrowser = useCallback((text) => {
    const synth = window.speechSynthesis;
    if (!synth) {
      finishSpeaking();
      return;
    }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-BR";
    utterance.rate = browserRateRef.current;
    const voice = synth.getVoices().find((item) => item.lang?.toLowerCase().startsWith("pt-br"));
    if (voice) utterance.voice = voice;
    utterance.onend = finishSpeaking;
    utterance.onerror = finishSpeaking;
    synth.speak(utterance);
  }, [finishSpeaking]);

  const playReply = useCallback(async (text, audio) => {
    lastReplyRef.current = text;
    updatePhase("speaking");
    if (!audio?.base64) {
      outAnalyserRef.current = null;
      speakWithBrowser(text);
      return;
    }
    try {
      // Um elemento por resposta: só passa pelo medidor (WebAudio) se o contexto já estiver rodando — um elemento ligado a
      // um contexto suspenso tocaria mudo.
      const element = new Audio(`data:${audio.contentType || "audio/mpeg"};base64,${audio.base64}`);
      element.addEventListener("ended", finishSpeaking);
      element.addEventListener("error", finishSpeaking);
      const context = audioCtxRef.current;
      if (context && context.state === "running") {
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaElementSource(element).connect(analyser);
        analyser.connect(context.destination);
        outAnalyserRef.current = analyser;
      } else {
        outAnalyserRef.current = null;
      }
      audioRef.current = element;
      await element.play();
    } catch {
      setNotice("Clique uma vez na página para liberar o som do Henry.");
      speakWithBrowser(text);
    }
  }, [finishSpeaking, speakWithBrowser, updatePhase]);

  const chime = useCallback(() => {
    const context = ensureAudioContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.25);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.3);
  }, [ensureAudioContext]);

  // --- Pergunta ao servidor ---------------------------------------------------------------------------------------
  const ask = useCallback(async ({ mode, question, shown }) => {
    if (phaseRef.current === "thinking") return;
    stopSpeaking();
    setNotice("");
    const history = turnsRef.current.slice(-HENRY_HISTORY_TURNS);
    const nextTurns = [...turnsRef.current, { role: "user", text: shown || question }];
    turnsRef.current = nextTurns;
    setTurns(nextTurns);
    updatePhase("thinking");
    try {
      // Visão (HENRY-2): 1 quadro da webcam só no "bom dia" ou em pergunta visual, com a visão ligada. Falhou → sem imagem.
      let image = null;
      if (visionRef.current && (mode === "report" || isVisualQuestion(question))) {
        setCapturing(true);
        image = await captureWebcamFrame();
        setCapturing(false);
      }
      const response = await fetch("/api/admin/henry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(image ? { mode, question, history, image } : { mode, question, history })
      });
      image = null;
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Não consegui responder agora.");
      const withReply = [...turnsRef.current, { role: "assistant", text: data.reply }];
      turnsRef.current = withReply;
      setTurns(withReply);
      if (data.navigate?.path && isAllowedHenryPath(data.navigate.path)) router.push(data.navigate.path);
      await playReply(data.reply, data.audio);
    } catch (error) {
      setCapturing(false);
      updatePhase("idle");
      setNotice(error?.message || "Não consegui responder agora.");
    }
  }, [playReply, router, stopSpeaking, updatePhase]);

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

  // Frase final reconhecida → só age se começar pelo nome (ou na janela de continuação). O resto é descartado aqui.
  const handleFinal = useCallback((text) => {
    const detected = detectWakeWord(text);
    if (detected.called) {
      stopSpeaking();
      if (detected.kind === "report") askRef.current?.({ mode: "report", question: "", shown: text.trim() });
      else if (detected.kind === "question") askRef.current?.({ mode: "question", question: detected.question, shown: text.trim() });
      else {
        armedUntilRef.current = Date.now() + FOLLOW_UP_MS;
        updatePhase("armed");
        chime();
        window.setTimeout(() => {
          if (phaseRef.current === "armed" && Date.now() >= armedUntilRef.current) updatePhase("idle");
        }, FOLLOW_UP_MS + 50);
      }
      return;
    }
    const inWindow = phaseRef.current === "armed" && Date.now() < armedUntilRef.current;
    if (inWindow && !looksLikeEcho(text, lastReplyRef.current) && text.trim().split(/\s+/).length >= 2) {
      askRef.current?.({ mode: "question", question: text.trim(), shown: text.trim() });
    }
  }, [chime, stopSpeaking, updatePhase]);

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
    let stopped = false;
    const recognition = new Recognition();
    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => setMicState("listening");
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript || "";
        lastHeardRef.current = Date.now(); // alguém falando perto: o anel passa a "ouvindo" (nada é enviado)
        markActivity();
        if (result.isFinal) handleFinal(text);
        else if (phaseRef.current === "speaking" && detectWakeWord(text).called) stopSpeaking(); // barge-in: "Henry..."
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        stopped = true;
        setMicState("blocked");
      }
    };
    recognition.onend = () => {
      if (stopped || !shouldListenRef.current) return;
      window.setTimeout(() => {
        if (stopped || !shouldListenRef.current) return;
        try {
          recognition.start();
        } catch {
          // já está rodando
        }
      }, RESTART_DELAY_MS);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // ignora: o onend reinicia
    }
    startMicMeter();
    return () => {
      stopped = true;
      recognition.onend = null;
      recognition.abort();
    };
  }, [active, supported, muted, handleFinal, markActivity, startMicMeter, stopMicMeter, stopSpeaking]);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      if (next) stopSpeaking();
      return next;
    });
  }, [stopSpeaking]);

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
            ? "Falando… diga “Henry” para interromper"
            : phase === "armed"
              ? "Pode falar…"
              : micState === "listening"
                ? "Ouvindo — diga “Henry”"
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
      onExpand={() => setExpanded(true)}
      onMinimize={() => setExpanded(false)}
      status={status}
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
