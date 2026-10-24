import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MORNING_SUGGESTIONS,
  SPOTIFY_TASTE_SCOPES,
  grantedTasteScopes,
  isOtherMusicRequest,
  morningMoment,
  morningSuggestionLine,
  pickMorningSuggestion,
  rememberMorningSuggestion,
  spotifyTasteSuggestions,
  todaysMorningSuggestion
} from "../lib/henry-morning-music-core.mjs";
import { classifyMorningMusicAnswer } from "../lib/henry-morning-core.mjs";
import { SPOTIFY_SCOPES } from "../lib/henry-spotify-core.mjs";
import { henryAsksQuestion, isShortReply } from "../lib/henry-voice-conversation.mjs";
import { safeHenryReply } from "../lib/henry-voice-core.mjs";

// Datas fixas (meio-dia UTC = 9h em São Paulo).
const TUESDAY = new Date("2026-10-20T12:00:00Z");
const MONDAY = new Date("2026-10-19T12:00:00Z");
const SUNDAY = new Date("2026-10-25T12:00:00Z");
const seq = (...values) => {
  let index = 0;
  return () => values[index++ % values.length];
};

test("sugestão: 30 dias seguidos, nunca a mesma de ontem nem o mesmo tipo seguido", () => {
  const random = seq(0.13, 0.71, 0.42, 0.95, 0.05, 0.58);
  let stored = null;
  let previous = null;
  const seen = new Set();
  for (let day = 0; day < 30; day += 1) {
    const now = new Date(TUESDAY.getTime() + day * 86400000);
    const recent = (stored?.recent || []).map((entry) => entry.id);
    const lastKind = stored?.recent?.at(-1)?.kind || "";
    const offer = pickMorningSuggestion({ recent, lastKind, now, random });
    assert.ok(offer, `dia ${day}`);
    if (previous) {
      assert.notEqual(offer.id, previous.id, `repetiu em dias seguidos (dia ${day})`);
      assert.notEqual(offer.kind, previous.kind, `mesmo tipo seguido (dia ${day})`);
    }
    // Enquanto há sugestão nunca usada no banco, não repete nenhuma dos últimos dias.
    if (day < 15) assert.equal(seen.has(offer.id), false, `repetiu cedo (dia ${day})`);
    seen.add(offer.id);
    stored = rememberMorningSuggestion(stored, offer, `d${day}`);
    previous = offer;
  }
  assert.ok(new Set([...seen].map((id) => MORNING_SUGGESTIONS.find((entry) => entry.id === id)?.kind)).size >= 3, "alterna artista, música e estilo");
});

test("sugestão: banco esgotado → nunca uma das últimas 10", () => {
  const ids = MORNING_SUGGESTIONS.map((entry) => entry.id);
  for (let r = 0; r < 1; r += 0.07) {
    const offer = pickMorningSuggestion({ recent: ids, now: TUESDAY, random: () => r });
    assert.ok(offer);
    assert.equal(ids.slice(-10).includes(offer.id), false);
  }
});

test("sugestão sem Spotify: clima do momento (domingo leve, segunda animado) e frase curta com pergunta", () => {
  assert.equal(morningMoment(SUNDAY).mood, "leve");
  assert.equal(morningMoment(MONDAY).mood, "animado");
  assert.equal(pickMorningSuggestion({ now: SUNDAY, random: () => 0.5 }).mood, "leve");
  assert.equal(pickMorningSuggestion({ now: MONDAY, random: () => 0.5 }).mood, "animado");
  for (const entry of MORNING_SUGGESTIONS) {
    for (const r of [0, 0.34, 0.67, 0.99]) {
      const line = morningSuggestionLine(entry, "Matheus", { now: MONDAY, random: () => r });
      assert.equal(henryAsksQuestion(line), true, line);
      assert.equal(safeHenryReply(line), line, line);
      assert.ok(line.length <= 140, line);
      assert.equal(/rock ou sertanejo|playlist de rock, sertanejo/i.test(line), false, line);
    }
    assert.ok(entry.target.query && entry.target.type, entry.id);
  }
  // Mesmo dia de novo (botão ▶): muda o começo da frase.
  const first = morningSuggestionLine(MORNING_SUGGESTIONS[0], "Matheus", { now: MONDAY, random: () => 0 });
  const again = morningSuggestionLine(MORNING_SUGGESTIONS[0], "Matheus", { now: MONDAY, random: () => 0, avoid: [first.split(/\s+/).slice(0, 4).join(" ").replace(/[.,!?]+$/, "")] });
  assert.notEqual(again.split(" ").slice(0, 3).join(" "), first.split(" ").slice(0, 3).join(" "));
});

