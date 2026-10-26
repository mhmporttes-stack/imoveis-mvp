// Bom dia: playlist do dono quando ele deixa o Henry escolher (dono, 2026-10-26: print de "Rock Blues Animadas" +
// "Toque essa playlist."; fala: "Já estou escolhendo uma música para iniciarmos o dia, em seguida já te atualizo do que
// aconteceu enquanto você estava fora."). Reserva = lista de artistas rock/blues.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MORNING_CHOICE_ACCEPT_LINE,
  MORNING_SUGGESTIONS,
  cachedMorningPlaylist,
  morningPlaylistOffset,
  morningPlaylistSetting,
  morningStyleAcceptLine,
  morningStyleFallbacks,
  pickOwnerPlaylist,
  playlistTrackTotal,
  rememberMorningPlaylist,
  usesOwnerPlaylist
} from "../lib/henry-morning-music-core.mjs";
import { MORNING_OWNER_PLAYLIST_DEFAULT } from "../lib/henry-morning-core.mjs";
import { findOwnerSpotifyPlaylist, runSpotifyCommand } from "../lib/henry-spotify-core.mjs";
import { parseHenryStylePatch, resolveHenryStyle } from "../lib/henry-voice-style.mjs";
import { safeHenryReply } from "../lib/henry-voice-core.mjs";

const MINE = { uri: "spotify:playlist:37i9dQZF1DXrockblues01", name: "Rock Blues Animadas", owner: { id: "matheus123", display_name: "Matheus Machado" }, tracks: { total: 28 } };
const OTHER_OWNER = { uri: "spotify:playlist:0000000000otherowner1", name: "Rock Blues Animadas", owner: { id: "outra", display_name: "Fulano" } };
const SIMILAR = { uri: "spotify:playlist:0000000000similar0001", name: "Rock Blues Animadas 2", owner: { id: "matheus123", display_name: "Matheus Machado" } };
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (body === undefined ? "" : JSON.stringify(body)) });
const tokens = { getAccessToken: async () => "at" };

test("padrão = Rock Blues Animadas; link de playlist toca direto; link de outra coisa volta ao padrão", () => {
  assert.equal(MORNING_OWNER_PLAYLIST_DEFAULT, "Rock Blues Animadas");
  assert.deepEqual(morningPlaylistSetting({}), { name: "Rock Blues Animadas", uri: "" });
  assert.deepEqual(morningPlaylistSetting(null), { name: "Rock Blues Animadas", uri: "" });
  assert.deepEqual(morningPlaylistSetting({ morningPlaylist: "Blues de Sexta" }), { name: "Blues de Sexta", uri: "" });
  assert.deepEqual(morningPlaylistSetting({ morningPlaylist: "https://open.spotify.com/playlist/37i9dQZF1DXrockblues01?si=abc" }), { name: "", uri: "spotify:playlist:37i9dQZF1DXrockblues01" });
  assert.deepEqual(morningPlaylistSetting({ morningPlaylist: "https://open.spotify.com/track/37i9dQZF1DXrockblues01" }), { name: "", uri: "" });
});

test("escolha da playlist: nome exato E dono (conta conectada ou Matheus Machado)", () => {
  assert.equal(pickOwnerPlaylist([OTHER_OWNER, SIMILAR, MINE], { name: "rock blues animadas", ownerId: "matheus123" }), MINE);
  assert.equal(pickOwnerPlaylist([OTHER_OWNER, SIMILAR], { name: "Rock Blues Animadas", ownerId: "matheus123" }), null);
  // Sem id da conta (falhou /v1/me): vale o nome do dono.
  assert.equal(pickOwnerPlaylist([OTHER_OWNER, MINE], { name: "Rock Blues Animadas" }), MINE);
  // Com id, outra conta chamada "Matheus Machado" não vale.
  const homonym = { ...MINE, uri: "spotify:playlist:0000000000homonym0001", owner: { id: "outro-matheus", display_name: "Matheus Machado" } };
  assert.equal(pickOwnerPlaylist([homonym], { name: "Rock Blues Animadas", ownerId: "matheus123" }), null);
  assert.equal(pickOwnerPlaylist([null, { name: "Rock Blues Animadas" }], { name: "Rock Blues Animadas" }), null);
  assert.equal(playlistTrackTotal(MINE), 28);
  assert.equal(playlistTrackTotal({ items: { total: 12 } }), 12);
  assert.equal(playlistTrackTotal({}), 0);
});

test("cache: mesmo nome por até 30 dias; nome trocado ou velho = procura de novo", () => {
  const now = new Date("2026-10-26T11:00:00Z");
  const saved = rememberMorningPlaylist({ name: "Rock Blues Animadas", uri: MINE.uri, total: 28 }, now);
  assert.deepEqual(cachedMorningPlaylist(saved, "rock blues animadas", new Date("2026-11-10T11:00:00Z")), { uri: MINE.uri, name: "Rock Blues Animadas", total: 28 });
  assert.equal(cachedMorningPlaylist(saved, "Blues de Sexta", now), null);
  assert.equal(cachedMorningPlaylist(saved, "Rock Blues Animadas", new Date("2026-12-01T11:00:00Z")), null);
  assert.equal(cachedMorningPlaylist({}, "Rock Blues Animadas", now), null);
  assert.equal(cachedMorningPlaylist({ ...saved, uri: "spotify:artist:37i9dQZF1DXrockblues01" }, "Rock Blues Animadas", now), null);
});

