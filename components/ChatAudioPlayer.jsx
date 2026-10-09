"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Mic, Pause, Play, RotateCcw } from "lucide-react";
import Avatar from "@/components/Avatar";
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

// Visual "igual ao WhatsApp" (pedido do dono, 2026-10-09): foto de quem gravou com o microfone, triângulo de play
// sem círculo, ondas de áudio com a bolinha de progresso (toque/arraste para avançar), duração embaixo e, tocando,
// a pílula de velocidade 1× · 1,5× · 2× no lugar da foto. As ondas são um desenho fixo por áudio (o WhatsApp não
// manda a forma real da onda para o CRM) — só a parte já tocada muda de cor.
const SPEEDS = [1, 1.5, 2];
const BAR_COUNT = 38;

function waveformFor(seed) {
  let hash = 2166136261;
  for (const char of String(seed || "audio")) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const bars = [];
  for (let i = 0; i < BAR_COUNT; i += 1) {
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0;
    const base = 0.25 + (hash % 1000) / 1000 * 0.75;
    // Bordas um pouco mais baixas, como uma fala real.
    const edge = Math.min(1, (i + 1) / 4, (BAR_COUNT - i) / 4);
    bars.push(Math.max(0.18, base * (0.55 + 0.45 * edge)));
  }
  return bars;
}

function speedLabel(value) {
  return `${String(value).replace(".", ",")}×`;
}

export default function ChatAudioPlayer({ src, mime = "", state = "", outbound = false, avatarName = "", avatarUrl = "" }) {
  const audioRef = useRef(null);
  const decodedUrlRef = useRef("");
  const [phase, setPhase] = useState(state === "stored" ? "ready" : "idle"); // idle | loading | ready | error
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fellBack, setFellBack] = useState(false);
  const wantPlayRef = useRef(false);
  const [speed, setSpeed] = useState(1);
  const [played, setPlayed] = useState(false);
  const waveRef = useRef(null);
  const [bars] = useState(() => waveformFor(src));

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed, phase, fellBack]);

  function cycleSpeed() {
    setSpeed((value) => SPEEDS[(SPEEDS.indexOf(value) + 1) % SPEEDS.length]);
  }

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

  function seekTo(clientX) {
    const audio = audioRef.current;
    const box = waveRef.current?.getBoundingClientRect();
    if (!audio || !box || !(duration > 0)) return;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    audio.currentTime = ratio * duration;
    setCurrent(ratio * duration);
  }

  function onWavePointerDown(event) {
    if (!(duration > 0)) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    seekTo(event.clientX);
  }

  function onWavePointerMove(event) {
    if (event.buttons !== 1 && event.pointerType === "mouse") return;
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
    seekTo(event.clientX);
  }

  function onWaveKey(event) {
    const audio = audioRef.current;
    if (!audio || !(duration > 0)) return;
    if (event.key === "ArrowRight") audio.currentTime = Math.min(duration, audio.currentTime + 5);
    else if (event.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 5);
    else return;
    event.preventDefault();
  }

  const loading = phase === "loading" && !playing;
  const max = Number.isFinite(duration) && duration > 0 ? duration : 0;

  return (
    <div className="mb-[-6px] w-[290px] max-w-full" data-audio-state={phase} data-audio-fallback={fellBack ? "wav" : "native"}>
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
        onPlay={(event) => { event.currentTarget.playbackRate = speed; setPlaying(true); setPlayed(true); setPhase("ready"); }}
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
        <div className={`flex items-center gap-2.5 ${outbound ? "" : "flex-row-reverse"}`}>
          {/* Foto de quem gravou (com microfone) — tocando, vira a pílula de velocidade, como no WhatsApp. */}
          <div className="relative grid h-[52px] w-[52px] shrink-0 place-items-center">
            {playing || current > 0 ? (
              <button type="button" onClick={cycleSpeed} aria-label={`Velocidade ${speedLabel(speed)} — tocar para mudar`}
                className="min-w-[44px] rounded-full bg-[#8696A0] px-2 py-1 text-[13px] font-bold tabular-nums text-white active:brightness-90">{speedLabel(speed)}</button>
            ) : (
              <>
                <Avatar name={avatarName} photoUrl={avatarUrl} size={52} className="!border-0" />
                <Mic aria-hidden="true" className={`absolute -bottom-0.5 ${outbound ? "-right-0.5" : "-left-0.5"} h-[18px] w-[18px] ${played || outbound ? "text-[#53BDEB]" : "text-[#25D366]"}`} strokeWidth={2.5} />
              </>
            )}
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <button
                type="button"
                onClick={toggle}
                aria-label={playing ? "Pausar áudio" : "Tocar áudio"}
                className="grid h-9 w-8 shrink-0 place-items-center text-[#54656F] active:scale-95"
              >
                {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : playing ? <Pause className="h-7 w-7 fill-current" strokeWidth={0} /> : <Play className="h-7 w-7 fill-current" strokeWidth={0} />}
              </button>
              <div className="min-w-0 flex-1">
                <div
                  ref={waveRef}
                  role="slider"
                  tabIndex={max ? 0 : -1}
                  aria-label="Progresso do áudio"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(max)}
                  aria-valuenow={Math.round(Math.min(current, max))}
                  aria-valuetext={`${formatClock(current)} de ${formatClock(max)}`}
                  onPointerDown={onWavePointerDown}
                  onPointerMove={onWavePointerMove}
                  onKeyDown={onWaveKey}
                  className="relative flex h-8 touch-none select-none items-center gap-[2px]"
                >
                  {bars.map((height, index) => {
                    const done = max ? (index + 0.5) / bars.length <= current / max : false;
                    return <span key={index} className={`block w-[3px] flex-1 rounded-full ${done ? (outbound ? "bg-[#4FA3D1]" : "bg-[#53BDEB]") : outbound ? "bg-[#9DB79A]" : "bg-[#B4BEC4]"}`} style={{ height: `${Math.round(height * 100)}%` }} />;
                  })}
                  <span aria-hidden="true" className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#53BDEB] shadow"
                    style={{ left: `${max ? Math.min(100, (current / max) * 100) : 0}%` }} />
                </div>
                <div className="mt-0.5 text-[11px] font-medium tabular-nums text-[#667781]">
                  {loading ? "Carregando…" : playing || current > 0 ? formatClock(current) : max ? formatClock(max) : "--:--"}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
