// Bom dia: música DE FUNDO (dono, 2026-10-26: "Não é para o Henry dizer música no estilo de Suits. É para dizer: 'Que tal
// uma música de fundo? Posso escolher ou você tem alguma de preferência?' Com isso ele escolhe uma animada no estilo rock
// blues ou algo do tipo. Ele tocou uma música nada a ver, mexicana.").
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MORNING_MUSIC_EXCLUDED_WORDS,
  MORNING_MUSIC_OFFER,
  MORNING_ROCK_BLUES_ARTISTS,
  MORNING_SUGGESTIONS,
  SPOTIFY_TASTE_SCOPES,
  grantedTasteScopes,
  hasMorningExcludedWord,
  isOtherMusicRequest,
  morningGenreTarget,
  morningMoment,
  morningStyleAcceptLine,
  morningStyleFallbacks,
  morningSuggestionLine,
  morningSuggestionMatchesGenre,
  morningSuggestionTarget,
  pickMorningSuggestion,
  rememberMorningSuggestion,
  todaysMorningSuggestion
} from "../lib/henry-morning-music-core.mjs";
import { MORNING_GENRES, classifyMorningMusicAnswer, classifyMorningMusicReply } from "../lib/henry-morning-core.mjs";
import { SPOTIFY_SCOPES, pickSpotifySearchResult, runSpotifyCommand } from "../lib/henry-spotify-core.mjs";
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
const OFF_STYLE = /latin|mexic|regional|corrido|sertanejo|pagode|funk|forr|reggaeton|cumbia/i;
const listed = (name) => MORNING_ROCK_BLUES_ARTISTS.includes(name);
const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data, text: async () => (data ? JSON.stringify(data) : "") });

test("oferta: escolha automática = artista da lista rock/blues, nunca o de ontem, nunca playlist", () => {
  const random = seq(0.13, 0.71, 0.42, 0.95, 0.05, 0.58);
  let stored = null;
  let previous = null;
  const seen = new Set();
  for (let day = 0; day < 30; day += 1) {
    const last = stored?.recent?.at(-1)?.target?.query || "";
    const offer = pickMorningSuggestion({ lastQuery: last, random });
    assert.ok(offer, `dia ${day}`);
    assert.equal(offer.genre, "rock-blues");
    assert.equal(offer.target.type, "artist");
    assert.equal(offer.target.strict, true);
    assert.ok(listed(offer.target.query), offer.target.query);
    if (previous) assert.notEqual(offer.target.query, previous.target.query, `repetiu o de ontem (dia ${day})`);
    seen.add(offer.target.query);
    stored = rememberMorningSuggestion(stored, offer, `d${day}`);
    previous = offer;
  }
  assert.ok(seen.size >= 5, "rodízio entre os artistas");
  assert.equal(stored.recent.at(-1).genre, "rock-blues");
  assert.ok(listed(stored.recent.at(-1).target.query));
});

test("a escolha automática só usa artistas da lista rock/blues (sugestão, reserva, registro antigo e 'rock blues' pedido)", () => {
  assert.ok(MORNING_ROCK_BLUES_ARTISTS.length >= 10);
  for (const artist of MORNING_ROCK_BLUES_ARTISTS) {
    assert.doesNotMatch(artist, BANNED, artist);
    assert.doesNotMatch(artist, OFF_STYLE, artist);
  }
  for (const entry of MORNING_SUGGESTIONS) {
    assert.ok(listed(entry.target.query), entry.target.query);
    assert.notEqual(entry.target.type, "playlist");
    assert.deepEqual([...entry.target.exclude], [...MORNING_MUSIC_EXCLUDED_WORDS]);
    assert.equal(morningSuggestionTarget(entry).query, entry.target.query);
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const fallbacks = morningStyleFallbacks(entry, { random: () => r });
      assert.equal(fallbacks.length, 2);
      assert.notEqual(fallbacks[0].query, entry.target.query);
      assert.notEqual(fallbacks[1].query, fallbacks[0].query);
      for (const fallback of fallbacks) {
        assert.ok(listed(fallback.query), fallback.query);
        assert.equal(fallback.type, "artist");
        assert.equal(fallback.strict, true);
        assert.deepEqual([...fallback.exclude], [...MORNING_MUSIC_EXCLUDED_WORDS]);
      }
    }
  }
  // Registro antigo do mesmo dia ("clima de Suits", playlist genérica): vira artista da lista, nunca a playlist guardada.
  const legacy = { id: "estilo-suits", kind: "style", say: "um som no clima de Suits", genre: "suits", target: { query: "soul funk moderno", type: "playlist" } };
  for (const r of [0, 0.5, 0.99]) {
    const target = morningSuggestionTarget(legacy, { random: () => r });
    assert.ok(listed(target.query), target.query);
    assert.equal(target.type, "artist");
  }
  assert.equal(morningStyleFallbacks(legacy, { random: () => 0 }).every((item) => listed(item.query)), true);
  // Registro de faixa/artista específico (antigo) segue o alvo guardado.
  assert.deepEqual(morningSuggestionTarget({ kind: "track", target: { query: "Pense em Mim", type: "track" } }), { query: "Pense em Mim", type: "track" });
  // "um rock blues" / "clima de Suits" na resposta = artista da lista (nunca playlist genérica).
  for (const text of ["pode ser um rock blues", "blues rock animado", "pode ser esse clima de Suits mesmo"]) {
    const genre = classifyMorningMusicReply(text).genre;
    assert.ok(["rock-blues", "suits"].includes(genre?.id), text);
    const target = morningGenreTarget(genre, { mood: "animado", random: () => 0.4 });
    assert.ok(listed(target.target.query), text);
    assert.equal(target.target.strict, true);
    assert.equal(morningSuggestionMatchesGenre(MORNING_SUGGESTIONS[0], genre), true, text);
  }
  assert.equal(morningSuggestionMatchesGenre(MORNING_SUGGESTIONS[0], classifyMorningMusicReply("prefiro pagode").genre), false);
  // Rótulo do antigo gênero "suits" não cita a série (fala de troca).
  assert.doesNotMatch(MORNING_GENRES.find((item) => item.id === "suits").label, BANNED);
  assert.equal(hasMorningExcludedWord("Greenback Boogie"), true);
  assert.equal(hasMorningExcludedWord("Corridos Tumbados 2026"), true);
  assert.equal(hasMorningExcludedWord("Música Mexicana"), true);
  assert.equal(hasMorningExcludedWord("The Black Keys"), false);
});