test("busca: /v1/me/playlists paginado primeiro; depois a busca type=playlist; nada = not_found", async () => {
  const calls = [];
  const page = (items, next) => ({ items, next });
  const fetchImpl = (pages, searchItems) => async (url) => {
    const parsed = new URL(url);
    calls.push(`${parsed.pathname}${parsed.searchParams.get("offset") ? `@${parsed.searchParams.get("offset")}` : ""}`);
    if (parsed.pathname === "/v1/me") return reply(200, { id: "matheus123", display_name: "Matheus Machado" });
    if (parsed.pathname === "/v1/me/playlists") return reply(200, pages[Number(parsed.searchParams.get("offset")) / 50] || page([], null));
    if (parsed.pathname === "/v1/search") {
      assert.equal(parsed.searchParams.get("type"), "playlist");
      return reply(200, { playlists: { items: searchItems } });
    }
    return reply(404);
  };
  const full = Array.from({ length: 50 }, (_, index) => ({ uri: `spotify:playlist:filler${String(index).padStart(14, "0")}`, name: `Outra ${index}`, owner: { id: "matheus123" } }));
  const deps = { tokens, pick: pickOwnerPlaylist, ownerNames: ["Matheus Machado"], trackTotal: playlistTrackTotal };
  const second = await findOwnerSpotifyPlaylist("Rock Blues Animadas", { ...deps, fetchImpl: fetchImpl([page(full, "next"), page([OTHER_OWNER, MINE], null)], []) });
  assert.deepEqual(second, { ok: true, uri: MINE.uri, name: "Rock Blues Animadas", total: 28, source: "me" });
  assert.deepEqual(calls, ["/v1/me", "/v1/me/playlists@0", "/v1/me/playlists@50"]);
  const bySearch = await findOwnerSpotifyPlaylist("Rock Blues Animadas", { ...deps, fetchImpl: fetchImpl([page([], null)], [null, OTHER_OWNER, MINE]) });
  assert.equal(bySearch.source, "search");
  assert.equal(bySearch.uri, MINE.uri);
  const none = await findOwnerSpotifyPlaylist("Rock Blues Animadas", { ...deps, fetchImpl: fetchImpl([page([SIMILAR], null)], [OTHER_OWNER]) });
  assert.deepEqual(none, { ok: false, reason: "not_found" });
});

test("play da playlist: context_uri + posição sorteada e aleatório ligado depois", async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    seen.push({ method: options.method, path: parsed.pathname, state: parsed.searchParams.get("state"), body: options.body ? JSON.parse(options.body) : null });
    if (parsed.pathname === "/v1/me/player/currently-playing") return reply(200, { item: { uri: "spotify:track:aaaaaaaaaaaaaaaaaaaaaa", name: "Pride and Joy" }, context: { uri: MINE.uri } });
    return reply(204);
  };
  const result = await runSpotifyCommand({ action: "tocar", uri: MINE.uri, shuffle: true, offsetPosition: 5 }, { fetchImpl, tokens, sleep: async () => {} });
  assert.equal(result.ok, true);
  const play = seen.find((call) => call.path === "/v1/me/player/play");
  assert.deepEqual(play.body, { context_uri: MINE.uri, offset: { position: 5 } });
  const shuffle = seen.find((call) => call.path === "/v1/me/player/shuffle");
  assert.equal(shuffle.method, "PUT");
  assert.equal(shuffle.state, "true");
  assert.ok(seen.indexOf(shuffle) > seen.indexOf(play), "aleatório depois do play");
  // Sem shuffle pedido (demais músicas), nada muda.
  seen.length = 0;
  await runSpotifyCommand({ action: "tocar", uri: MINE.uri }, { fetchImpl, tokens, sleep: async () => {} });
  assert.equal(seen.some((call) => call.path === "/v1/me/player/shuffle"), false);
  assert.equal(morningPlaylistOffset(28, () => 0.5), 14);
  assert.equal(morningPlaylistOffset(0), null);
});

test("aceite: só a escolha automática usa a playlist; a reserva de artistas continua; fala literal do dono", () => {
  const offer = MORNING_SUGGESTIONS[0];
  assert.equal(usesOwnerPlaylist(offer), true);
  assert.equal(usesOwnerPlaylist({ kind: "style", genre: "suits" }), true);
  assert.equal(usesOwnerPlaylist({ kind: "track", genre: "" }), false);
  assert.equal(morningStyleFallbacks(offer, { random: () => 0 }).length, 2, "reserva = 2 artistas da lista");
  const line = "Já estou escolhendo uma música para iniciarmos o dia, em seguida já te atualizo do que aconteceu enquanto você estava fora.";
  assert.equal(MORNING_CHOICE_ACCEPT_LINE, line);
  assert.equal(morningStyleAcceptLine(offer), line);
  assert.equal(safeHenryReply(line), line);
});

test("tela do Henry: campo 'Playlist do bom dia' salvo no estilo (vazio = padrão)", () => {
  const patch = parseHenryStylePatch({ morningPlaylist: "  Blues de Sexta  " });
  assert.equal(patch.ok, true);
  assert.equal(patch.patch.morningPlaylist, "Blues de Sexta");
  assert.equal(resolveHenryStyle({ morningPlaylist: "Blues de Sexta" }).morningPlaylist, "Blues de Sexta");
  assert.equal(resolveHenryStyle({}).morningPlaylist, "");
  const card = readFileSync(new URL("../components/henry/HenrySettingsCard.jsx", import.meta.url), "utf8");
  assert.match(card, /Playlist do bom dia/);
  // O servidor tenta a playlist antes dos artistas, e só na escolha automática.
  const voice = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  assert.match(voice, /usesOwnerPlaylist\(suggested\) && !trainingStore\.getStore\(\)/);
  assert.match(voice, /resolveHenryMorningPlaylist\(auth, style\)/);
});
