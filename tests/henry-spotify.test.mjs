import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SPOTIFY_SCOPES,
  buildSpotifyAuthorizeUrl,
  createSpotifyTokenManager,
  describeSpotifyOpenResult,
  describeSpotifyResult,
  isSpotifyOpenUrl,
  isSpotifyUri,
  playOnSpotifyWhenReady,
  spotifyPlayBody,
  isValidSpotifyState,
  normalizeSpotifyCommand,
  runSpotifyCommand,
  spotifySearchUrl,
  spotifyTokenNeedsRefresh
} from "../lib/henry-spotify-core.mjs";
import { henryProgressFor, pickHenryAnswerScene } from "../lib/henry-voice-narration.mjs";

// Resposta falsa no formato do fetch.
const reply = (status, body = null) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => (body === null ? "" : JSON.stringify(body)) });

test("intenção: comando da ferramenta vira ação validada", () => {
  assert.deepEqual(normalizeSpotifyCommand({ acao: "tocar", busca: "  Legião   Urbana ", tipo: "artista" }), { action: "tocar", query: "Legião Urbana", type: "artist" });
  assert.deepEqual(normalizeSpotifyCommand({ acao: "tocar", busca: "Tempo Perdido" }), { action: "tocar", query: "Tempo Perdido", type: "track" });
  assert.deepEqual(normalizeSpotifyCommand({ acao: "tocar" }), { action: "continuar" }); // "toca" sem nada = continuar
  assert.deepEqual(normalizeSpotifyCommand({ acao: "volume", volume: 140 }), { action: "volume", volume: 100 });
  assert.deepEqual(normalizeSpotifyCommand({ acao: "volume", volume: 0 }), { action: "volume", volume: 0 });
  assert.deepEqual(normalizeSpotifyCommand({ acao: "volume", ajuste: "mais_alto" }), { action: "volume", step: 15 });
  assert.deepEqual(normalizeSpotifyCommand({ acao: "volume", ajuste: "mais_baixo" }), { action: "volume", step: -15 });
  assert.deepEqual(normalizeSpotifyCommand({ acao: "volume" }), { error: "volume_invalido" });
  for (const acao of ["pausar", "continuar", "proxima", "anterior", "tocando"]) assert.deepEqual(normalizeSpotifyCommand({ acao }), { action: acao });
  assert.deepEqual(normalizeSpotifyCommand({ acao: "apagar_playlist" }), { error: "acao_invalida" });
  assert.equal(normalizeSpotifyCommand({ acao: "tocar", busca: "x".repeat(300) }).query.length, 100);
});

test("autorização: escopos pedidos, state anti-CSRF e só a busca do Spotify Web no fallback", () => {
  assert.deepEqual([...SPOTIFY_SCOPES], ["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing"]);
  const url = new URL(buildSpotifyAuthorizeUrl({ clientId: "abc", redirectUri: "https://www.matheusmachadoimoveis.com.br/api/admin/henry/spotify/callback", state: "s".repeat(48) }));
  assert.equal(url.origin + url.pathname, "https://accounts.spotify.com/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), SPOTIFY_SCOPES.join(" "));
  assert.equal(url.searchParams.get("redirect_uri"), "https://www.matheusmachadoimoveis.com.br/api/admin/henry/spotify/callback");
  assert.ok(isValidSpotifyState("a".repeat(48), "a".repeat(48)));
  assert.ok(!isValidSpotifyState("a".repeat(48), "b".repeat(48)));
  assert.ok(!isValidSpotifyState("a".repeat(48), ""));
  assert.ok(!isValidSpotifyState("", ""));
  assert.equal(spotifySearchUrl("Legião Urbana"), "https://open.spotify.com/search/Legi%C3%A3o%20Urbana");
  assert.ok(isSpotifyOpenUrl(spotifySearchUrl("Legião Urbana")));
  assert.ok(!isSpotifyOpenUrl("https://evil.com/search/x"));
  assert.ok(!isSpotifyOpenUrl("javascript:alert(1)"));
});

test("token: usa o guardado enquanto vale e renova sozinho (fetch mockado)", async () => {
  let clock = 1_000_000;
  const calls = [];
  let saved = "";
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: String(options.body), auth: options.headers.Authorization });
    return reply(200, { access_token: `at-${calls.length}`, expires_in: 3600, ...(calls.length === 2 ? { refresh_token: "rt-novo" } : {}) });
  };
  const manager = createSpotifyTokenManager({ fetchImpl, clientId: "id", clientSecret: "segredo", readRefreshToken: async () => "rt-velho", saveRefreshToken: async (token) => { saved = token; }, now: () => clock });
  assert.equal(await manager.getAccessToken(), "at-1");
  assert.equal(calls[0].url, "https://accounts.spotify.com/api/token");
  assert.match(calls[0].body, /grant_type=refresh_token/);
  assert.match(calls[0].body, /refresh_token=rt-velho/);
  assert.equal(calls[0].auth, `Basic ${Buffer.from("id:segredo").toString("base64")}`);
  clock += 30 * 60 * 1000;
  assert.equal(await manager.getAccessToken(), "at-1"); // ainda vale: sem nova chamada
  assert.equal(calls.length, 1);
  clock += 30 * 60 * 1000; // passou de 59 min: renova (margem de 1 min)
  assert.equal(await manager.getAccessToken(), "at-2");
  assert.equal(saved, "rt-novo"); // Spotify mandou refresh token novo → grava
  assert.equal(await manager.getAccessToken({ force: true }), "at-3");
  assert.ok(spotifyTokenNeedsRefresh(null));
  assert.ok(!spotifyTokenNeedsRefresh({ accessToken: "x", expiresAt: 10 * 60 * 1000 }, 0));
});

