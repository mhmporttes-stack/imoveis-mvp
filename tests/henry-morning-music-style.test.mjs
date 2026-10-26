// Bom dia: estilo ou cantor na resposta da música (dono, 2026-10-24: "acrescente também opção de estilo musical como
// rock, sertanejo; aí eu posso ou falar qual estilo ou responder o cantor e ele procura").
import { test } from "node:test";
import assert from "node:assert/strict";
import { MORNING_GENRES, MORNING_STEPS, classifyMorningMusicReply, parseMorningState } from "../lib/henry-morning-core.mjs";
import {
  MORNING_SUGGESTIONS,
  morningArtistTarget,
  morningConfirmLine,
  morningGenreTarget,
  morningSuggestionLine,
  rememberMorningConfirm,
  rememberMorningSuggestion,
  todaysMorningConfirm,
  todaysMorningSuggestion
} from "../lib/henry-morning-music-core.mjs";
import { henryMusicIntent, henryMusicResult } from "../lib/henry-voice-narration.mjs";
import { henryAsksQuestion, openPendingReply, repeatQuestionFor } from "../lib/henry-voice-conversation.mjs";
import { pickSpotifySearchResult } from "../lib/henry-spotify-core.mjs";
import { safeHenryReply } from "../lib/henry-voice-core.mjs";

const MONDAY = new Date("2026-10-19T12:00:00Z");
const kindOf = (text) => classifyMorningMusicReply(text).kind;

test("aceite curto continua tocando a sugestão; não = sem música", () => {
  for (const text of ["pode", "manda", "bora", "pode ser", "toca", "toca aí", "manda ver", "sim por favor", "pode ser, não tem problema", "tanto faz", "você escolhe", "não sei"]) assert.equal(kindOf(text), "yes", text);
  for (const text of ["não", "não, hoje não", "agora não", "sem música hoje", "deixa pra lá"]) assert.equal(kindOf(text), "no", text);
});

test("estilo: gênero da lista, com enfeite em volta, sem IA", () => {
  const cases = { rock: "rock", "põe um rock": "rock", "um rock bem animado": "rock", "bora de sertanejo": "sertanejo", "sertanejo raiz": "sertanejo", "não, toca um pagode": "pagode", "pode ser MPB": "mpb", "rock nacional": "rock-nacional", "um sertanejo universitário": "sertanejo-universitario", "forró": "forro", "Henry, samba": "samba" };
  for (const [text, id] of Object.entries(cases)) {
    const reply = classifyMorningMusicReply(text);
    assert.equal(reply.kind, "genre", text);
    assert.equal(reply.genre.id, id, text);
  }
  for (const item of MORNING_GENRES) assert.ok(item.query && item.words.length, item.id);
});

test("cantor: nome curto vira busca do artista, como ele falou", () => {
  const cases = { "Legião Urbana": "Legião Urbana", "pode ser Bon Jovi": "Bon Jovi", "toca Jorge e Mateus": "Jorge e Mateus", "Henry, Barão Vermelho": "Barão Vermelho", "Guns N' Roses": "Guns N' Roses", "pagode do Thiaguinho": "pagode do Thiaguinho" };
  for (const [text, query] of Object.entries(cases)) assert.deepEqual(classifyMorningMusicReply(text), { kind: "artist", query }, text);
});

test("pergunta ou assunto do CRM não vira cantor: segue o fluxo normal", () => {
  for (const text of ["quantos clientes entraram ontem?", "quantos clientes entraram ontem", "me fala a agenda de hoje", "qual a meta da equipe", "abre o ranking", "Legião Urbana?", "toca uma da Legião e depois me passa o resumo do dia completo", ""]) assert.equal(kindOf(text), "other", text);
});

test("intenção de música desde o 1º evento acompanha a classificação", () => {
  assert.equal(henryMusicIntent({ mode: "report", question: "um pagode", morningStep: "music" }), true);
  assert.equal(henryMusicIntent({ mode: "report", question: "Legião Urbana", morningStep: "music" }), true);
  assert.equal(henryMusicIntent({ mode: "report", question: "quantos clientes entraram ontem?", morningStep: "music" }), false);
  assert.equal(henryMusicIntent({ mode: "report", question: "não", morningStep: "music" }), false);
  assert.equal(henryMusicIntent({ mode: "report", question: "Bon Jovi", morningStep: "style" }), true);
  assert.equal(henryMusicIntent({ mode: "report", question: "sim", morningStep: "music_confirm" }), true);
  assert.equal(henryMusicIntent({ mode: "report", question: "não", morningStep: "music_confirm" }), false);
});

