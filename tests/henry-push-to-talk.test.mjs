// Aperte para falar, Mudo e música abaixando quando o Henry fala (REGRA OFICIAL — dono, 2026-10-24; HENRY-1).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_PTT_TAP_MS,
  HENRY_VOICE_MUTE_KEY,
  RECORD_MAX_MS,
  henrySpeechSilenced,
  henryVoicePlayable,
  isPushToTalkRelease,
  pushToTalkKeyAction,
  pushToTalkReleaseAction,
  pushToTalkTargetKind,
  readHenryVoiceMuted,
  recordingDecision
} from "../lib/henry-voice-conversation.mjs";
import {
  HENRY_SPEECH_DUCK_RATIO,
  duckSpotifyVolume,
  setSpotifyVolume,
  speechDuckAction,
  speechDuckLevel,
  spotifyRampPlan,
  volumeStillHenrys
} from "../lib/henry-spotify-core.mjs";

// Elemento de mentira: tagName, atributos e o pai.
function el(tagName, { attrs = {}, parent = null, type, editable = false } = {}) {
  return { tagName: tagName.toUpperCase(), type, isContentEditable: editable, parentElement: parent, getAttribute: (name) => (name in attrs ? attrs[name] : null) };
}
const body = el("body");
const enter = (target, extra = {}) => pushToTalkKeyAction({ key: "Enter", code: "Enter", target, henryActive: true, ...extra });

test("Enter: dispara fora de campos; nunca em input/textarea/contenteditable/select nem em botão do CRM", () => {
  assert.equal(enter(body), "enter");
  assert.equal(enter(el("div", { parent: body })), "enter");
  assert.equal(enter(el("input", { parent: body, type: "text" })), null);
  assert.equal(enter(el("input", { parent: body, type: "password" })), null);
  assert.equal(enter(el("input", { parent: body })), null); // sem type = texto
  assert.equal(enter(el("textarea", { parent: body })), null);
  assert.equal(enter(el("select", { parent: body })), null);
  assert.equal(enter(el("div", { parent: body, editable: true })), null);
  assert.equal(enter(el("span", { parent: el("div", { attrs: { contenteditable: "true" }, parent: body }) })), null);
  assert.equal(enter(el("div", { parent: body, attrs: { role: "textbox" } })), null);
  // Botão/link/checkbox do CRM: o Enter é dele (nunca roubar de formulário).
  assert.equal(enter(el("button", { parent: el("form", { parent: body }) })), null);
  assert.equal(enter(el("a", { parent: body })), null);
  assert.equal(enter(el("input", { parent: body, type: "checkbox" })), null);
  assert.equal(enter(el("div", { parent: body, attrs: { role: "button" } })), null);
  // Botão DENTRO do Henry conta como livre; campo de texto dentro dele, nunca.
  const henry = el("div", { parent: body, attrs: { "data-henry-assistant": "" } });
  assert.equal(enter(el("button", { parent: henry })), "enter");
  assert.equal(enter(el("input", { parent: henry, type: "text" })), null);
  assert.equal(pushToTalkTargetKind(el("svg", { parent: el("button", { parent: henry }) })), "free");
});

test("Enter com a tela cheia aberta: vale até com botão/link do CRM focado por trás; campo de texto continua de fora", () => {
  assert.equal(enter(el("button", { parent: el("form", { parent: body }) }), { expanded: true }), "enter");
  assert.equal(enter(el("a", { parent: body }), { expanded: true }), "enter");
  assert.equal(enter(body, { expanded: true }), "enter");
  assert.equal(enter(el("input", { parent: body, type: "text" }), { expanded: true }), null);
  assert.equal(enter(el("textarea", { parent: body }), { expanded: true }), null);
  assert.equal(enter(body, { expanded: true, locked: true }), null);
});

test("Enter: só com o Henry ativo, sem modificador, fora de composição e fora da tela de bloqueio", () => {
  assert.equal(enter(body, { henryActive: false }), null);
  assert.equal(enter(body, { locked: true }), null);
  assert.equal(enter(body, { shiftKey: true }), null);
  assert.equal(enter(body, { ctrlKey: true }), null);
  assert.equal(enter(body, { isComposing: true }), null);
});