test("resultado latino/mexicano/regional ou de Suits é descartado da busca", () => {
  const data = {
    playlists: { items: [
      { uri: "spotify:playlist:1111111111AAAA", name: "Soul Funk Moderno", description: "Lo mejor de la música mexicana" },
      { uri: "spotify:playlist:2222222222BBBB", name: "Blues Rock", owner: { display_name: "Regional Mexicano" } },
      { uri: "spotify:playlist:3333333333CCCC", name: "Suits Soundtrack" },
      { uri: "spotify:playlist:5555555555EEEE", name: "Blues Rock 2", owner: { display_name: "Spotify" } }
    ] },
    tracks: { items: [{ uri: "spotify:track:4444444444DDDD", name: "Corridos Tumbados", artists: [{ name: "X" }] }] }
  };
  const picked = pickSpotifySearchResult(data, "blues rock", { preferType: "playlist", exclude: MORNING_MUSIC_EXCLUDED_WORDS });
  assert.equal(picked.item.uri, "spotify:playlist:5555555555EEEE");
  assert.equal(pickSpotifySearchResult({ playlists: { items: data.playlists.items.slice(0, 3) } }, "blues rock", { preferType: "playlist", exclude: MORNING_MUSIC_EXCLUDED_WORDS }), null);
});

test("strict: toca o ARTISTA de nome exato (context_uri do artista); parecido/ausente = not_found, sem 'É essa?'", async () => {
  const tokens = { getAccessToken: async () => "at" };
  const run = async (artists, query) => {
    const log = [];
    const fetchImpl = async (url, options) => {
      const path = url.replace("https://api.spotify.com", "");
      log.push({ method: options.method, path, body: options.body });
      if (path.startsWith("/v1/search")) return reply(200, { artists: { items: artists } });
      return reply(204);
    };
    const result = await runSpotifyCommand({ action: "tocar", query, type: "artist", strict: true, acceptBest: true, exclude: MORNING_MUSIC_EXCLUDED_WORDS }, { fetchImpl, tokens, sleep: async () => {} });
    return { result, log };
  };
  const ok = await run([{ uri: "spotify:artist:7mnBLXK823vNxN3UWB7Gfz", name: "The Black Keys" }], "The Black Keys");
  assert.equal(ok.result.ok, true);
  const search = ok.log.find((line) => line.path.startsWith("/v1/search"));
  assert.match(search.path, /type=artist(&|$)/); // só artista, nunca playlist/faixa
  const play = ok.log.find((line) => line.path.startsWith("/v1/me/player/play"));
  assert.match(String(play.body), /"context_uri":"spotify:artist:7mnBLXK823vNxN3UWB7Gfz"/);
  const near = await run([{ uri: "spotify:artist:1111111111AAAA", name: "The Black Keys Tribute" }], "The Black Keys");
  assert.deepEqual({ ok: near.result.ok, reason: near.result.reason }, { ok: false, reason: "not_found" });
  assert.equal(near.log.some((line) => line.path.startsWith("/v1/me/player/play")), false);
  const latin = await run([{ uri: "spotify:artist:2222222222BBBB", name: "Kaleo Regional Mexicano" }], "Kaleo");
  assert.equal(latin.result.reason, "not_found");
});

