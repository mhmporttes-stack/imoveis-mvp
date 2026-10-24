// Aperte para falar com transcrição AO VIVO (REGRA OFICIAL — dono, 2026-10-24): junção dos trechos, decisão ao soltar
// (texto ao vivo × reserva da gravação), limites e custo. Só funções puras.
import test from "node:test";
import assert from "node:assert/strict";
import {
  HENRY_LIVE_COMMIT_WAIT_MS,
  HENRY_LIVE_MAX_MS,
  RECORD_MAX_MS,
  applyLiveTranscriptMessage,
  downsampleToPcm16,
  emptyLiveTranscript,
  henryLatencyBreakdown,
  liveCaption,
  liveIntentHint,
  liveReleaseDecision,
  liveTranscriptText,
  pcm16ToBase64
} from "../lib/henry-voice-conversation.mjs";
import {
  ELEVENLABS_STT_USD_PER_HOUR,
  ELEVENLABS_STT_REALTIME_USD_PER_HOUR,
  buildElevenLabsRealtimeTokenRequest,
  buildElevenLabsRealtimeUrl,
  estimateElevenLabsRealtimeSttCostUsd,
  parseElevenLabsRealtimeToken
} from "../lib/henry-voice-providers.mjs";

const feed = (messages) => messages.reduce((state, message) => applyLiveTranscriptMessage(state, message), emptyLiveTranscript());

test("junta trechos fechados com o parcial em aberto", () => {
  const state = feed([
    { message_type: "session_started", session_id: "x" },
    { message_type: "partial_transcript", text: "quantos clientes" },
    { message_type: "committed_transcript", text: "Quantos clientes novos" },
    { message_type: "partial_transcript", text: "  entraram   hoje " }
  ]);
  assert.equal(state.started, true);
  assert.equal(liveTranscriptText(state), "Quantos clientes novos entraram hoje");
  assert.equal(state.commits, 1);
});

test("fechamento com carimbo de tempo não duplica o texto", () => {
  const state = feed([
    { message_type: "session_started" },
    { message_type: "committed_transcript", text: "bom dia" },
    { message_type: "committed_transcript_with_timestamps", text: "bom dia", words: [] }
  ]);
  assert.equal(liveTranscriptText(state), "bom dia");
  assert.equal(state.commits, 1);
});

test("erro do serviço marca falha (cai na gravação)", () => {
  for (const type of ["auth_error", "quota_exceeded", "rate_limited", "session_time_limit_exceeded", "transcriber_error"]) {
    const state = feed([{ message_type: "session_started" }, { message_type: "partial_transcript", text: "oi" }, { message_type: type, error: "x" }]);
    assert.equal(state.failed, true, type);
    assert.equal(liveReleaseDecision({ state, commitsAtRelease: 0, waitedMs: 0 }), "fallback", type);
  }
});

test("ao soltar: usa o texto quando o fechamento chega", () => {
  const before = feed([{ message_type: "session_started" }, { message_type: "partial_transcript", text: "abre a agenda" }]);
  assert.equal(liveReleaseDecision({ state: before, commitsAtRelease: 0, waitedMs: 100 }), "wait");
  const after = applyLiveTranscriptMessage(before, { message_type: "committed_transcript", text: "abre a agenda" });
  assert.equal(liveReleaseDecision({ state: after, commitsAtRelease: 0, waitedMs: 150 }), "use");
});

test("ao soltar: fechamento demorou → usa o parcial; sem texto → reserva", () => {
  const partial = feed([{ message_type: "session_started" }, { message_type: "partial_transcript", text: "toca Djavan" }]);
  assert.equal(liveReleaseDecision({ state: partial, commitsAtRelease: 0, waitedMs: HENRY_LIVE_COMMIT_WAIT_MS }), "use");
  const empty = feed([{ message_type: "session_started" }]);
  assert.equal(liveReleaseDecision({ state: empty, commitsAtRelease: 0, waitedMs: HENRY_LIVE_COMMIT_WAIT_MS }), "fallback");
  const emptyCommit = applyLiveTranscriptMessage(empty, { message_type: "committed_transcript", text: "" });
  assert.equal(liveReleaseDecision({ state: emptyCommit, commitsAtRelease: 0, waitedMs: 10 }), "fallback");
});

test("ao soltar: sem conexão ou sem áudio enviado → reserva na hora (sem esperar)", () => {
  assert.equal(liveReleaseDecision({ state: emptyLiveTranscript(), waitedMs: 0 }), "fallback");
  const started = feed([{ message_type: "session_started" }, { message_type: "partial_transcript", text: "oi" }]);
  assert.equal(liveReleaseDecision({ state: started, waitedMs: 0, audioSent: false }), "fallback");
});