test("Ctrl+Shift+H: dispara segurando, em qualquer lugar (não é digitação); solta com Ctrl, Shift ou H", () => {
  const input = el("input", { parent: body, type: "text" });
  assert.equal(pushToTalkKeyAction({ key: "H", code: "KeyH", ctrlKey: true, shiftKey: true, target: input, henryActive: true }), "shortcut");
  assert.equal(pushToTalkKeyAction({ key: "H", code: "KeyH", metaKey: true, shiftKey: true, target: body, henryActive: true }), "shortcut");
  assert.equal(pushToTalkKeyAction({ key: "h", code: "KeyH", ctrlKey: true, target: body, henryActive: true }), null); // sem Shift
  assert.equal(pushToTalkKeyAction({ key: "H", code: "KeyH", ctrlKey: true, shiftKey: true, altKey: true, target: body, henryActive: true }), null);
  assert.equal(pushToTalkKeyAction({ key: "H", code: "KeyH", ctrlKey: true, shiftKey: true, target: body, henryActive: true, locked: true }), null);
  for (const key of ["Control", "Shift", "h", "H"]) assert.equal(isPushToTalkRelease("shortcut", { key }), true, key);
  assert.equal(isPushToTalkRelease("shortcut", { key: "a" }), false);
  assert.equal(isPushToTalkRelease("enter", { key: "Enter" }), true);
  assert.equal(isPushToTalkRelease("enter", { key: "Shift" }), false);
});

test("soltar antes de 300 ms = clique normal; depois = envia", () => {
  assert.equal(HENRY_PTT_TAP_MS, 300);
  assert.equal(pushToTalkReleaseAction({ heldMs: 0 }), "tap");
  assert.equal(pushToTalkReleaseAction({ heldMs: 299 }), "tap");
  assert.equal(pushToTalkReleaseAction({ heldMs: 300 }), "send");
  assert.equal(pushToTalkReleaseAction({ heldMs: 4000 }), "send");
});

test("apertado: a gravação não corta por silêncio (só o limite de 25 s)", () => {
  const base = { startedAt: 0, firstVoiceAt: 500, lastVoiceAt: 1000, heardVoice: true, hasMeter: true };
  assert.equal(recordingDecision({ ...base, now: 9000 }), "send"); // sem segurar: silêncio fecha
  assert.equal(recordingDecision({ ...base, now: 9000, hold: true }), null);
  assert.equal(recordingDecision({ ...base, heardVoice: false, firstVoiceAt: 0, lastVoiceAt: 0, now: 9000, hold: true }), null); // nem "nada ouvido"
  assert.equal(recordingDecision({ ...base, now: RECORD_MAX_MS, hold: true }), "send");
});

test("mudo bloqueia toda fala; chamados/avisos esperam com mudo ou microfone desligado", () => {
  assert.equal(henryVoicePlayable({ voiceMuted: true }), false);
  assert.equal(henryVoicePlayable({ voiceMuted: false }), true);
  assert.equal(henrySpeechSilenced({ voiceMuted: true }), true);
  assert.equal(henrySpeechSilenced({ micMuted: true }), true);
  assert.equal(henrySpeechSilenced({}), false);
  const store = new Map([[HENRY_VOICE_MUTE_KEY, "1"]]);
  assert.equal(readHenryVoiceMuted({ getItem: (key) => store.get(key) ?? null }), true);
  assert.equal(readHenryVoiceMuted({ getItem: () => "0" }), false);
  assert.equal(readHenryVoiceMuted({ getItem: () => { throw new Error("bloqueado"); } }), false);
});

