import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchSpotifyDevice,
  normalizeSpotifyDeviceRequest,
  spotifyDeviceKindFromText,
  spotifyDeviceKindOf,
  spotifyDeviceLine,
  transferSpotifyPlayback
} from "../lib/henry-spotify-core.mjs";
import { henryDeviceResult, henryInitialProgress, henryMusicIntent, henryProgressFor, isMusicRequest, mergeHenryMusic, normalizeHenryMusic, pickHenryAnswerScene, spotifyDeviceRequestKind } from "../lib/henry-voice-narration.mjs";

// Trocar o aparelho do Spotify (dono, 2026-10-23: "Henry consegue alterar do computador para o Spotify tocar na Alexa?").
const reply = (status, body = null) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => (body === null ? "" : JSON.stringify(body)) });
const tokens = { getAccessToken: async () => "tk" };
const PC = { id: "pc1", name: "DESKTOP-MATHEUS", type: "Computer", is_active: true, volume_percent: 15 };
const ECHO = { id: "echo1", name: "Echo Dot de Matheus", type: "Speaker", is_active: false };
const ECHO_QUARTO = { id: "echo2", name: "Echo do Quarto", type: "Speaker", is_active: false };
const SALA = { id: "jbl1", name: "Caixa da Sala", type: "Speaker", is_active: false };
const IPHONE = { id: "ip1", name: "iPhone de Matheus", type: "Smartphone", is_active: false };
const pick = (devices, aparelho) => matchSpotifyDevice(devices, normalizeSpotifyDeviceRequest({ aparelho }));

test("tipo do aparelho: pela fala e pelo que o Spotify devolve", () => {
  assert.equal(spotifyDeviceKindFromText("Alexa"), "alexa");
  assert.equal(spotifyDeviceKindFromText("o Echo"), "alexa");
  assert.equal(spotifyDeviceKindFromText("computador"), "computador");
  assert.equal(spotifyDeviceKindFromText("PC"), "computador");
  assert.equal(spotifyDeviceKindFromText("celular"), "celular");
  assert.equal(spotifyDeviceKindFromText("caixa da sala"), "caixa");
  assert.equal(spotifyDeviceKindFromText("Sala"), "");
  assert.equal(spotifyDeviceKindOf(ECHO), "alexa"); // Speaker com "Echo" no nome
  assert.equal(spotifyDeviceKindOf(SALA), "caixa");
  assert.equal(spotifyDeviceKindOf(PC), "computador");
  assert.equal(spotifyDeviceKindOf(IPHONE), "celular");
});

test("casa o aparelho por nome e tipo", () => {
  const all = [PC, ECHO, SALA, IPHONE];
  assert.equal(pick(all, "Alexa").device.id, "echo1");
  assert.equal(pick(all, "Echo").device.id, "echo1");
  assert.equal(pick(all, "celular").device.id, "ip1");
  assert.equal(pick(all, "caixa da sala").device.id, "jbl1");
  assert.equal(pick(all, "sala").device.id, "jbl1");
  assert.equal(pick(all, "Alexa do Matheus").device.id, "echo1");
  assert.deepEqual(pick(all, "computador"), { kind: "already", device: PC }); // já está tocando nele
  assert.equal(pick([{ ...PC, is_active: false }, ECHO], "computador").kind, "transfer");
  // Aparelho restrito ou sem id nunca entra.
  assert.equal(pick([{ ...ECHO, is_restricted: true }], "Alexa").kind, "missing");
  // Nome falado que não casa com nenhum do tipo "caixa": não chuta outra caixa.
  assert.equal(pick([PC, SALA], "caixa do quarto").kind, "missing");
  assert.equal(normalizeSpotifyDeviceRequest({}).error, "aparelho_invalido");
});

test("mais de um parecido: pergunta qual; o nome escolhido resolve", () => {
  const all = [PC, ECHO, ECHO_QUARTO];
  const ask = pick(all, "Alexa");
  assert.equal(ask.kind, "ask");
  assert.deepEqual(ask.options, ["Echo Dot de Matheus", "Echo do Quarto"]);
  assert.equal(spotifyDeviceLine({ ok: false, reason: "ask", options: ask.options }), "Achei dois: Echo Dot de Matheus ou Echo do Quarto. Qual?");
  assert.ok(spotifyDeviceLine({ ok: false, reason: "ask", options: ask.options }).endsWith("?")); // abre a pergunta pendente da tela
  assert.equal(pick(all, "quarto").device.id, "echo2");
  assert.equal(pick(all, "Echo do quarto").device.id, "echo2");
  assert.equal(pick(all, "Echo Dot").kind, "ask"); // "dot" é genérico
});