test("sugestão com o gosto do Spotify: usa a URI exata e prefere o gosto dele", () => {
  const taste = spotifyTasteSuggestions({
    topArtists: { items: [{ uri: "spotify:artist:1111111111AAAA", name: "Jorge & Mateus" }] },
    topTracks: { items: [{ uri: "spotify:track:2222222222BBBB", name: "Amanhã Sei Lá - Ao Vivo", artists: [{ name: "Jorge & Mateus" }] }] },
    recent: { items: [{ track: { uri: "spotify:track:2222222222BBBB", name: "repetida" } }] },
    playlists: { items: [{ uri: "spotify:playlist:3333333333CCCC", name: "Estrada" }, { uri: "inválida", name: "x" }] }
  });
  assert.deepEqual(taste.map((entry) => entry.kind), ["artist", "track", "playlist"]);
  assert.equal(taste[1].say, "Amanhã Sei Lá, do Jorge & Mateus");
  assert.deepEqual(taste[2].target, { uri: "spotify:playlist:3333333333CCCC" });
  const offer = pickMorningSuggestion({ taste, now: TUESDAY, random: () => 0 });
  assert.equal(offer.taste, true);
  // Gosto vazio (sem escopo) = banco fixo.
  assert.equal(spotifyTasteSuggestions({}).length, 0);
  assert.equal(pickMorningSuggestion({ taste: [], now: TUESDAY, random: () => 0 }).taste, undefined);
});

test("escopos: o OAuth pede o gosto (dono, 24/10) e a leitura usa só o que a conexão liberou", () => {
  for (const scope of SPOTIFY_TASTE_SCOPES) assert.equal(SPOTIFY_SCOPES.includes(scope), true, scope);
  assert.deepEqual(grantedTasteScopes("user-read-playback-state user-top-read"), ["user-top-read"]);
  assert.deepEqual(grantedTasteScopes(undefined), []);
});

test("aceite curto toca a sugestão de hoje; 'toca outra coisa' vai para o pedido dele", () => {
  for (const text of ["pode", "manda", "bora", "pode ser", "toca", "toca aí", "manda ver"]) {
    assert.equal(classifyMorningMusicAnswer(text), "yes", text);
    assert.equal(isOtherMusicRequest(text), false, text);
    assert.equal(isShortReply(text), true, text);
  }
  assert.equal(classifyMorningMusicAnswer("não"), "no");
  for (const text of ["toca Jorge e Mateus", "coloca Legião Urbana", "não, toca um pagode"]) assert.equal(isOtherMusicRequest(text), true, text);
  const offer = MORNING_SUGGESTIONS[5];
  const stored = rememberMorningSuggestion({ recent: [{ id: "x", date: "2026-10-23", kind: "track", target: { query: "a", type: "track" } }] }, offer, "2026-10-24");
  assert.deepEqual(todaysMorningSuggestion(stored, "2026-10-24").target, offer.target);
  assert.equal(todaysMorningSuggestion(stored, "2026-10-25"), null);
  assert.equal(todaysMorningSuggestion(null, "2026-10-24"), null);
});