test("fechamento antigo (antes de soltar) não conta como o final", () => {
  const state = feed([{ message_type: "session_started" }, { message_type: "committed_transcript", text: "primeira parte" }, { message_type: "partial_transcript", text: "segunda" }]);
  assert.equal(liveReleaseDecision({ state, commitsAtRelease: 1, waitedMs: 200 }), "wait");
});

test("limite: uma sessão por aperto, no máximo o teto da gravação (25 s); texto até 500 caracteres", () => {
  assert.equal(HENRY_LIVE_MAX_MS, RECORD_MAX_MS);
  assert.equal(HENRY_LIVE_MAX_MS, 25000);
  const long = feed([{ message_type: "session_started" }, { message_type: "partial_transcript", text: "palavra ".repeat(200) }]);
  assert.ok(liveTranscriptText(long).length <= 500);
});

test("legenda 'Ouvindo…' mostra o fim do texto", () => {
  assert.equal(liveCaption(""), "Ouvindo…");
  assert.equal(liveCaption("quantos clientes"), "Ouvindo… quantos clientes");
  const caption = liveCaption("a ".repeat(100) + "final da frase", 20);
  assert.ok(caption.startsWith("Ouvindo… …"));
  assert.ok(caption.endsWith("final da frase"));
});

test("pré-classificação pelo parcial só prepara (música, dados, cumprimento)", () => {
  assert.equal(liveIntentHint("toca uma música do Djavan").topic, "music");
  assert.equal(liveIntentHint("quantos clientes novos hoje").tools, true);
  const hi = liveIntentHint("boa noite");
  assert.equal(hi.greeting, true);
  assert.equal(hi.tools, false);
  assert.deepEqual(liveIntentHint(""), { topic: "", tools: false, greeting: false });
});

test("áudio: 48 kHz → PCM 16 kHz e base64 igual ao do Node", () => {
  const input = new Float32Array(4800).map((_, i) => Math.sin(i / 10) * 0.5);
  const pcm = downsampleToPcm16(input, 48000, 16000);
  assert.equal(pcm.length, 1600);
  assert.ok(Math.abs(pcm[100]) <= 0x7fff);
  for (const size of [0, 1, 2, 3, 160, 1365]) {
    const sample = new Int16Array(size).map((_, i) => (i * 7919) % 65536 - 32768);
    assert.equal(pcm16ToBase64(sample), Buffer.from(sample.buffer).toString("base64"), `tamanho ${size}`);
  }
  const clipped = downsampleToPcm16(new Float32Array([2, -2]), 16000, 16000);
  assert.deepEqual([...clipped], [32767, -32767]);
});

test("token de uso único e endereço do WebSocket (a chave nunca vai ao navegador)", () => {
  assert.deepEqual(buildElevenLabsRealtimeTokenRequest(), { url: "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", method: "POST" });
  assert.equal(parseElevenLabsRealtimeToken({ token: "sutkn_1234567890" }), "sutkn_1234567890");
  assert.equal(parseElevenLabsRealtimeToken({ token: "com espaço" }), "");
  assert.equal(parseElevenLabsRealtimeToken(null), "");
  const url = new URL(buildElevenLabsRealtimeUrl({ token: "sutkn_1234567890" }));
  assert.equal(url.origin + url.pathname, "wss://api.elevenlabs.io/v1/speech-to-text/realtime");
  assert.equal(url.searchParams.get("model_id"), "scribe_v2_realtime");
  assert.equal(url.searchParams.get("audio_format"), "pcm_16000");
  assert.equal(url.searchParams.get("language_code"), "por");
  assert.equal(url.searchParams.get("commit_strategy"), "manual");
  assert.equal(url.searchParams.get("token"), "sutkn_1234567890");
  assert.equal(buildElevenLabsRealtimeUrl({ token: "" }), "");
});

test("custo: ao vivo US$ 0,39/h (batch 0,22/h); 10 s ≈ US$ 0,0011", () => {
  assert.equal(ELEVENLABS_STT_REALTIME_USD_PER_HOUR, 0.39);
  assert.equal(ELEVENLABS_STT_USD_PER_HOUR, 0.22);
  assert.ok(Math.abs(estimateElevenLabsRealtimeSttCostUsd(10) - 0.00108333) < 1e-6);
  assert.equal(estimateElevenLabsRealtimeSttCostUsd(-5), 0);
});

test("tempos: modo da transcrição entra no log (só o rótulo)", () => {
  assert.equal(henryLatencyBreakdown({ sttMode: "live" }).stt_modo, "live");
  assert.equal(henryLatencyBreakdown({ sttMode: "fallback" }).stt_modo, "fallback");
  assert.equal(henryLatencyBreakdown({ sttMode: "outra coisa" }).stt_modo, undefined);
});