test("frase: 'Que tal uma música de fundo? Posso escolher ou você tem alguma de preferência?' — varia só a saudação, nunca Suits", () => {
  assert.equal(morningMoment(SUNDAY).mood, "leve");
  assert.equal(morningMoment(MONDAY).mood, "animado");
  const offer = MORNING_SUGGESTIONS[0];
  const first = morningSuggestionLine(offer, "Matheus", { now: TUESDAY, random: () => 0 });
  assert.equal(first, "Bom dia, Matheus! Que tal uma música de fundo? Posso escolher ou você tem alguma de preferência?");
  const lines = new Set();
  for (const entry of MORNING_SUGGESTIONS) {
    for (const r of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
      const line = morningSuggestionLine(entry, "Matheus", { now: MONDAY, random: () => r });
      lines.add(line);
      assert.ok(line.endsWith(` ${MORNING_MUSIC_OFFER}`), line);
      assert.doesNotMatch(line, BANNED, line);
      assert.doesNotMatch(line, /rock|blues|estilo|cantor/i, line); // a oferta não cita estilo nem o artista sorteado
      assert.equal(line.includes(entry.target.query), false, line);
      assert.equal(henryAsksQuestion(line), true, line);
      assert.equal(safeHenryReply(line), line, line);
    }
  }
  assert.ok(lines.size >= 4, "varia a saudação");
  // Mesmo dia de novo (botão ▶): outra saudação, a mesma oferta.
  const again = morningSuggestionLine(offer, "Matheus", { now: TUESDAY, random: () => 0, said: [first], avoid: [first.split(/\s+/).slice(0, 4).join(" ").replace(/[.,!?]+$/, "")] });
  assert.notEqual(again.split(" ").slice(0, 2).join(" "), first.split(" ").slice(0, 2).join(" "), again);
  assert.ok(again.endsWith(MORNING_MUSIC_OFFER), again);
  // Aceite: confirma curto, sem Suits (inclusive registro antigo do mesmo dia).
  assert.equal(morningStyleAcceptLine(offer), "Lá vai um rock blues animado de fundo.");
  assert.equal(morningStyleAcceptLine({ kind: "style", genre: "suits", say: "um som no clima de Suits" }), "Lá vai um rock blues animado de fundo.");
  assert.equal(morningStyleAcceptLine({ kind: "track", say: "Pense em Mim" }), "");
});

test("respostas à oferta: aceite = o Henry escolhe; preferência segue o fluxo; 'não' = sem música", () => {
  for (const text of ["pode escolher", "Pode escolher, Henry", "escolhe você", "você escolhe", "ok", "pode", "manda", "sim", "tanto faz", "não tenho", "Não tenho, pode escolher", "sem preferência", "você que sabe"]) {
    assert.equal(classifyMorningMusicReply(text).kind, "yes", text);
  }
  assert.deepEqual(classifyMorningMusicReply("toca pagode").genre?.id, "pagode");
  assert.deepEqual(classifyMorningMusicReply("prefiro MPB").genre?.id, "mpb");
  assert.deepEqual(classifyMorningMusicReply("Jorge e Mateus"), { kind: "artist", query: "Jorge e Mateus" });
  assert.deepEqual(classifyMorningMusicReply("Não tenho, toca Jorge e Mateus"), { kind: "artist", query: "Jorge e Mateus" });
  assert.deepEqual(classifyMorningMusicReply("tenho sim, Jorge e Mateus"), { kind: "artist", query: "Jorge e Mateus" });
  const change = classifyMorningMusicReply("Pode, mas hoje tô na vibe de um sertanejo mais animado.");
  assert.deepEqual({ id: change.genre?.id, mood: change.mood, change: change.change }, { id: "sertanejo", mood: "animado", change: true });
  for (const text of ["não", "agora não", "hoje não"]) assert.equal(classifyMorningMusicReply(text).kind, "no", text);
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

test("bom dia: pedido de tocar sem gênero/cantor = aceite (dono, 2026-10-26: tocou 'musiquinha brasileira')", async () => {
  const { classifyMorningMusicReply } = await import("../lib/henry-morning-core.mjs");
  for (const text of ["pode tocar bota uma musiquinha aí para tocar para nós tocar para nós", "pode tocar", "bota uma música aí", "solta um som de fundo", "pode escolher"]) {
    assert.equal(classifyMorningMusicReply(text).kind, "yes", text);
  }
  assert.equal(classifyMorningMusicReply("toca Jorge e Mateus").kind, "artist");
  assert.equal(classifyMorningMusicReply("toca pagode").kind, "genre");
  assert.equal(classifyMorningMusicReply("agora não").kind, "no");
});
