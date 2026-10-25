// Bom dia: música DE FUNDO no clima de Suits (dono, 2026-10-25: "Matheus, enquanto passo as informações, gostaria que eu
// tocasse alguma música de fundo?" + "Não exatamente as mesmas músicas, eu quero aquele estilo." — nunca a trilha nem a
// abertura da série).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MORNING_SUGGESTIONS,
  SPOTIFY_TASTE_SCOPES,
  SUITS_EXCLUDED_WORDS,
  SUITS_STYLE_ARTISTS,
  SUITS_STYLE_QUERIES,
  grantedTasteScopes,
  hasSuitsExcludedWord,
  isOtherMusicRequest,
  morningGenreTarget,
  morningMoment,
  morningStyleAcceptLine,
  morningStyleFallbacks,
  morningSuggestionLine,
  morningSuggestionMatchesGenre,
  pickMorningSuggestion,
  rememberMorningSuggestion,
  todaysMorningSuggestion
} from "../lib/henry-morning-music-core.mjs";
import { MORNING_GENRES, classifyMorningMusicAnswer, classifyMorningMusicReply } from "../lib/henry-morning-core.mjs";
import { SPOTIFY_SCOPES, pickSpotifySearchResult } from "../lib/henry-spotify-core.mjs";
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
const BANNED = /suits|greenback|ima robot/i;

test("oferta: sempre o clima de Suits; o termo de busca do estilo nunca é o de ontem", () => {
  const random = seq(0.13, 0.71, 0.42, 0.95, 0.05, 0.58);
  let stored = null;
  let previous = null;
  const seen = new Set();
  for (let day = 0; day < 30; day += 1) {
    const last = stored?.recent?.at(-1)?.target?.query || "";
    const offer = pickMorningSuggestion({ lastQuery: last, random });
    assert.ok(offer, `dia ${day}`);
    assert.equal(offer.say, "um som no clima de Suits");
    assert.equal(offer.genre, "suits");
    assert.equal(offer.target.type, "playlist");
    if (previous) assert.notEqual(offer.target.query, previous.target.query, `repetiu o de ontem (dia ${day})`);
    seen.add(offer.target.query);
    stored = rememberMorningSuggestion(stored, offer, `d${day}`);
    previous = offer;
  }
  assert.ok(seen.size >= 4, "sorteia entre os termos do estilo");
  // O registro guarda o estilo e o que tocar.
  assert.equal(stored.recent.at(-1).genre, "suits");
  assert.ok(stored.recent.at(-1).target.query);
});

test("a busca nunca contém Suits, Greenback ou Ima Robot (nem a reserva)", () => {
  for (const query of SUITS_STYLE_QUERIES) assert.doesNotMatch(query, BANNED, query);
  for (const artist of SUITS_STYLE_ARTISTS) assert.doesNotMatch(artist, BANNED, artist);
  for (const entry of MORNING_SUGGESTIONS) {
    assert.doesNotMatch(entry.target.query, BANNED, entry.id);
    assert.deepEqual([...entry.target.exclude], [...SUITS_EXCLUDED_WORDS]);
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const fallbacks = morningStyleFallbacks(entry, { random: () => r });
      assert.equal(fallbacks.length, 2);
      assert.equal(fallbacks[0].type, "playlist");
      assert.notEqual(fallbacks[0].query, entry.target.query);
      assert.equal(fallbacks[1].type, "artist");
      for (const fallback of fallbacks) {
        assert.doesNotMatch(fallback.query, BANNED, fallback.query);
        assert.deepEqual([...fallback.exclude], [...SUITS_EXCLUDED_WORDS]);
      }
    }
  }
  // "pode ser esse de Suits mesmo" / "toca no clima de Suits" = o gênero suits → busca do ESTILO, nunca "Suits".
  const suits = MORNING_GENRES.find((item) => item.id === "suits");
  assert.doesNotMatch(suits.query, BANNED);
  for (const mood of ["", "animado"]) {
    const target = morningGenreTarget(suits, { mood, taste: { playlists: { items: [{ uri: "spotify:playlist:5555555555EEEE", name: "Suits Soundtrack" }] } } });
    assert.doesNotMatch(target.target.query, BANNED, target.target.query);
    assert.ok(target.target.exclude.length);
  }
  assert.equal(classifyMorningMusicReply("pode ser esse clima de Suits mesmo").genre?.id, "suits");
  assert.equal(morningSuggestionMatchesGenre(MORNING_SUGGESTIONS[0], suits), true);
  assert.equal(morningSuggestionMatchesGenre(MORNING_SUGGESTIONS[0], classifyMorningMusicReply("prefiro pagode").genre), false);
  assert.equal(hasSuitsExcludedWord("Greenback Boogie"), true);
  assert.equal(hasSuitsExcludedWord("indie rock groove"), false);
});

