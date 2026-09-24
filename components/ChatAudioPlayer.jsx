"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { floatChannelsToWav } from "@/lib/audio-wav.mjs";

// Player de áudio do Chat: Play/Pause, barra de progresso, tempo atual/duração e indicador de
// carregamento. Serve tanto para áudios enviados pelo CRM (URL pública) quanto para os RECEBIDOS do
// cliente (rota autenticada do CRM, que baixa da Meta na primeira vez — daí o estado "carregando").
//
// Formatos: o WhatsApp manda OGG/Opus. Chrome/Edge/Firefox tocam direto; o Safari/iPhone não — nesse
// caso o áudio é decodificado no próprio aparelho (Opus -> PCM/WAV, sem recodificar com perda).
// Se nada funcionar: "Não foi possível carregar este áudio." + "Tentar novamente".

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

// O decodificador é um arquivo vendorizado em /public/vendor (fora do bundler), carregado só se preciso.
let decoderScriptPromise = null;
function loadOggOpusDecoder() {
  if (typeof window === "undefined") return Promise.reject(new Error("sem janela"));
  if (window["ogg-opus-decoder"]) return Promise.resolve(window["ogg-opus-decoder"]);
  if (!decoderScriptPromise) {
    decoderScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/vendor/ogg-opus-decoder.min.js";
      script.async = true;
      script.onload = () => (window["ogg-opus-decoder"] ? resolve(window["ogg-opus-decoder"]) : reject(new Error("decodificador indisponível")));
      script.onerror = () => { decoderScriptPromise = null; reject(new Error("decodificador indisponível")); };
      document.head.appendChild(script);
    });
  }
  return decoderScriptPromise;
}

async function decodeOggOpusToWavUrl(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("download");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const { OggOpusDecoder } = await loadOggOpusDecoder();
  const decoder = new OggOpusDecoder();
  try {
    await decoder.ready;
    const { channelData, sampleRate, samplesDecoded } = await decoder.decodeFile(bytes);
    if (!samplesDecoded) throw new Error("vazio");
    const wav = floatChannelsToWav(channelData, sampleRate);
    return URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
  } finally {
    decoder.free?.();
  }
}

export default function ChatAudioPlayer({ src, mime = "", state = "" }) {
  const audioRef = useRef(null);
  const decodedUrlRef = useRef("");
  const [phase, setPhase] = useState(state === "stored" ? "ready" : "idle"); // idle | loading | ready | error
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fellBack, setFellBack] = useState(false);
  const wantPlayRef = useRef(false);

  const cleanupDecoded = useCallback(() => {
    if (decodedUrlRef.current) {
      URL.revokeObjectURL(decodedUrlRef.current);
      decodedUrlRef.current = "";
    }
  }, []);

  useEffect(() => cleanupDecoded, [cleanupDecoded]);

  // Áudio já guardado: carrega só os metadados (duração) sem tocar.
  useEffect(() => {
    if (state === "stored" && audioRef.current && !audioRef.current.src) {
      audioRef.current.src = src;
      audioRef.current.load();
    }
  }, [src, state]);

  async function fallbackDecode(sourceUrl) {
    try {
      const wavUrl = await decodeOggOpusToWavUrl(sourceUrl);
      cleanupDecoded();
      decodedUrlRef.current = wavUrl;
      setFellBack(true);
      const audio = audioRef.current;
      audio.src = wavUrl;
      audio.load();
      if (wantPlayRef.current) await audio.play().catch(() => {});
      setPhase("ready");
    } catch {
      setPhase("error");
      setPlaying(false);
    }
  }

  async function start({ retry = false } = {}) {
    const audio = audioRef.current;
    if (!audio) return;
    wantPlayRef.current = true;
    setPhase("loading");
    cleanupDecoded();
    setFellBack(false);
    try {
      let sourceUrl = src;
      if (retry) {
        // Força o servidor a baixar de novo da Meta e devolve erro claro se ainda não der.
        const check = await fetch(`${src}${src.includes("?") ? "&" : "?"}retry=1`, { cache: "no-store", headers: { Range: "bytes=0-0" } });
        if (!check.ok && check.status !== 206) throw new Error("retry");
        sourceUrl = `${src}${src.includes("?") ? "&" : "?"}t=${Date.now()}`;
      }
      audio.src = sourceUrl;
      audio.load();
      await audio.play();
    } catch (error) {
      if (error?.message === "retry") {
        setPhase("error");
        setPlaying(false);
        return;
      }
      // Navegador sem suporte ao formato (ou play bloqueado): tenta decodificar no aparelho.
      const unsupported = audio.error || /notsupported/i.test(String(error?.name || ""));
      if (unsupported) await fallbackDecode(src);
    }
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (phase === "error") return start({ retry: true });
    if (playing) {
      wantPlayRef.current = false;
      audio.pause();
      return;
    }
    if (!audio.src) return start();
    wantPlayRef.current = true;
    audio.play().catch(() => start());
  }

  function seek(event) {
    const audio = audioRef.current;
    const next = Number(event.target.value);
    if (audio && Number.isFinite(next)) {
      audio.currentTime = next;
      setCurrent(next);
    }
  }

  const loading = phase === "loading" && !playing;
  const max = Number.isFinite(duration) && duration > 0 ? duration : 0;

  return (
    <div className="mb-1 w-[250px] max-w-full" data-audio-state={phase} data-audio-fallback={fellBack ? "wav" : "native"}>
      <audio
        ref={audioRef}
        preload={state === "stored" ? "metadata" : "none"}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration);
          setPhase((value) => (value === "loading" ? "ready" : value));
        }}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onCanPlay={() => setPhase((value) => (value === "loading" ? "ready" : value))}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onPlay={() => { setPlaying(true); setPhase("ready"); }}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0); wantPlayRef.current = false; }}
        onError={() => {
          // Erro do próprio <audio>: formato não suportado ou arquivo indisponível.
          if (!fellBack && decodedUrlRef.current === "") fallbackDecode(audioRef.current?.currentSrc || src);
          else { setPhase("error"); setPlaying(false); }
        }}
      />
      {phase === "error" ? (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
          <span className="min-w-0 flex-1 text-[11px] font-extrabold leading-4 text-red-700">Não foi possível carregar este áudio.</span>
          <button type="button" onClick={() => start({ retry: true })} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-red-200 bg-white px-2 py-1 text-[11px] font-extrabold text-red-700 transition hover:bg-red-50">
            <RotateCcw className="h-3 w-3" /> Tentar novamente
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pausar áudio" : "Tocar áudio"}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy text-white transition hover:bg-[#082f55]"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
          </button>
          <div className="min-w-0 flex-1">
            <input
              type="range"
              min={0}
              max={max || 1}
              step="0.1"
              value={max ? Math.min(current, max) : 0}
              onChange={seek}
              disabled={!max}
              aria-label="Progresso do áudio"
              className="block h-1.5 w-full cursor-pointer appearance-none rounded-full bg-navy/15 accent-[#0B3A6F] disabled:cursor-default"
            />
            <div className="mt-0.5 flex justify-between text-[10px] font-bold tabular-nums text-slate-400">
              <span>{loading ? "Carregando…" : formatClock(current)}</span>
              <span>{max ? formatClock(max) : "--:--"}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
