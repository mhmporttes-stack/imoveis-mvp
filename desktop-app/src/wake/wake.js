// Escuta do nome "Henry" (fase 1.1, dono 2026-10-23 — docs/BUSINESS_RULES.md HENRY-1 "App de desktop"). Roda numa janela
// ESCONDIDA do app, com o Vosk (WASM, offline) e uma gramática que só conhece as variantes do nome. O áudio fica só na
// memória desta página: nunca é gravado nem enviado. Só as palavras reconhecidas (com a confiança) vão ao processo
// principal, que decide (core.js wakeSequenceStep/wakePartialStep) e avisa o CRM.
// 1.2.1: resultados parciais (acorda mais rápido), taxa real do AudioContext passada ao Vosk, erros do Vosk/microfone,
// nível do áudio a cada 10 s, nome do microfone e modo "Diagnóstico do nome" (reconhecedor de gramática livre por 2 min;
// só o TEXTO vai ao log do app, nunca o áudio).
/* global Vosk, mmWake */
"use strict";

const WANTED_RATE = 16000; // o Vosk trabalha em 16 kHz mono; outra taxa é convertida pelo próprio Vosk
const FRAME = 2048; // 128 ms a 16 kHz
const PREROLL_FRAMES = 4; // ~0,5 s guardado antes da fala (o começo do "Henry" não se perde)
const HANGOVER_FRAMES = 8; // ~1 s depois da fala (o Vosk fecha a frase com o silêncio)
const LEVEL_EVERY_MS = 10000;

let paused = false;
let diagnostic = false;
let model = null;
let freeRecognizer = null;
let sampleRate = WANTED_RATE;
const level = { sum: 0, frames: 0, peak: 0, voiced: 0, segments: 0, noise: 0 };

function report(kind, data) {
  try {
    mmWake.report(kind, data);
  } catch {
    // ponte indisponível: nada a fazer
  }
}

function fail(where, error) {
  report("erro", { where, message: String(error?.message || error?.error || error || "erro").slice(0, 160) });
}

function rms(samples) {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
  return Math.sqrt(sum / samples.length);
}

function wordsOf(message) {
  const words = message?.result?.result;
  return Array.isArray(words) ? words.map((item) => ({ word: String(item.word || ""), conf: Number(item.conf) || 0 })) : [];
}

// Diagnóstico: um 2º reconhecedor SEM gramática, só enquanto o modo está ligado (2 min).
function setDiagnostic(on) {
  diagnostic = Boolean(on);
  if (diagnostic && model && !freeRecognizer) {
    try {
      freeRecognizer = new model.KaldiRecognizer(sampleRate);
      freeRecognizer.setWords(true);
      freeRecognizer.on("result", (message) => {
        const text = String(message?.result?.text || "");
        if (text) report("diag", { text, words: wordsOf(message) });
      });
      freeRecognizer.on("error", (message) => fail("diagnostico", message));
    } catch (error) {
      fail("diagnostico", error);
      freeRecognizer = null;
    }
  }
  if (!diagnostic && freeRecognizer) {
    try {
      freeRecognizer.remove();
    } catch {
      // já removido
    }
    freeRecognizer = null;
  }
}

async function describeDevice(track, context) {
  const settings = typeof track.getSettings === "function" ? track.getSettings() : {};
  let inputs = [];
  try {
    inputs = (await navigator.mediaDevices.enumerateDevices()).filter((item) => item.kind === "audioinput");
  } catch {
    inputs = [];
  }
  const fallback = inputs.find((item) => item.deviceId === "default");
  const usingDefault = !settings.deviceId || settings.deviceId === "default" || Boolean(fallback && settings.groupId && fallback.groupId === settings.groupId);
  report("dispositivo", {
    label: track.label,
    defaultLabel: fallback?.label || "",
    usingDefault,
    deviceRate: settings.sampleRate || 0,
    contextRate: context.sampleRate,
    channels: settings.channelCount || 0,
    inputs: inputs.length
  });
}

