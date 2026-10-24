// Bug do dono (2026-10-24): "Estou pedindo para ele aumentar o volume, ele fala que aumentou, mas na verdade não está
// aumentando. Toda vez que eu coloco uma música [...] ele vai para o volume mínimo, quase mudo." Regras puras do volume do
// Spotify do Henry (lib/henry-spotify-core.mjs) com fetch mockado — nada toca de verdade.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  describeSpotifyResult,
  duckSpotifyVolume,
  playOnSpotifyWhenReady,
  resolveDuckPrevious,
  runSpotifyCommand,
  setSpotifyVolume,
  spotifyRestoreStep,
  spotifyUserMemoryFor,
  spotifyVolumeOutcome,
  volumeStillHenrys,
  HENRY_SPOTIFY_USER_MEMORY_MS
} from "../lib/henry-spotify-core.mjs";

const reply = (status, body = null) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => (body === null ? "" : JSON.stringify(body)) });
const tokens = { getAccessToken: async () => "at" };
const sleep = async () => {};

// Player falso: guarda o volume; `lag` = quantas leituras ainda devolvem o volume antigo; `ignore` = não aplica o PUT.
function fakePlayer({ volume = 60, isPlaying = true, ignore = false, readable = true } = {}) {
  const state = { volume, puts: [], log: [] };
  const fetchImpl = async (url, options) => {
    const path = url.replace("https://api.spotify.com", "");
    state.log.push(`${options.method} ${path}`);
    if (options.method === "GET" && path === "/v1/me/player") return reply(200, { is_playing: isPlaying, device: { volume_percent: readable ? state.volume : null } });
    if (options.method === "PUT" && path.startsWith("/v1/me/player/volume")) {
      const value = Number(new URL(url).searchParams.get("volume_percent"));
      state.puts.push(value);
      if (!ignore) state.volume = value;
      return reply(204);
    }
    if (options.method === "GET" && path.startsWith("/v1/me/player/currently-playing")) return reply(200, { is_playing: true, item: { uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC", name: "Faixa" } });
    if (path.startsWith("/v1/me/player/devices")) return reply(200, { devices: [{ id: "pc", name: "PC" }] });
    return reply(204);
  };
  return { state, fetchImpl };
}

test("play não muda o volume (tocar e abrir-e-tocar)", async () => {
  const player = fakePlayer({ volume: 70 });
  const played = await runSpotifyCommand({ action: "tocar", uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC", type: "track", volume: 28 }, { fetchImpl: player.fetchImpl, tokens, sleep });
  assert.equal(played.ok, true);
  assert.deepEqual(player.state.puts, [], "nenhum PUT de volume no play");
  assert.equal(player.state.volume, 70);
  const opened = fakePlayer({ volume: 70 });
  const result = await playOnSpotifyWhenReady("spotify:track:4uLU6hMCjMI75M1A2tKUQC", { fetchImpl: opened.fetchImpl, tokens, sleep, volume: 28 });
  assert.equal(result.ok, true);
  assert.deepEqual(opened.state.puts, []);
  const voice = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  assert.doesNotMatch(voice, /MORNING_VOLUME/);
  const playRoute = readFileSync(new URL("../app/api/admin/henry/spotify/play/route.js", import.meta.url), "utf8");
  assert.match(playRoute, /playSpotifyAfterOpen\(body\.uri\)/);
});

test("abaixar sobre abaixado não encadeia (25% de 25%)", async () => {
  // Spotify parado no nível que o Henry pôs (15) e a tela lembra o volume do dono (60): o "antes" é 60.
  assert.equal(resolveDuckPrevious({ current: 15, userVolume: 60, lastLevel: 15 }), 60);
  assert.equal(resolveDuckPrevious({ current: 12, userVolume: 60, lastLevel: 15 }), 60, "arredondamento do aparelho");
  // Dono mexeu (40 ≠ 15): vale o atual.
  assert.equal(resolveDuckPrevious({ current: 40, userVolume: 60, lastLevel: 15 }), 40);
  // Sem memória: o atual.
  assert.equal(resolveDuckPrevious({ current: 60 }), 60);
  assert.equal(resolveDuckPrevious({ current: null }), null);

  const player = fakePlayer({ volume: 15 });
  const ducked = await duckSpotifyVolume({ fetchImpl: player.fetchImpl, tokens, ratio: 0.25, userVolume: 60, lastLevel: 15 });
  assert.deepEqual(ducked, { ducked: true, previous: 60, level: 15 });
  assert.equal(player.state.volume, 15, "nunca 4%");
  // Escuta (15%) depois da fala: mesmo "antes".
  const listen = await duckSpotifyVolume({ fetchImpl: player.fetchImpl, tokens, userVolume: 60, lastLevel: 15 });
  assert.equal(listen.previous, 60);
});

test("memória do volume do dono expira e pedido do dono substitui", () => {
  const now = 1_000_000;
  assert.deepEqual(spotifyUserMemoryFor({ volume: 60, lastLevel: 15, at: now - 1000 }, now), { volume: 60, lastLevel: 15 });
  assert.equal(spotifyUserMemoryFor({ volume: 60, lastLevel: 15, at: now - HENRY_SPOTIFY_USER_MEMORY_MS - 1 }, now), null);
  assert.deepEqual(spotifyUserMemoryFor({ volume: 75, lastLevel: null, at: now }, now), { volume: 75, lastLevel: null });
  assert.equal(spotifyUserMemoryFor(null, now), null);
});

test("subida: ajuste manual vence, atraso do Spotify não para a subida, falha tenta de novo", async () => {
  // Dono pôs 40 no meio da subida (Henry esperava 15–24): não sobrescreve.
  const manual = fakePlayer({ volume: 40 });
  assert.deepEqual(await setSpotifyVolume(33, { fetchImpl: manual.fetchImpl, tokens, expect: 24, expectFrom: 15 }), { ok: false, skipped: "manual" });
  assert.deepEqual(manual.state.puts, []);
  // Spotify ainda mostrando o passo anterior (15) quando o Henry espera 24: ainda é do Henry → aplica.
  const lagging = fakePlayer({ volume: 15 });
  assert.deepEqual(await setSpotifyVolume(33, { fetchImpl: lagging.fetchImpl, tokens, expect: 24, expectFrom: 15 }), { ok: true });
  assert.equal(volumeStillHenrys(15, 24), false, "sem expectFrom seria tido como manual (bug)");
  assert.equal(volumeStillHenrys(15, 24, 7, 15), true);
  assert.equal(volumeStillHenrys(null, 15), false);
  // Falha ao ler o player não é "manual".
  const failing = await setSpotifyVolume(33, { fetchImpl: async () => reply(502), tokens, expect: 24 });
  assert.equal(failing.skipped, undefined);
  assert.equal(spotifyRestoreStep(failing), "retry");
  assert.equal(spotifyRestoreStep(failing, { retried: true }), "keep");
  assert.equal(spotifyRestoreStep({ ok: false, skipped: "manual" }), "manual");
  assert.equal(spotifyRestoreStep({ ok: true }), "next");
});

test("aumenta o volume: parte do volume do dono (não do abaixado) e só confirma se aplicou", async () => {
  // Música abaixada a 15 para ele escutar; volume do dono = 60 → "aumenta" vai a 75, não a 30.
  const player = fakePlayer({ volume: 15 });
  const up = await runSpotifyCommand({ action: "volume", step: 15 }, { fetchImpl: player.fetchImpl, tokens, sleep, baseVolume: 60 });
  assert.deepEqual({ ok: up.ok, volume: up.volume, confirmed: up.confirmed }, { ok: true, volume: 75, confirmed: true });
  assert.equal(player.state.volume, 75);
  assert.match(describeSpotifyResult({ action: "volume", step: 15 }, up), /75%/);
  // Sem base: o atual do player (comportamento de antes).
  const plain = fakePlayer({ volume: 40 });
  assert.equal((await runSpotifyCommand({ action: "volume", step: -15 }, { fetchImpl: plain.fetchImpl, tokens, sleep })).volume, 25);
  // Spotify aceita o PUT mas não aplica: tenta mais uma vez e diz que NÃO mudou.
  const stuck = fakePlayer({ volume: 30, ignore: true });
  const failed = await runSpotifyCommand({ action: "volume", volume: 80 }, { fetchImpl: stuck.fetchImpl, tokens, sleep });
  assert.deepEqual({ ok: failed.ok, reason: failed.reason, actual: failed.actual }, { ok: false, reason: "volume_not_applied", actual: 30 });
  assert.equal(stuck.state.puts.length, 2, "uma nova tentativa");
  const text = describeSpotifyResult({ action: "volume", volume: 80 }, failed);
  assert.match(text, /NÃO mudou/);
  assert.match(text, /nunca diga que aumentou/);
  // Aparelho que não informa o volume: aplicado sem confirmação (não afirma o nível).
  const blind = fakePlayer({ volume: 30, readable: false });
  const unconfirmed = await runSpotifyCommand({ action: "volume", volume: 50 }, { fetchImpl: blind.fetchImpl, tokens, sleep });
  assert.equal(unconfirmed.confirmed, false);
  assert.match(describeSpotifyResult({ action: "volume", volume: 50 }, unconfirmed), /não diga que já está/);
  assert.deepEqual(spotifyVolumeOutcome(75, 75), { ok: true, confirmed: true });
  assert.deepEqual(spotifyVolumeOutcome(75, 12), { ok: false, reason: "volume_not_applied" });
});

test("ligações: pedido de volume aplicado vence a volta e vira o volume do dono", () => {
  const voice = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  assert.match(voice, /runHenrySpotifyTool\(input \|\| \{\}, \{ baseVolume: context\.spotifyVolume \}\)/);
  assert.match(voice, /context\.spotifyVolumeSet = result\.result\.volume/);
  const route = readFileSync(new URL("../app/api/admin/henry/route.js", import.meta.url), "utf8");
  assert.equal((route.match(/spotifyVolumeSet: answer\.spotifyVolumeSet/g) || []).length, 2, "stream e JSON");
  const ui = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(ui, /if \(Number\.isInteger\(spotifyVolumeSet\)\) \{\n\s+spotifyRampRef\.current \+= 1;/);
  assert.match(ui, /rememberSpotifyUser\(spotifyVolumeSet\)/);
  assert.match(ui, /spotifyRestoreStep\(/);
  assert.match(ui, /\.\.\.spotifyUserFields\(\)/);
  // Volume não usa mais `keep` (que deixava a música no nível abaixado quando o pedido falhava).
  assert.doesNotMatch(ui, /musicIntent && \/\\b\(volume\|som\|aumenta\|abaixa\|baixa\)\\b\/i\.test\(question\)\)\)\) spotifyDuckRef\.current\.keep = true/);
});
