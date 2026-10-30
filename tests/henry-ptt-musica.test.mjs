// Dono, 2026-10-30: (1) segurar Enter entende desde o instante do aperto; (2) a música continua audível enquanto o Henry fala.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_LIVE_MAX_LATE_START_MS,
  HENRY_PTT_TAIL_MS,
  isWarmStreamUsable,
  liveStartedLate,
  pttKeydownPhase,
  pushToTalkKeyAction,
  pushToTalkReleaseAction,
  recordingDecision,
  shouldWarmMic
} from "../lib/henry-voice-conversation.mjs";
import {
  HENRY_DUCK_FADE_MS,
  HENRY_MUSIC_DUCK_RATIO_DEFAULT,
  HENRY_MUSIC_DUCK_RATIO_MIN,
  HENRY_SPOTIFY_RAMP_MS,
  clampMusicDuckRatio,
  duckSpotifyVolume,
  speechDuckLevel,
  spotifyFadePlan
} from "../lib/henry-spotify-core.mjs";
import { HENRY_MUSIC_DUCKS, henryMusicDuckRatio, mergeHenryStyle, parseHenryStylePatch, resolveHenryStyle } from "../lib/henry-voice-style.mjs";

test("aperte para falar: keydown novo começa; repetição (auto-repeat) nunca reinicia", () => {
  assert.equal(pttKeydownPhase({ active: false, repeat: false }), "press");
  assert.equal(pttKeydownPhase({ active: true, repeat: false }), "held");
  assert.equal(pttKeydownPhase({ active: true, repeat: true }), "held"); // segurando: a repetição não faz nada
  assert.equal(pttKeydownPhase({ active: false, repeat: true }), "ignore"); // repetição de um aperto que não começou
  assert.equal(pttKeydownPhase({ active: false, defaultPrevented: true }), "ignore");
  // Enter solto na página começa na hora, sem palavra de chamada.
  assert.equal(pushToTalkKeyAction({ key: "Enter", code: "Enter", henryActive: true, target: null }), "enter");
});

test("aperte para falar: fim só no keyup (sem corte por silêncio) e com cauda curta", () => {
  const base = { startedAt: 0, firstVoiceAt: 0, lastVoiceAt: 0, heardVoice: false, hasMeter: true, now: 10_000 };
  assert.equal(recordingDecision({ ...base, hold: true }), null); // 10 s de silêncio segurando: nada fecha
  assert.equal(recordingDecision({ ...base, heardVoice: true, firstVoiceAt: 500, lastVoiceAt: 600, hold: true }), null);
  assert.ok(HENRY_PTT_TAIL_MS >= 200 && HENRY_PTT_TAIL_MS <= 300);
  assert.equal(pushToTalkReleaseAction({ heldMs: 100 }), "tap");
  assert.equal(pushToTalkReleaseAction({ heldMs: 1500 }), "send");
});

test("microfone aquecido: app de desktop em qualquer modo de escuta; celular/navegador não", () => {
  assert.equal(shouldWarmMic({ active: true, muted: false, recordMode: true, desktopApp: true }), true);
  assert.equal(shouldWarmMic({ active: true, muted: true, recordMode: true, desktopApp: true }), false);
  assert.equal(shouldWarmMic({ active: false, recordMode: true, desktopApp: true }), false);
  assert.equal(shouldWarmMic({ active: true, recordMode: true, desktopApp: false }), false); // iOS: mic aberto muda o áudio
  assert.equal(shouldWarmMic({ active: true, recordMode: false, desktopApp: true }), false);
  assert.equal(isWarmStreamUsable([{ kind: "audio", readyState: "live" }]), true);
  assert.equal(isWarmStreamUsable([{ kind: "audio", readyState: "ended" }]), false);
});

test("transcrição ao vivo que perdeu o começo da frase não vale: usa a gravação", () => {
  assert.equal(liveStartedLate({ recorderStartedAt: 1000, firstAudioAt: 1050 }), false);
  assert.equal(liveStartedLate({ recorderStartedAt: 1000, firstAudioAt: 1000 + HENRY_LIVE_MAX_LATE_START_MS + 1 }), true);
  assert.equal(liveStartedLate({ recorderStartedAt: 1000, firstAudioAt: 0 }), true); // nunca chegou áudio
});