async function start() {
  const config = await mmWake.config();
  if (!config) throw new Error("sem_configuracao");
  // Sem Vosk.createModel: ele não termina quando o modelo falha (o erro chega como evento "error", não "load").
  try {
    model = await new Promise((resolve, reject) => {
      const candidate = new Vosk.Model(config.modelUrl, -1);
      const timer = setTimeout(() => reject(new Error("modelo_nao_carregou_em_90s")), 90000);
      candidate.on("load", (message) => {
        clearTimeout(timer);
        if (message?.result) resolve(candidate);
        else reject(new Error("modelo_nao_carregou"));
      });
      candidate.on("error", (message) => {
        clearTimeout(timer);
        reject(new Error(String(message?.error || "modelo_com_erro")));
      });
    });
  } catch (error) {
    fail("modelo", error);
    return;
  }
  model.on("error", (message) => fail("modelo", message));

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false
    });
  } catch (error) {
    fail("microfone", `${error?.name || ""} ${error?.message || ""}`.trim() || "sem_acesso");
    return;
  }
  const [track] = stream.getAudioTracks();
  if (!track) {
    fail("microfone", "sem_faixa_de_audio");
    return;
  }
  track.addEventListener("ended", () => fail("microfone", "microfone_desligado"));
  track.addEventListener("mute", () => report("aviso", { where: "microfone", message: "microfone_mudo" }));
  track.addEventListener("unmute", () => report("aviso", { where: "microfone", message: "microfone_voltou" }));
  navigator.mediaDevices.addEventListener("devicechange", () => report("aviso", { where: "microfone", message: "dispositivos_mudaram" }));

  const context = new AudioContext({ sampleRate: WANTED_RATE });
  sampleRate = context.sampleRate; // a taxa REAL (se o Chromium não aceitar 16 kHz, o Vosk recebe a verdadeira e converte)
  context.addEventListener("statechange", () => {
    if (context.state !== "running") {
      report("aviso", { where: "contexto", message: `audio_${context.state}` });
      context.resume().catch((error) => fail("contexto", error));
    }
  });
  if (context.state !== "running") await context.resume().catch((error) => fail("contexto", error));

  const recognizer = new model.KaldiRecognizer(sampleRate, JSON.stringify(config.grammar));
  recognizer.setWords(true);
  recognizer.on("result", (message) => {
    const words = wordsOf(message);
    if (words.length) mmWake.result(words);
  });
  let lastPartial = "";
  recognizer.on("partialresult", (message) => {
    const text = String(message?.result?.partial || "");
    if (text === lastPartial) return;
    lastPartial = text;
    mmWake.partial(text);
  });
  recognizer.on("error", (message) => fail("vosk", message));
  if (config.diagnostic) setDiagnostic(true);

  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(FRAME, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0; // o processador precisa estar ligado à saída para rodar; ganho 0 = nada sai no alto-falante
  source.connect(processor);
  processor.connect(silent);
  silent.connect(context.destination);

  const feed = (samples) => {
    recognizer.acceptWaveformFloat(samples, sampleRate);
    if (freeRecognizer) freeRecognizer.acceptWaveformFloat(new Float32Array(samples), sampleRate);
  };
  const close = () => {
    recognizer.retrieveFinalResult();
    if (freeRecognizer) freeRecognizer.retrieveFinalResult();
  };

  // Porta de energia: em silêncio o Vosk não recebe nada (é isso que deixa a CPU perto de zero em repouso).
  const preroll = [];
  let noise = 0.004;
  let hangover = 0;
  let loudFrames = 0;
  processor.onaudioprocess = (event) => {
    const samples = new Float32Array(event.inputBuffer.getChannelData(0));
    const value = rms(samples);
    level.sum += value;
    level.frames += 1;
    level.peak = Math.max(level.peak, value);
    level.noise = noise;
    if (paused) {
      preroll.length = 0;
      hangover = 0;
      return;
    }
    const speaking = value > Math.max(0.006, noise * 3);
    if (!speaking && hangover === 0) noise = noise * 0.95 + value * 0.05; // ruído de fundo só no silêncio
    loudFrames = speaking ? loudFrames + 1 : 0;
    if (loudFrames > 80) noise = noise * 0.9 + value * 0.1; // barulho constante (> 10 s): vira o novo "silêncio"
    if (speaking) {
      level.voiced += 1;
      if (hangover === 0) level.segments += 1;
      while (preroll.length) feed(preroll.shift());
      hangover = HANGOVER_FRAMES;
      feed(samples);
      return;
    }
    if (hangover > 0) {
      hangover -= 1;
      feed(samples);
      if (hangover === 0) close();
      return;
    }
    preroll.push(samples);
    if (preroll.length > PREROLL_FRAMES) preroll.shift();
  };

  // A cada 10 s: nível médio/pico do microfone (frames = 0 → o áudio não está chegando). O app decide quanto registra.
  setInterval(() => {
    const frames = level.frames;
    report("nivel", {
      rms: frames ? level.sum / frames : 0,
      peak: level.peak,
      noise: level.noise,
      voiced: frames ? level.voiced / frames : 0,
      segments: level.segments,
      frames,
      paused
    });
    Object.assign(level, { sum: 0, frames: 0, peak: 0, voiced: 0, segments: 0 });
  }, LEVEL_EVERY_MS);

  await describeDevice(track, context);
  mmWake.status("ouvindo", `${sampleRate} Hz`);
}

mmWake.onPause((value) => {
  paused = Boolean(value);
});
mmWake.onDiagnostic((value) => setDiagnostic(value));

start().catch((error) => {
  mmWake.status("erro", String(error?.message || error).slice(0, 120));
  fail("inicio", error);
});