test("música: fala do Henry abaixa para 25% do volume atual, num passo só", async () => {
  assert.equal(HENRY_SPEECH_DUCK_RATIO, 0.25);
  assert.equal(speechDuckLevel(80), 20);
  assert.equal(speechDuckLevel(50), 13);
  assert.equal(speechDuckLevel(2), 1);
  assert.equal(speechDuckAction({ musicPlaying: true }), "duck");
  assert.equal(speechDuckAction({ musicPlaying: false }), "none");
  assert.equal(speechDuckAction({ musicPlaying: true, ducked: true }), "keep"); // já baixa pela escuta: um abaixar só
  assert.equal(speechDuckAction({ musicPlaying: true, pending: true }), "keep");
  assert.equal(speechDuckAction({ musicPlaying: true, ducked: true, ramping: true }), "back"); // subindo: volta a baixar
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(`${init.method || "GET"} ${url}`);
    if (String(url).endsWith("/v1/me/player")) return new Response(JSON.stringify({ is_playing: true, device: { volume_percent: 80 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(null, { status: 204 });
  };
  const tokens = { getAccessToken: async () => "t" };
  const ducked = await duckSpotifyVolume({ fetchImpl, tokens, ratio: HENRY_SPEECH_DUCK_RATIO });
  assert.deepEqual(ducked, { ducked: true, previous: 80, level: 20 });
  assert.equal(calls.filter((call) => call.startsWith("PUT")).length, 1);
  assert.ok(calls.some((call) => call.includes("volume_percent=20")));
});

test("música: subida gradual em passos crescentes até o volume de antes (~2,5 s)", () => {
  const plan = spotifyRampPlan({ from: 20, to: 80 });
  assert.equal(plan.length, 5);
  assert.deepEqual(plan.map((step) => step.volume), [32, 44, 56, 68, 80]);
  assert.equal(plan[0].atMs, 0);
  assert.equal(plan[plan.length - 1].atMs, 2500);
  for (let index = 1; index < plan.length; index += 1) assert.ok(plan[index].volume > plan[index - 1].volume && plan[index].atMs > plan[index - 1].atMs);
  assert.deepEqual(spotifyRampPlan({ from: 20, to: 22 }).map((step) => step.volume), [21, 22]); // sem passos repetidos
  assert.deepEqual(spotifyRampPlan({ from: 50, to: 50 }), []);
  assert.deepEqual(spotifyRampPlan({ from: 60, to: 40 }), []);
});

test("música: ajuste manual do dono no meio nunca é sobrescrito", async () => {
  assert.equal(volumeStillHenrys(20, 20), true);
  assert.equal(volumeStillHenrys(25, 20), true); // aparelho arredondou
  assert.equal(volumeStillHenrys(50, 20), false); // o dono aumentou
  assert.equal(volumeStillHenrys(undefined, 20), false);
  let volume = 50; // o dono subiu para 50 enquanto o Henry esperava 20
  const puts = [];
  const fetchImpl = async (url, init = {}) => {
    if ((init.method || "GET") === "PUT") {
      puts.push(String(url));
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({ is_playing: true, device: { volume_percent: volume } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const tokens = { getAccessToken: async () => "t" };
  assert.deepEqual(await setSpotifyVolume(32, { fetchImpl, tokens, expect: 20 }), { ok: false, skipped: "manual" });
  assert.equal(puts.length, 0);
  volume = 20;
  assert.deepEqual(await setSpotifyVolume(32, { fetchImpl, tokens, expect: 20 }), { ok: true });
  assert.equal(puts.length, 1);
});

test("ligações: tela usa as regras únicas (teclas, mudo, abaixar na fala, subida gradual)", () => {
  const ui = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(ui, /pushToTalkKeyAction\(/);
  assert.match(ui, /pushToTalkReleaseAction\(/);
  assert.match(ui, /henryVoicePlayable\(\{ voiceMuted: voiceMutedRef\.current \}\)/);
  assert.match(ui, /duckForSpeechRef\.current\(\)/);
  assert.match(ui, /spotifyRampPlan\(/);
  assert.match(ui, /hold: session\.hold === true/);
  const view = readFileSync(new URL("../components/henry/HenryVoiceView.jsx", import.meta.url), "utf8");
  assert.match(view, /Ouvindo… solte para enviar/);
  assert.match(view, /onToggleVoiceMute/);
  const route = readFileSync(new URL("../app/api/admin/henry/spotify/player/route.js", import.meta.url), "utf8");
  assert.match(route, /restoreHenrySpotify\(body\.volume, \{ expect \}\)/);
});
