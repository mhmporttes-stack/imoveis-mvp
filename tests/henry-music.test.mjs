// Henry e música (dono, 2026-10-23; docs/BUSINESS_RULES.md HENRY-1 "Música"): intenção de música lida cedo pelo texto,
// tópico "music" desde o 1º evento, frases de espera sem "CRM"/números, cena da música sincronizada com os eventos reais,
// e a guarda da escuta com a música tocando (a letra não acorda nem interrompe o Henry).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_WAIT_PHRASES,
  henryInitialProgress,
  henryMusicIntent,
  henryMusicResult,
  henryProgressFor,
  isMusicRequest,
  isSpotifyImageUrl,
  mergeHenryMusic,
  musicPlayingLine,
  musicQueryFromText,
  normalizeHenryScene,
  pickHenryAnswerScene,
  pickWaitPhrase
} from "../lib/henry-voice-narration.mjs";
import {
  HENRY_REPLY_WINDOW_MS,
  detectMusicBargeIn,
  henryAsksQuestion,
  isAwaitingReply,
  isHenryRepeatQuestion,
  isMusicGuardActive,
  isMusicPauseCommand,
  isShortReply,
  looksLikeLyrics,
  musicListenGate,
  openPendingReply,
  repeatQuestionFor
} from "../lib/henry-voice-conversation.mjs";
import { MORNING_ALREADY_PLAYING, MORNING_STYLE_QUESTION, morningOpening } from "../lib/henry-morning-core.mjs";
import { duckSpotifyVolume, readSpotifyNowPlaying, runSpotifyCommand, spotifyImageOf } from "../lib/henry-spotify-core.mjs";

const reply = (status, body = null) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => (body === null ? "" : JSON.stringify(body)) });
const tokens = { getAccessToken: async () => "at" };

test("intenção de música detectada cedo pelo texto (sem IA), sem confundir com pergunta do CRM", () => {
  for (const text of ["Henry, toca Jorge e Mateus", "toca uma playlist de sertanejo raiz", "coloca a playlist sertanejo raiz", "pausa", "próxima", "aumenta o som", "que música é essa?", "bota um som aí", "abre o Spotify"]) {
    assert.equal(isMusicRequest(text), true, text);
  }
  for (const text of ["quantos leads hoje?", "como foi a próxima semana?", "compara com o período anterior", "volume de leads do mês", "me conta uma piada", "lembra que sexta tem reunião", "para"]) {
    assert.equal(isMusicRequest(text), false, text);
  }
  assert.equal(musicQueryFromText("Henry, toca Jorge e Mateus"), "Jorge e Mateus");
  assert.equal(musicQueryFromText("toca uma playlist de sertanejo raiz"), "sertanejo raiz");
  assert.equal(musicQueryFromText("toca aí músicas do Legião Urbana no Spotify"), "Legião Urbana");
  assert.equal(musicQueryFromText("toca Sorriso Maroto por favor"), "Sorriso Maroto");
  // Bom dia com música: a resposta à pergunta da música/estilo também é música (o "não" segue para o relatório).
  assert.equal(henryMusicIntent({ mode: "report", question: "rock", morningStep: "music" }), true);
  assert.equal(henryMusicIntent({ mode: "report", question: "sertanejo raiz", morningStep: "style" }), true);
  assert.equal(henryMusicIntent({ mode: "report", question: "não, hoje não", morningStep: "music" }), false);
  assert.equal(henryMusicIntent({ mode: "report", question: "" }), false);
});