test("token: acesso revogado vira 'spotify_revoked'; sem refresh token, não conectado", async () => {
  const revoked = createSpotifyTokenManager({ fetchImpl: async () => reply(400, { error: "invalid_grant" }), clientId: "i", clientSecret: "s", readRefreshToken: async () => "rt" });
  await assert.rejects(revoked.getAccessToken(), /spotify_revoked/);
  const empty = createSpotifyTokenManager({ fetchImpl: async () => reply(200, {}), clientId: "i", clientSecret: "s", readRefreshToken: async () => "" });
  await assert.rejects(empty.getAccessToken(), /spotify_not_connected/);
});

test("player: tocar busca e toca; sem aparelho ativo usa o 1º de /devices; nenhum → open_spotify com a URI", async () => {
  const tokens = { getAccessToken: async () => "at" };
  const log = [];
  const withDevices = (devices) => async (url, options) => {
    log.push(`${options.method} ${url.replace("https://api.spotify.com", "")}${options.body ? ` ${options.body}` : ""}`);
    if (url.includes("/v1/search")) return reply(200, { tracks: { items: [{ uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC", name: "Tempo Perdido", artists: [{ name: "Legião Urbana" }] }] } });
    if (url.includes("/v1/me/player/devices")) return reply(200, { devices });
    if (url.includes("/v1/me/player/play") && !url.includes("device_id")) return reply(404, { error: { status: 404, reason: "NO_ACTIVE_DEVICE" } });
    return reply(204);
  };
  const command = normalizeSpotifyCommand({ acao: "tocar", busca: "Tempo Perdido" });
  const ok = await runSpotifyCommand(command, { fetchImpl: withDevices([{ id: "pc", name: "PC" }]), tokens });
  assert.equal(ok.ok, true);
  assert.equal(ok.playing.name, "Tempo Perdido");
  assert.ok(log.some((line) => line.startsWith("PUT /v1/me/player/play?device_id=pc") && line.includes("spotify:track:4uLU6hMCjMI75M1A2tKUQC")));
  const none = await runSpotifyCommand(command, { fetchImpl: withDevices([]), tokens });
  assert.deepEqual({ ok: none.ok, reason: none.reason, uri: none.uri }, { ok: false, reason: "no_device", uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC" });
  assert.match(describeSpotifyResult(command, none), /Abrindo o Spotify/);
  // Pausar/próxima/volume sem aparelho continuam pedindo para abrir (sem URI).
  assert.match(describeSpotifyResult({ action: "pausar" }, { ok: false, reason: "no_device" }), /abrir o Spotify/);
  const pause = await runSpotifyCommand({ action: "pausar" }, { fetchImpl: async () => reply(204), tokens });
  assert.equal(pause.ok, true);
});

test("player: 401 renova o token uma vez; volume relativo parte do atual; o que está tocando", async () => {
  let forced = 0;
  const tokens = { getAccessToken: async ({ force } = {}) => (force ? (forced += 1, "novo") : "velho") };
  let first = true;
  const paused = await runSpotifyCommand({ action: "pausar" }, {
    tokens,
    fetchImpl: async (url, options) => {
      if (first) { first = false; return reply(401, { error: { status: 401 } }); }
      assert.equal(options.headers.Authorization, "Bearer novo");
      return reply(204);
    }
  });
  assert.equal(paused.ok, true);
  assert.equal(forced, 1);
  const volume = await runSpotifyCommand({ action: "volume", step: 15 }, {
    tokens,
    fetchImpl: async (url) => (url.endsWith("/v1/me/player") ? reply(200, { device: { volume_percent: 90 } }) : reply(204))
  });
  assert.equal(volume.volume, 100);
  const playing = await runSpotifyCommand({ action: "tocando" }, { tokens, fetchImpl: async () => reply(200, { is_playing: true, item: { name: "Índios", artists: [{ name: "Legião Urbana" }] } }) });
  assert.deepEqual(playing.playing, { name: "Índios", artists: "Legião Urbana", isPlaying: true });
  const nothing = await runSpotifyCommand({ action: "tocando" }, { tokens, fetchImpl: async () => reply(204) });
  assert.equal(describeSpotifyResult({ action: "tocando" }, nothing), "Nada tocando agora no Spotify.");
});

test("Spotify no Henry: ferramenta, guard do dono, refresh token só no servidor, cena e narração", () => {
  const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  assert.match(lib, /name: "spotify"/);
  assert.match(lib, /runHenrySpotifyTool/);
  const server = readFileSync(new URL("../lib/henry-spotify.js", import.meta.url), "utf8");
  assert.match(server, /assertOwnerAdmin\(auth\)/);
  assert.match(server, /accountSwitchMode/);
  assert.match(server, /encryptSecret/);
  for (const route of ["connect", "callback"]) {
    const source = readFileSync(new URL(`../app/api/admin/henry/spotify/${route}/route.js`, import.meta.url), "utf8");
    assert.match(source, /requireAdminApi\(request\)/);
    assert.match(source, /assertHenrySpotifyOwner\(auth\)/);
  }
  const connect = readFileSync(new URL("../app/api/admin/henry/spotify/connect/route.js", import.meta.url), "utf8");
  assert.match(connect, /httpOnly: true/);
  const route = readFileSync(new URL("../app/api/admin/henry/route.js", import.meta.url), "utf8");
  assert.match(route, /isSpotifyOpenUrl\(url\) \? url : null/);
  assert.equal(henryProgressFor("spotify", { acao: "pausar" }), null); // música não é busca no CRM
  assert.equal(pickHenryAnswerScene({ tools: [{ name: "spotify", input: { acao: "tocar" } }] }), "conversa");
});

test("open_spotify: sem aparelho a busca devolve a URI; polling acha o aparelho, transfere e toca nele (fetch mockado)", async () => {
  const tokens = { getAccessToken: async () => "at" };
  const playlistId = "37i9dQZF1DXcBWIGoYBM5M";
  assert.ok(isSpotifyUri(`spotify:playlist:${playlistId}`));
  assert.ok(isSpotifyUri("spotify:track:4uLU6hMCjMI75M1A2tKUQC"));
  assert.ok(!isSpotifyUri("spotify:user:abc"));
  assert.ok(!isSpotifyUri("javascript:alert(1)"));
  assert.ok(!isSpotifyUri("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"));
  assert.deepEqual(spotifyPlayBody("spotify:track:4uLU6hMCjMI75M1A2tKUQC"), { uris: ["spotify:track:4uLU6hMCjMI75M1A2tKUQC"] });
  assert.deepEqual(spotifyPlayBody(`spotify:playlist:${playlistId}`), { context_uri: `spotify:playlist:${playlistId}` });

  // 1) pedido de tocar com /devices vazio → URI para o navegador abrir.
  const empty = async (url) => {
    if (url.includes("/v1/search")) return reply(200, { playlists: { items: [{ uri: `spotify:playlist:${playlistId}`, name: "Rock Clássico" }] } });
    if (url.includes("/v1/me/player/devices")) return reply(200, { devices: [] });
    return reply(404, { error: { status: 404, reason: "NO_ACTIVE_DEVICE" } });
  };
  const command = normalizeSpotifyCommand({ acao: "tocar", busca: "rock clássico", tipo: "playlist" });
  const opened = await runSpotifyCommand(command, { fetchImpl: empty, tokens });
  assert.equal(opened.uri, `spotify:playlist:${playlistId}`);

  // 2) polling: duas voltas sem aparelho, na 3ª o PC aparece; o 1º play recusa (app ainda subindo), o 2º pega.
  let clock = 0;
  let devicePolls = 0;
  let plays = 0;
  const log = [];
  const fetchImpl = async (url, options) => {
    const path = url.replace("https://api.spotify.com", "");
    log.push(`${options.method} ${path}${options.body ? ` ${options.body}` : ""}`);
    if (path === "/v1/me/player/devices") {
      devicePolls += 1;
      return reply(200, { devices: devicePolls >= 3 ? [{ id: "pc", name: "PC", is_active: false }] : [] });
    }
    if (path.startsWith("/v1/me/player/play")) {
      plays += 1;
      return plays === 1 ? reply(404, { error: { status: 404, reason: "NO_ACTIVE_DEVICE" } }) : reply(204);
    }
    return reply(204);
  };
  const sleeps = [];
  const done = await playOnSpotifyWhenReady(opened.uri, { fetchImpl, tokens, timeoutMs: 10000, intervalMs: 1200, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
  assert.deepEqual(done, { ok: true, device: "PC" });
  assert.equal(devicePolls, 4);
  assert.ok(sleeps.every((ms) => ms === 1200));
  assert.ok(log.includes(`PUT /v1/me/player ${JSON.stringify({ device_ids: ["pc"], play: false })}`)); // transfer
  assert.ok(log.includes(`PUT /v1/me/player/play?device_id=pc ${JSON.stringify({ context_uri: `spotify:playlist:${playlistId}` })}`));
  assert.equal(describeSpotifyOpenResult(done), "");

  // 3) nenhum aparelho em ~10 s → desiste e pede um play no Spotify.
  clock = 0;
  let polls = 0;
  const never = await playOnSpotifyWhenReady(opened.uri, {
    tokens,
    fetchImpl: async () => { polls += 1; return reply(200, { devices: [] }); },
    timeoutMs: 10000,
    intervalMs: 1200,
    now: () => clock,
    sleep: async (ms) => { clock += ms; }
  });
  assert.deepEqual(never, { ok: false, reason: "no_device" });
  assert.ok(polls >= 8 && polls <= 9, `polls=${polls}`);
  assert.match(describeSpotifyOpenResult(never), /play uma vez/);
  assert.deepEqual(await playOnSpotifyWhenReady("spotify:user:x", { tokens, fetchImpl: async () => reply(204) }), { ok: false, reason: "failed" });
});

test("open_spotify: payload validado na rota, fala fixa, tela abre na mesma aba e rota de play só do dono", () => {
  const route = readFileSync(new URL("../app/api/admin/henry/route.js", import.meta.url), "utf8");
  assert.match(route, /isSpotifyUri\(spotify\.uri\)/);
  const voice = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  assert.match(voice, /if \(context\.spotify\) replyText = "Abrindo o Spotify…";/);
  const play = readFileSync(new URL("../app/api/admin/henry/spotify/play/route.js", import.meta.url), "utf8");
  assert.match(play, /requireAdminApi\(request\)/);
  assert.match(play, /assertHenrySpotifyOwner\(auth\)/);
  assert.match(play, /isSpotifyUri\(body\?\.uri\)/);
  const ui = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(ui, /open_spotify/);
  assert.match(ui, /\/api\/admin\/henry\/spotify\/play/);
  const opener = ui.slice(ui.indexOf("const openSpotifyAndPlay"), ui.indexOf("// Despedida na voz do Henry"));
  assert.ok(!opener.includes("window.open"), "abre o app sem aba nova");
});