test("Alexa fora da lista: frase curta pedindo um 'Alexa, toca Spotify'", async () => {
  const fetchImpl = async () => reply(200, { devices: [PC, IPHONE] });
  const result = await transferSpotifyPlayback(normalizeSpotifyDeviceRequest({ aparelho: "Alexa" }), { fetchImpl, tokens });
  assert.deepEqual(result, { ok: false, reason: "no_device", requested: "alexa" });
  assert.equal(spotifyDeviceLine(result), "Não achei a Alexa no Spotify agora. Fala 'Alexa, toca Spotify' uma vez que ela aparece pra mim.");
  assert.equal(henryDeviceResult(result).music.stage, "error");
  assert.equal(henryDeviceResult(result).music.device, "alexa");
});

test("transfere com PUT /v1/me/player { device_ids, play: true } e devolve o volume no aparelho de origem", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options.method, body: options.body ? JSON.parse(options.body) : null });
    if (String(url).endsWith("/v1/me/player/devices")) return reply(200, { devices: [PC, ECHO] });
    return reply(204);
  };
  const result = await transferSpotifyPlayback(normalizeSpotifyDeviceRequest({ aparelho: "Alexa" }), { fetchImpl, tokens, restoreVolume: 60 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.device, { name: "Echo Dot de Matheus", kind: "alexa" });
  const volume = calls.find((call) => call.url.includes("/v1/me/player/volume"));
  assert.ok(volume.url.includes("volume_percent=60") && volume.url.includes("device_id=pc1"));
  const transfer = calls.find((call) => call.method === "PUT" && call.url.endsWith("/v1/me/player"));
  assert.deepEqual(transfer.body, { device_ids: ["echo1"], play: true });
  assert.ok(calls.indexOf(volume) < calls.indexOf(transfer)); // volume volta ANTES de trocar
  assert.equal(spotifyDeviceLine(result), "Pronto, passei pra Alexa.");
  assert.equal(spotifyDeviceLine({ ok: true, device: { name: "DESKTOP", kind: "computador" } }), "Voltou pro computador.");
  assert.equal(spotifyDeviceLine({ ok: true, device: { name: "Caixa da Sala", kind: "caixa" } }), "Pronto, passei pra Caixa da Sala.");
  // Sem volume guardado: não mexe no volume.
  calls.length = 0;
  await transferSpotifyPlayback(normalizeSpotifyDeviceRequest({ aparelho: "Alexa" }), { fetchImpl, tokens });
  assert.equal(calls.some((call) => call.url.includes("/volume")), false);
  // Premium recusado.
  const premium = await transferSpotifyPlayback(normalizeSpotifyDeviceRequest({ aparelho: "Alexa" }), {
    tokens,
    fetchImpl: async (url) => (String(url).endsWith("/devices") ? reply(200, { devices: [PC, ECHO] }) : reply(403, { error: { reason: "PREMIUM_REQUIRED" } }))
  });
  assert.equal(premium.reason, "premium");
});

test("intenção de música cedo (sem IA) inclui a troca de aparelho", () => {
  for (const text of ["toca na Alexa", "Henry, passa pra Alexa", "joga pro Echo", "volta pro computador", "toca no celular", "toca na caixa da sala", "passa a música pro celular", "muda o som pra Alexa"]) {
    assert.equal(isMusicRequest(text), true, text);
    assert.equal(henryMusicIntent({ question: text }), true, text);
    assert.ok(spotifyDeviceRequestKind(text), text);
  }
  assert.equal(spotifyDeviceRequestKind("volta pro computador"), "computador");
  assert.equal(spotifyDeviceRequestKind("toca na caixa da sala"), "caixa");
  for (const text of ["manda o relatório pro celular", "volta pra tela de clientes", "quantos leads hoje?", "toca Legião Urbana"]) assert.equal(spotifyDeviceRequestKind(text), "", text);
  assert.equal(isMusicRequest("manda o relatório pro celular"), false);
  const first = henryInitialProgress("question", { question: "passa pra Alexa" });
  assert.equal(first.topic, "music");
  assert.deepEqual(first.music, { stage: "device", device: "alexa" });
});

test("cena e narração da troca", () => {
  assert.equal(henryProgressFor("mudar_aparelho_spotify", { aparelho: "Alexa" }).topic, "music");
  assert.equal(pickHenryAnswerScene({ tools: [{ name: "mudar_aparelho_spotify", input: {} }] }), "musica");
  assert.equal(pickHenryAnswerScene({ tools: [{ name: "spotify", input: {} }, { name: "mudar_aparelho_spotify", input: {} }] }), "musica");
  const moved = henryDeviceResult({ ok: true, device: { name: "Echo Dot de Matheus", kind: "alexa" } });
  assert.deepEqual(normalizeHenryMusic(moved.music), { stage: "device", device: "alexa", deviceName: "Echo Dot de Matheus", moved: true });
  assert.equal(normalizeHenryMusic({ stage: "device", device: "<script>" }).device, undefined);
  const merged = mergeHenryMusic({ stage: "device", device: "alexa", moved: true }, { stage: "search", query: "rock" });
  assert.equal(merged.moved, undefined);
});