test("topic music desde o 1º evento e em cada evento do Spotify; nunca a cena de números", () => {
  const first = henryInitialProgress("question", { question: "Henry, toca Jorge e Mateus" });
  assert.equal(first.topic, "music");
  assert.deepEqual(first.music, { stage: "connect", query: "Jorge e Mateus" });
  assert.equal(henryInitialProgress("report", { question: "rock", morningStep: "music" }).topic, "music");
  assert.equal(henryInitialProgress("report").topic, "relatorio");
  assert.equal(henryInitialProgress("question", { question: "quantos leads hoje?" }).topic, "geral");
  const search = henryProgressFor("spotify", { acao: "tocar", busca: "sertanejo raiz" });
  assert.equal(search.topic, "music");
  assert.deepEqual(search.music, { stage: "search", query: "sertanejo raiz" });
  assert.equal(henryProgressFor("spotify", { acao: "volume", ajuste: "mais_alto" }).music.stage, "control");
  // Resultado real → achou/tocando/erro.
  const image = "https://i.scdn.co/image/ab67616d00001e02aaaa";
  assert.equal(henryMusicResult({ action: "tocar", query: "x" }, { ok: true, playing: { name: "Sertanejo Raiz", artists: "playlist", image } }).music.stage, "playing");
  assert.equal(henryMusicResult({ action: "tocar", query: "x" }, { ok: false, reason: "no_device", uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M" }).music.stage, "opening");
  const error = henryMusicResult({ action: "tocar", query: "x" }, { ok: false, reason: "no_device" });
  assert.equal(error.music.stage, "error");
  assert.equal(error.music.error, "Nenhum aparelho com o Spotify aberto.");
  // Cena da resposta: música = "musica" (com o estado saneado); papo/piada/lembrete nunca viram números.
  assert.equal(pickHenryAnswerScene({ tools: [{ name: "spotify", input: { acao: "tocar" } }] }), "musica");
  assert.equal(pickHenryAnswerScene({ tools: [] }), "conversa");
  assert.equal(pickHenryAnswerScene({ memory: true }), "memoria");
  const scene = normalizeHenryScene({ kind: "musica", music: { stage: "playing", name: "<b>X</b>", image: "https://evil.example/x.png" } });
  assert.equal(scene.music.stage, "playing");
  assert.equal(scene.music.image, undefined); // capa só dos servidores do Spotify
  assert.equal(isSpotifyImageUrl(image), true);
  assert.equal(isSpotifyImageUrl("javascript:alert(1)"), false);
  assert.deepEqual(mergeHenryMusic({ stage: "search", query: "rock" }, { stage: "found", name: "Rock Clássico" }), { stage: "found", query: "rock", name: "Rock Clássico", error: undefined });
});

test("narração musical: frases sem CRM/números, sem cair nas do CRM e sem repetir seguido", () => {
  const music = HENRY_WAIT_PHRASES.filter((phrase) => phrase.topics.includes("music"));
  assert.ok(music.length >= 6);
  for (const phrase of music) {
    assert.doesNotMatch(phrase.text, /crm|número|numero|dados|relatório|funil|analis/i, phrase.text);
    assert.deepEqual(phrase.topics, ["music"]); // nunca tocam num pedido do CRM
  }
  // Mesmo com todas as frases da música nas recentes, nunca cai numa frase do CRM; nunca repete a anterior.
  const recent = music.map((phrase) => phrase.id);
  for (let index = 0; index < 20; index += 1) {
    const choice = pickWaitPhrase({ topic: "music", recentIds: recent, random: () => index / 20 });
    assert.ok(choice.topics.includes("music"));
    assert.notEqual(choice.id, recent[recent.length - 1]);
  }
  // E as frases do CRM nunca saem para a música.
  assert.ok(!HENRY_WAIT_PHRASES.some((phrase) => phrase.topics.includes("music") && phrase.topics.length > 1));
  assert.equal(musicPlayingLine({ name: "Sertanejo Raiz", artists: "playlist" }), "Pronto, tá tocando! Sertanejo Raiz.");
  assert.equal(musicPlayingLine({ name: "Evidências", artists: "Chitãozinho & Xororó" }), "Pronto, tá tocando! Evidências, de Chitãozinho & Xororó.");
  assert.equal(musicPlayingLine({}), "Pronto, tá tocando!");
});

test("música tocando: frase sem o nome é ignorada; com o nome no começo, aceita; letra longa ignorada", () => {
  assert.equal(isMusicGuardActive({ playerPlaying: true }), true);
  assert.equal(isMusicGuardActive({ playedAt: 1000, now: 20000 }), true); // marcador local logo depois do play
  assert.equal(isMusicGuardActive({ playedAt: 1000, now: 1000 + 60000 }), false);
  assert.equal(isMusicGuardActive({}), false);
  assert.equal(musicListenGate("eu sei que vou te amar por toda a minha vida").accept, false);
  assert.equal(musicListenGate("quantos leads hoje").accept, false); // sem o nome, nada de conversa
  assert.equal(musicListenGate("oh henry meu amor eu volto pra você").accept, false); // nome no meio da letra
  const named = musicListenGate("Henry, pausa a música");
  assert.equal(named.accept, true);
  assert.equal(named.named, true);
  assert.equal(musicListenGate("bom dia, Henry").accept, true);
  // Depois de um chamado (nome sozinho, atalho, nome ouvido pelo app): frase curta vale; trecho longo com cara de letra não.
  assert.equal(musicListenGate("abaixa o som", { explicit: true }).accept, true);
  const lyric = "e o vento levou tudo que era meu e eu fiquei aqui sozinho chorando na beira do rio sem você";
  assert.equal(looksLikeLyrics(lyric), true);
  assert.equal(musicListenGate(lyric, { explicit: true }).accept, false);
});

test("música tocando: barge-in só com comando forte", () => {
  assert.equal(detectMusicBargeIn("eu quero você comigo agora mesmo").interrupt, false);
  assert.equal(detectMusicBargeIn("ai que saudade henry de você").interrupt, false); // nome no meio = letra
  assert.equal(detectMusicBargeIn("para").interrupt, true);
  assert.equal(detectMusicBargeIn("espera").interrupt, true);
  assert.deepEqual(detectMusicBargeIn("pausa"), { interrupt: true, kind: "question", question: "pausa a música" });
  assert.equal(detectMusicBargeIn("Henry, abaixa o som").interrupt, true);
  assert.equal(isMusicPauseCommand("Henry, pausa a música"), true);
  assert.equal(isMusicPauseCommand("para a música"), true);
  assert.equal(isMusicPauseCommand("para"), false);
});

test("Spotify: capa na busca, tocando agora com BPM opcional e volume baixo enquanto ele fala (fetch mockado)", async () => {
  const image = { url: "https://i.scdn.co/image/abc", width: 300, height: 300 };
  assert.equal(spotifyImageOf({ album: { images: [{ url: "https://i.scdn.co/image/big", width: 640 }, image] } }), image.url);
  assert.equal(spotifyImageOf({ images: [{ url: "http://x.com/a.png", width: 300 }] }), "");
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(`${options.method || "GET"} ${url}`);
    if (url.includes("/v1/search")) return reply(200, { playlists: { items: [{ uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", name: "Sertanejo Raiz", images: [image] }] } });
    if (url.includes("/v1/me/player/play")) return reply(204);
    if (url.includes("/v1/me/player/currently-playing")) return reply(200, { is_playing: true, item: { id: "4uLU6hMCjMI75M1A2tKUQC", type: "track", name: "Evidências", artists: [{ name: "Chitãozinho & Xororó" }], album: { images: [image] } } });
    if (url.includes("/v1/audio-features/")) return reply(403, { error: { status: 403 } }); // restrito para apps novos
    if (url.endsWith("/v1/me/player")) return reply(200, { is_playing: true, device: { volume_percent: 70 } });
    if (url.includes("/v1/me/player/volume")) return reply(204);
    return reply(404);
  };
  const played = await runSpotifyCommand({ action: "tocar", query: "sertanejo raiz", type: "playlist" }, { fetchImpl, tokens });
  assert.equal(played.ok, true);
  assert.equal(played.playing.image, image.url);
  const cache = new Map();
  const now = await readSpotifyNowPlaying({ fetchImpl, tokens, tempoCache: cache });
  assert.deepEqual(now, { isPlaying: true, name: "Evidências", artists: "Chitãozinho & Xororó", image: image.url, tempo: null });
  await readSpotifyNowPlaying({ fetchImpl, tokens, tempoCache: cache });
  assert.equal(calls.filter((call) => call.includes("audio-features")).length, 1); // falhou uma vez → não pede de novo
  const ducked = await duckSpotifyVolume({ fetchImpl, tokens });
  assert.deepEqual(ducked, { ducked: true, previous: 70, level: 15 });
  assert.ok(calls.some((call) => call.includes("/v1/me/player/volume?volume_percent=15")));
});

test("ligações: rota manda o tópico cedo, o player só para o dono, a tela usa a guarda da música", () => {
  const route = readFileSync(new URL("../app/api/admin/henry/route.js", import.meta.url), "utf8");
  assert.match(route, /henryInitialProgress\(request\.mode, \{ question: request\.question, morningStep: request\.morning\?\.step/);
  const player = readFileSync(new URL("../app/api/admin/henry/spotify/player/route.js", import.meta.url), "utf8");
  assert.match(player, /requireAdminApi/);
  assert.match(player, /assertHenrySpotifyOwner/);
  const ui = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(ui, /musicListenGate\(text, \{ explicit, awaitingReply \}\)/);
  assert.match(ui, /detectMusicBargeIn/);
  assert.match(ui, /live: topic === MUSIC_TOPIC \? false/);
  const view = readFileSync(new URL("../components/henry/HenryVoiceView.jsx", import.meta.url), "utf8");
  assert.match(view, /showDataScene = dataScene && sceneTopic !== "music"/);
});

// Bug de 2026-10-23 (docs/INCIDENTES.md): música tocando, "Bom dia, Henry" → "Posso dar play…?" → "pode" → "Não entendi".
test("pergunta aberta com música tocando: resposta curta vale sem o nome por ~12 s; sem pergunta, não; letra, nunca", () => {
  assert.equal(henryAsksQuestion(morningOpening("Matheus")), true);
  assert.equal(henryAsksQuestion(MORNING_STYLE_QUESTION), true);
  assert.equal(henryAsksQuestion("Meu patrão, tem um minutinho?"), true);
  assert.equal(henryAsksQuestion("Pulei pra próxima faixa."), false);
  const asked = openPendingReply("music", 1000);
  assert.equal(isAwaitingReply(asked, 5000), true); // ainda falando
  const ended = { ...asked, endedAt: 8000 };
  assert.equal(isAwaitingReply(ended, 8000 + HENRY_REPLY_WINDOW_MS - 1), true);
  assert.equal(isAwaitingReply(ended, 8000 + HENRY_REPLY_WINDOW_MS + 1), false);
  assert.equal(isAwaitingReply({ active: false }, 9000), false);
  // Com pergunta pendente: "pode" e companhia são aceitos sem o nome.
  for (const text of ["pode", "Pode ser", "sim", "bora", "manda", "rock", "sertanejo", "agora não", "fala", "oi", "pode ser, toca um rock aí pra gente hoje"]) {
    const gate = musicListenGate(text, { awaitingReply: true });
    assert.equal(gate.accept, true, text);
    assert.equal(gate.reply, true, text);
  }
  // Sem pergunta pendente: "pode" continua ignorado (só o nome no começo acorda).
  assert.equal(musicListenGate("pode").accept, false);
  assert.equal(musicListenGate("pode", { awaitingReply: isAwaitingReply(ended, 8000 + HENRY_REPLY_WINDOW_MS + 1) }).accept, false);
  // Frase longa com cara de letra continua ignorada, mesmo com pergunta pendente.
  const lyric = "pode chorar meu bem que eu não volto mais pra você nunca mais nessa vida eu juro por deus";
  assert.equal(looksLikeLyrics(lyric), true);
  assert.equal(musicListenGate(lyric, { awaitingReply: true }).accept, false);
  assert.equal(isShortReply("eu sei que vou te amar por toda a minha vida"), false); // 10 palavras, não começa com resposta
  assert.equal(musicListenGate("eu sei que vou te amar por toda a minha vida", { awaitingReply: true }).accept, false);
});

test("pergunta aberta sem resposta: repete curta uma vez; aviso não repete (o aviso chama de novo); bom dia com música já tocando", () => {
  assert.equal(repeatQuestionFor(openPendingReply("music")), "Posso dar play?");
  assert.equal(repeatQuestionFor(openPendingReply("style")), "Rock ou sertanejo?");
  assert.equal(repeatQuestionFor(openPendingReply("birthday")), "Preparo a mensagem?");
  assert.equal(repeatQuestionFor(openPendingReply("question")), "Não peguei. Pode repetir?");
  assert.equal(repeatQuestionFor({ ...openPendingReply("music"), retried: true }), "");
  assert.equal(repeatQuestionFor(openPendingReply("alert")), "");
  assert.equal(repeatQuestionFor({ active: false }), "");
  assert.equal(isHenryRepeatQuestion("Posso dar play?"), true);
  assert.equal(isHenryRepeatQuestion("qualquer outra frase"), false);
  assert.equal(MORNING_ALREADY_PLAYING, "Já tá rolando um som, então bora pro dia:");
  const server = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  assert.match(server, /\(musicState = await morningMusicState\(\)\)\.playing/);
  assert.match(server, /prefix: MORNING_ALREADY_PLAYING/);
  const ui = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(ui, /intent\.reason === "empty" && missedReplyRef\.current\(\)/); // gravação do Henry: vazia repete a pergunta (dono, 2026-10-23)
  assert.match(ui, /holdSpotifyDuck\(HENRY_REPLY_WINDOW_MS\)/);
});

// Dono, 2026-10-24: "toda vez que eu peço uma música, ele fala algo relacionado ao CRM" — pedidos que caíam no tópico
// padrão (frases de espera "do CRM") e os que nunca podem virar música.
test("pedido de música reconhecido em todas as formas faladas; perguntas do CRM continuam fora", () => {
  for (const text of [
    "quero ouvir Legião Urbana", "quero escutar um rock", "bora ouvir um pagode", "manda um pagode", "bota um rock", "vamos de sertanejo",
    "coloca uma música", "Toca uma música aí", "toca Racionais", "Henrique, toca Jorge e Mateus", "Enri toca um samba",
    "Henry, por favor toca Legião", "Henry, você pode tocar Bon Jovi?", "pode colocar Zezé di Camargo", "dá um play", "volta a tocar",
    "próxima", "próxima música", "pula essa", "pausa", "aumenta o som", "abaixa o volume", "Henry. Toca Legião."
  ]) {
    assert.equal(isMusicRequest(text), true, text);
    assert.equal(henryInitialProgress("question", { question: text }).topic, "music", text);
  }
  for (const text of [
    "quantas músicas tem na playlist?", "quantos clientes entraram hoje?", "status da cliente Bruna", "quero ouvir o relatório da semana",
    "quero ouvir os avisos", "manda uma mensagem pro Gabriel", "manda o relatório pro celular", "Henrique fechou alguma venda?",
    "pode me falar o status da Carol?", "como foi a próxima semana?", "volume de leads do mês", "coloca na agenda a visita do Pedro"
  ]) {
    assert.equal(isMusicRequest(text), false, text);
  }
});