// Desde 2026-10-26 (dono): "Que tal uma música de fundo? Posso escolher ou você tem alguma de preferência?" — a pergunta
// já abre para estilo ou cantor; sem citar estilo, artista sorteado nem Suits.
test("frase do bom dia: oferta de música de fundo aberta à preferência dele, terminando em pergunta", () => {
  for (const entry of MORNING_SUGGESTIONS) {
    for (const r of [0, 0.34, 0.67, 0.99]) {
      const line = morningSuggestionLine(entry, "Matheus", { now: MONDAY, random: () => r });
      assert.ok(line.endsWith("Que tal uma música de fundo? Posso escolher ou você tem alguma de preferência?"), line);
      assert.equal(line.includes(entry.target.query), false, line);
      assert.equal(/rock ou sertanejo|suits/i.test(line), false, line);
      assert.equal(safeHenryReply(line), line, line);
      assert.ok(line.length <= 220, line);
    }
  }
  // A saudação já dita hoje não volta enquanto houver outra.
  const first = morningSuggestionLine(MORNING_SUGGESTIONS[0], "Matheus", { now: MONDAY, random: () => 0 });
  const again = morningSuggestionLine(MORNING_SUGGESTIONS[0], "Matheus", { now: MONDAY, random: () => 0, said: [first] });
  assert.notEqual(again, first, again);
});

test("estilo → o que tocar: configurado, playlist dele, padrão do dono, busca do gênero", () => {
  const rock = MORNING_GENRES.find((item) => item.id === "rock");
  const sertanejo = MORNING_GENRES.find((item) => item.id === "sertanejo");
  const pagode = MORNING_GENRES.find((item) => item.id === "pagode");
  assert.deepEqual(morningGenreTarget(rock, { style: { rockMusic: "https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U" } }).target, { uri: "spotify:playlist:37i9dQZF1DWXRqgorJj26U" });
  const taste = { playlists: { items: [{ uri: "spotify:playlist:4444444444DDDD", name: "Pagode do Fim de Semana" }] } };
  assert.deepEqual(morningGenreTarget(pagode, { taste }), { target: { uri: "spotify:playlist:4444444444DDDD" }, choice: "genero", query: "Pagode do Fim de Semana" });
  assert.deepEqual(morningGenreTarget(sertanejo).target, { query: "Zezé Di Camargo & Luciano", type: "artist" });
  assert.equal(morningGenreTarget(sertanejo).choice, "sertanejo");
  assert.deepEqual(morningGenreTarget(pagode).target, { query: "pagode", type: "playlist" });
  assert.equal(morningGenreTarget(null), null);
});

test("cantor → busca larga preferindo o artista; nada bate = 'Achei X, de Y. É essa?'", () => {
  assert.deepEqual(morningArtistTarget("Legião Urbana"), { query: "Legião Urbana", type: "artist", broad: true });
  const data = {
    tracks: { items: [{ uri: "spotify:track:1111111111AAAA", name: "Tempo Perdido", artists: [{ name: "Legião Urbana" }] }] },
    artists: { items: [{ uri: "spotify:artist:2222222222BBBB", name: "Legião Urbana" }] }
  };
  assert.equal(pickSpotifySearchResult(data, "Legião Urbana", { preferType: "artist" }).type, "artist");
  assert.equal(morningConfirmLine({ name: "Legiões", artists: "Banda X" }), "Achei Legiões, de Banda X. É essa?");
  assert.equal(henryAsksQuestion(morningConfirmLine({ name: "Legiões", artists: "playlist" })), true);
  assert.equal(henryMusicResult({ action: "tocar", query: "Legiao" }, { ok: false, reason: "confirm", candidate: { name: "Legiões", artists: "Banda X" } }).music.stage, "found");
  assert.equal(MORNING_STEPS.includes("music_confirm"), true);
  assert.deepEqual(parseMorningState({ step: "music_confirm" }), { step: "music_confirm" });
  assert.equal(repeatQuestionFor(openPendingReply("music_confirm")), "É essa?");
});

test("candidato do 'É essa?' guardado só para hoje, sem perder o histórico da sugestão", () => {
  const stored = rememberMorningSuggestion(null, MORNING_SUGGESTIONS[0], "2026-10-24");
  const next = rememberMorningConfirm(stored, { uri: "spotify:artist:2222222222BBBB", name: "Legiões", artists: "Banda X" }, "2026-10-24");
  assert.equal(todaysMorningConfirm(next, "2026-10-24").uri, "spotify:artist:2222222222BBBB");
  assert.equal(todaysMorningConfirm(next, "2026-10-25"), null);
  assert.deepEqual(todaysMorningSuggestion(next, "2026-10-24").target, MORNING_SUGGESTIONS[0].target);
  assert.equal(rememberMorningConfirm(stored, { uri: "invalida" }, "2026-10-24").confirm, undefined);
});