test("resultado com Suits/Ima Robot/Greenback no nome é descartado da busca", () => {
  const data = {
    playlists: { items: [
      { uri: "spotify:playlist:1111111111AAAA", name: "Suits Soundtrack", owner: { display_name: "x" } },
      { uri: "spotify:playlist:2222222222BBBB", name: "Indie Rock Groove", description: "Greenback Boogie e mais" },
      { uri: "spotify:playlist:3333333333CCCC", name: "Indie Rock Groove 2", owner: { display_name: "Spotify" } }
    ] },
    tracks: { items: [{ uri: "spotify:track:4444444444DDDD", name: "Greenback Boogie", artists: [{ name: "Ima Robot" }] }] }
  };
  const picked = pickSpotifySearchResult(data, "indie rock groove", { preferType: "playlist", exclude: SUITS_EXCLUDED_WORDS });
  assert.equal(picked.item.uri, "spotify:playlist:3333333333CCCC");
  assert.equal(pickSpotifySearchResult({ playlists: { items: [data.playlists.items[0]] } }, "indie rock groove", { preferType: "playlist", exclude: SUITS_EXCLUDED_WORDS }), null);
  // Sem exclude, nada muda para os outros pedidos.
  assert.equal(pickSpotifySearchResult({ playlists: { items: [data.playlists.items[0]] } }, "suits soundtrack", { preferType: "playlist" }).item.uri, "spotify:playlist:1111111111AAAA");
});

test("frase: 'Enquanto te passo as informações, quer que eu coloque um som no clima de Suits de fundo?' e variações", () => {
  assert.equal(morningMoment(SUNDAY).mood, "leve");
  assert.equal(morningMoment(MONDAY).mood, "animado");
  const offer = MORNING_SUGGESTIONS[0];
  const first = morningSuggestionLine(offer, "Matheus", { now: TUESDAY, random: () => 0 });
  assert.equal(first, "Bom dia, Matheus! Enquanto te passo as informações, quer que eu coloque um som no clima de Suits de fundo? Ou prefere outro estilo ou algum cantor?");
  const lines = new Set();
  for (const r of [0, 0.21, 0.34, 0.5, 0.67, 0.8, 0.99]) {
    const line = morningSuggestionLine(offer, "Matheus", { now: MONDAY, random: () => r });
    lines.add(line);
    assert.equal(henryAsksQuestion(line), true, line);
    assert.equal(safeHenryReply(line), line, line);
    assert.ok(line.includes("de fundo"), line);
    assert.ok(line.includes("clima de Suits"), line);
    assert.match(line, /estilo|cantor/, line);
    assert.ok(line.length <= 220, line);
  }
  assert.ok(lines.size >= 4, "varia a frase");
  // Mesmo dia de novo (botão ▶): muda a oferta, a saudação e a abertura.
  const again = morningSuggestionLine(offer, "Matheus", { now: TUESDAY, random: () => 0, said: [first], avoid: [first.split(/\s+/).slice(0, 4).join(" ").replace(/[.,!?]+$/, "")] });
  assert.notEqual(again.split(" ").slice(0, 3).join(" "), first.split(" ").slice(0, 3).join(" "), again);
  assert.equal(again.includes("Enquanto te passo as informações, quer que eu coloque"), false, again);
  assert.equal(again.endsWith("Ou prefere outro estilo ou algum cantor?"), false, again);
  // Aceite: confirma curto.
  assert.equal(morningStyleAcceptLine(offer), "Lá vai um som no clima de Suits de fundo.");
  assert.equal(morningStyleAcceptLine({ kind: "track", say: "Pense em Mim" }), "");
});

test("escopos: o OAuth pede o gosto (dono, 24/10) e a leitura usa só o que a conexão liberou", () => {
  for (const scope of SPOTIFY_TASTE_SCOPES) assert.equal(SPOTIFY_SCOPES.includes(scope), true, scope);
  assert.deepEqual(grantedTasteScopes("user-read-playback-state user-top-read"), ["user-top-read"]);
  assert.deepEqual(grantedTasteScopes(undefined), []);
});

test("aceite curto toca a sugestão de hoje; 'toca outra coisa' vai para o pedido dele", () => {
  for (const text of ["ok", "pode", "manda", "bora", "pode ser", "sim", "toca", "toca aí", "manda ver"]) {
    assert.equal(classifyMorningMusicAnswer(text), "yes", text);
    assert.equal(isOtherMusicRequest(text), false, text);
    assert.equal(isShortReply(text), true, text);
  }
  for (const text of ["não", "agora não"]) assert.equal(classifyMorningMusicAnswer(text), "no", text);
  for (const text of ["toca Jorge e Mateus", "coloca Legião Urbana", "não, toca um pagode"]) assert.equal(isOtherMusicRequest(text), true, text);
  const offer = MORNING_SUGGESTIONS[5];
  const stored = rememberMorningSuggestion({ recent: [{ id: "x", date: "2026-10-23", kind: "track", target: { query: "a", type: "track" } }] }, offer, "2026-10-24");
  assert.equal(todaysMorningSuggestion(stored, "2026-10-24").target.query, offer.target.query);
  assert.equal(todaysMorningSuggestion(stored, "2026-10-25"), null);
  assert.equal(todaysMorningSuggestion(null, "2026-10-24"), null);
});