test("música: nível padrão 30% do volume do dono, nunca abaixo de 20%", () => {
  assert.equal(HENRY_MUSIC_DUCK_RATIO_DEFAULT, 0.3);
  assert.equal(clampMusicDuckRatio(undefined), 0.3);
  assert.equal(clampMusicDuckRatio(0.05), HENRY_MUSIC_DUCK_RATIO_MIN); // nunca mudo
  assert.equal(clampMusicDuckRatio(0.25), 0.25);
  assert.equal(clampMusicDuckRatio(5), 0.6);
  assert.equal(speechDuckLevel(60, 0.01), 12); // mesmo pedindo menos, 20% do volume dele
  assert.equal(speechDuckLevel(60), 18);
  assert.equal(speechDuckLevel(100), 30); // proporcional, não absoluto
});

test("música: descida suave (~250 ms) e subida em ~500 ms", async () => {
  const plan = spotifyFadePlan({ from: 80, to: 24 });
  assert.equal(plan.at(-1).volume, 24);
  assert.equal(plan.at(-1).atMs, HENRY_DUCK_FADE_MS);
  assert.equal(plan[0].atMs, 0);
  for (let i = 1; i < plan.length; i += 1) assert.ok(plan[i].volume < plan[i - 1].volume);
  assert.deepEqual(spotifyFadePlan({ from: 20, to: 40 }), []);
  assert.deepEqual(spotifyFadePlan({ from: 20, to: 20 }), []);
  assert.equal(HENRY_SPOTIFY_RAMP_MS, 500);
  const puts = [];
  const fetchImpl = async (url, init = {}) => {
    if (init.method === "PUT") puts.push(Number(new URL(url).searchParams.get("volume_percent")));
    if (String(url).endsWith("/v1/me/player")) return new Response(JSON.stringify({ is_playing: true, device: { volume_percent: 80 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(null, { status: 204 });
  };
  const result = await duckSpotifyVolume({ fetchImpl, tokens: { getAccessToken: async () => "t" }, ratio: 0.3, fadeMs: HENRY_DUCK_FADE_MS, sleep: async () => {} });
  assert.deepEqual(result, { ducked: true, previous: 80, level: 24 });
  assert.ok(puts.length >= 2 && puts.at(-1) === 24 && puts.every((v, i) => i === 0 || v < puts[i - 1]));
});

test("configuração: 'Volume da música enquanto o Henry fala' padrão 30%, validada e nunca abaixo de 20%", () => {
  assert.equal(resolveHenryStyle(undefined).musicDuck, "30");
  assert.equal(henryMusicDuckRatio(undefined), 0.3);
  assert.equal(henryMusicDuckRatio({ musicDuck: "50" }), 0.5);
  assert.equal(henryMusicDuckRatio({ musicDuck: "5" }), 0.3); // inválido volta ao padrão
  assert.ok(Object.values(HENRY_MUSIC_DUCKS).every((item) => item.ratio >= HENRY_MUSIC_DUCK_RATIO_MIN));
  assert.equal(parseHenryStylePatch({ musicDuck: "25" }).ok, true);
  assert.equal(parseHenryStylePatch({ musicDuck: "0" }).ok, false);
  assert.equal(mergeHenryStyle({}, { musicDuck: "40" }).musicDuck, "40");
});

test("tela e rota: mesma fração na escuta e na fala; aperto não espera nome nem calibração", () => {
  const ui = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/admin/henry/spotify/player/route.js", import.meta.url), "utf8");
  assert.match(ui, /ratio: musicDuckRatioRef\.current/);
  assert.match(ui, /shouldWarmMic\(/);
  assert.match(ui, /pttKeydownPhase\(/);
  assert.match(ui, /HENRY_PTT_TAIL_MS/);
  assert.match(ui, /liveStartedLate\(/);
  assert.match(route, /clampMusicDuckRatio\(body\?\.ratio\)/);
  assert.match(route, /fadeMs: HENRY_DUCK_FADE_MS/);
});
