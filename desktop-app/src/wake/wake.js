// Escuta do nome "Henry" (fase 1.1, dono 2026-10-23 — docs/BUSINESS_RULES.md HENRY-1 "App de desktop"). Roda numa janela
// ESCONDIDA do app, com o Vosk (WASM, offline) e uma gramática que só conhece as variantes do nome. O áudio fica só na
// memória desta página: nunca é gravado nem enviado. Só as palavras reconhecidas (com a confiança) vão ao processo
// principal, que decide (core.js detectWakeInResult) e avisa o CRM.
/* global Vosk, mmWake */
"use strict";

const SAMPLE_RATE = 16000;
const FRAME = 2048; // 128 ms
const PREROLL_FRAMES = 4; // ~0,5 s guardado antes da fala (o começo do "Henry" não se perde)
const HANGOVER_FRAMES = 8; // ~1 s depois da fala (o Vosk fecha a frase com o silêncio)

let paused = false;

function rms(samples) {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
  return Math.sqrt(sum / samples.length);
}

async function start() {
  const config = await mmWake.config();
  const model = await Vosk.createModel(config.modelUrl, -1);
  const recognizer = new model.KaldiRecognizer(SAMPLE_RATE, JSON.stringify(config.grammar));
  recognizer.setWords(true);
  recognizer.on("result", (message) => {
    const words = message?.result?.result;
    if (Array.isArray(words) && words.length) mmWake.result(words.map((item) => ({ word: String(item.word || ""), conf: Number(item.conf) || 0 })));
  });

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    video: false
  });
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(FRAME, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0; // o processador precisa estar ligado à saída para rodar; ganho 0 = nada sai no alto-falante
  source.connect(processor);
  processor.connect(silent);
  silent.connect(context.destination);

  // Porta de energia: em silêncio o Vosk não recebe nada (é isso que deixa a CPU perto de zero em repouso).
  const preroll = [];
  let noise = 0.004;
  let hangover = 0;
  let loudFrames = 0;
  processor.onaudioprocess = (event) => {
    if (paused) {
      preroll.length = 0;
      hangover = 0;
      return;
    }
    const samples = new Float32Array(event.inputBuffer.getChannelData(0));
    const level = rms(samples);
    const speaking = level > Math.max(0.006, noise * 3);
    if (!speaking && hangover === 0) noise = noise * 0.95 + level * 0.05; // ruído de fundo só no silêncio
    loudFrames = speaking ? loudFrames + 1 : 0;
    if (loudFrames > 80) noise = noise * 0.9 + level * 0.1; // barulho constante (> 10 s): vira o novo "silêncio"
    if (speaking) {
      while (preroll.length) recognizer.acceptWaveformFloat(preroll.shift(), SAMPLE_RATE);
      hangover = HANGOVER_FRAMES;
      recognizer.acceptWaveformFloat(samples, SAMPLE_RATE);
      return;
    }
    if (hangover > 0) {
      hangover -= 1;
      recognizer.acceptWaveformFloat(samples, SAMPLE_RATE);
      if (hangover === 0) recognizer.retrieveFinalResult();
      return;
    }
    preroll.push(samples);
    if (preroll.length > PREROLL_FRAMES) preroll.shift();
  };
  mmWake.status("ouvindo");
}

mmWake.onPause((value) => {
  paused = Boolean(value);
});

start().catch((error) => mmWake.status("erro", String(error?.message || error).slice(0, 120)));
