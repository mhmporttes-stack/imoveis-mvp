// Pacote de interação do Henry (dono, 2026-10-23 — docs/BUSINESS_RULES.md HENRY-1 "Interação"): fala ouvida que não virava
// resposta, fala espontânea que cortava outra, "leia os avisos", avisos da Central por voz, vocabulário repetitivo,
// busca/play de música e pedido composto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RECORD_KEEP_LEVEL,
  RECORD_VOICE_LEVEL,
  SPONTANEOUS_IDLE_MS,
  canSpeakSpontaneously,
  henryLatencyBreakdown,
  isEvidentEcho,
  recordLevelThreshold,
  triggeredTranscriptIntent
} from "../lib/henry-voice-conversation.mjs";
import {
  HENRY_ALERT_PHRASES,
  composeHenryNoticeLines,
  henryVoiceNoticesFromSetting,
  isHenryAlertPhrase,
  isReadAlertsCommand,
  mergeAlertPending,
  noticePendingItems
} from "../lib/henry-voice-client-alerts-core.mjs";
import { buildHenryDynamicPrompt, closingsFrom, henryNeedsTools, openingsFrom } from "../lib/henry-voice-persona.mjs";
import { HENRY_WAIT_PHRASES, MUSIC_PLAYING_OPENERS, isMusicRequest, musicPlayingLine, musicQueryFromText, pickMusicPlayingOpener, pickWaitPhrase } from "../lib/henry-voice-narration.mjs";
import { MORNING_OPENINGS, morningOpening } from "../lib/henry-morning-core.mjs";
import { henryAsksQuestion } from "../lib/henry-voice-conversation.mjs";
import { pickSpotifySearchResult, runSpotifyCommand, spotifyPlayBody, describeSpotifyResult } from "../lib/henry-spotify-core.mjs";
import { isSafeToSpeak } from "../lib/alexa-v2/sanitize.mjs";

const ui = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
const server = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/admin/henry/route.js", import.meta.url), "utf8");
const gate = readFileSync(new URL("../components/alerts/AlertCenterGate.jsx", import.meta.url), "utf8");

// --- A. Gravação aberta pelo Henry: texto não vazio sempre vira pedido ---------------------------------------------------
test("A: transcrição de gravação do Henry vira pedido; só vazio ou eco evidente são descartados", () => {
  const spoken = ["Ô, patrão? Tem um minutinho?"];
  assert.deepEqual(triggeredTranscriptIntent("pode falar", { spoken }), { kind: "question", question: "pode falar", reason: "" });
  assert.equal(triggeredTranscriptIntent("sim", { spoken: ["Posso dar play? Assim você ouve enquanto eu falo."] }).kind, "question"); // "sim" está em "assim", mas não é eco
  assert.equal(triggeredTranscriptIntent("bom dia henry").kind, "report");
  assert.deepEqual(triggeredTranscriptIntent("   ", { spoken }), { kind: "ignore", question: "", reason: "empty" });
  assert.deepEqual(triggeredTranscriptIntent("patrão tem um minutinho", { spoken }), { kind: "ignore", question: "", reason: "echo" });
  // Letra de música não é mais motivo de descarte na gravação (só na escuta contínua sem gatilho).
  const lyric = "pode chorar meu bem que eu não volto mais pra você nunca mais nessa vida eu juro";
  assert.equal(triggeredTranscriptIntent(lyric).kind, "question");
  // Só o nome: continua ouvindo uma vez; de novo só o nome, vira pergunta (nunca fica sem resposta).
  assert.equal(triggeredTranscriptIntent("Henry").kind, "wake");
  assert.equal(triggeredTranscriptIntent("Henry", { continued: true }).kind, "question");
  assert.equal(isEvidentEcho("oi", ["Oi, tudo bem?"]), false);
  assert.equal(isEvidentEcho("tudo bem", ["Tudo bem"]), true);
});

test("A: começo da gravação não conta o fim da fala dele; ruído de fundo sobe o limiar; motivo de descarte no console", () => {
  assert.equal(recordLevelThreshold({ heardVoice: false, floor: 0 }), RECORD_VOICE_LEVEL);
  assert.equal(recordLevelThreshold({ heardVoice: true, floor: 0 }), RECORD_KEEP_LEVEL);
  assert.ok(recordLevelThreshold({ heardVoice: false, floor: 0.12 }) > 0.25); // música baixa no fundo
  assert.ok(recordLevelThreshold({ heardVoice: true, floor: 0.12 }) > 0.18);
  assert.ok(recordLevelThreshold({ heardVoice: false, floor: 5 }) <= 0.6);
  assert.match(ui, /now - session\.startedAt < RECORD_START_GRACE_MS/);
  assert.match(ui, /session\.loudTicks >= RECORD_VOICE_CONFIRM_TICKS/);
  assert.match(ui, /vad\.running && !isMusicGuardActive\(musicGuardRef\.current\)/); // com música, o VAD não segura a gravação
  assert.match(ui, /triggeredTranscriptIntent\(text, \{ spoken, continued: session\.continued \}\)/);
  assert.doesNotMatch(ui, /Parecia a música tocando/); // a guarda da música saiu da gravação
  for (const reason of ["pedido_mais_novo", "sem_voz", "interrupcao_nao_confirmada", "ruido_no_aviso"]) assert.match(ui, new RegExp(reason));
  assert.match(ui, /window\.__henryDebug/);
  assert.doesNotMatch(ui, /henryDebug\([^)]*text[,:]/); // nunca o texto no console de diagnóstico
});

// --- B. Fala espontânea nunca corta ----------------------------------------------------------------------------------
test("B: fala espontânea só com o Henry ocioso há ~3 s, sem gravação, sem pergunta aberta e sem fala tocando", () => {
  const now = 100000;
  const idle = { phase: "idle", busyAt: now - SPONTANEOUS_IDLE_MS - 1, heardAt: 0, now };
  assert.equal(canSpeakSpontaneously(idle), true);
  assert.equal(canSpeakSpontaneously({ ...idle, phase: "speaking" }), false);
  assert.equal(canSpeakSpontaneously({ ...idle, phase: "thinking" }), false);
  assert.equal(canSpeakSpontaneously({ ...idle, recording: true }), false);
  assert.equal(canSpeakSpontaneously({ ...idle, playing: true }), false);
  assert.equal(canSpeakSpontaneously({ ...idle, awaitingReply: true }), false);
  assert.equal(canSpeakSpontaneously({ ...idle, busyAt: now - 1000 }), false);
  assert.equal(canSpeakSpontaneously({ ...idle, heardAt: now - 500 }), false); // o dono falando perto
  assert.equal(canSpeakSpontaneously({ ...idle, phase: "armed" }), true);
  // Chamado do aviso, repetição da pergunta e "Pronto, tá tocando" atrasado passam pela fila; respostas antigas não falam.
  assert.match(ui, /saySpontaneous\("aviso"/);
  assert.match(ui, /saySpontaneous\("repetir_pergunta"/);
  assert.match(ui, /saySpontaneous\("spotify"/);
  assert.match(ui, /if \(requestIdRef\.current !== requestId\) return; \/\/ o dono já pediu outra coisa/);
  assert.match(ui, /requestIdRef\.current !== token \|\| recordRef\.current/);
});

// --- C. Tempos ------------------------------------------------------------------------------------------------------
test("C: tempos por etapa (só números) no console e no log do servidor; voz antecipada da 1ª frase", () => {
  const marks = { speechEnd: 1000, transcribed: 1900, sttMs: 600, asked: 1905, reply: 3100, firstAudio: 3400, playing: 3450, server: { modelMs: 900 } };
  assert.deepEqual(henryLatencyBreakdown(marks), { upload_stt: 900, stt_server: 600, ate_resposta: 1200, ate_1o_audio: 1500, ate_falar: 2450, servidor: { modelMs: 900 } });
  assert.equal(henryLatencyBreakdown({ asked: 10, playing: 30 }).ate_falar, 20);
  assert.match(server, /stream: true/);
  assert.match(server, /onFirstSentence/);
  assert.match(route, /const reuse = early && parts\[0\] === early\.text/); // só usa a voz antecipada se for a 1ª parte final
  assert.match(route, /\[henry\] tempos:/);
  assert.match(route, /ms: Date\.now\(\) - sttStarted/);
  assert.match(server, /MAX_SMALL_TALK_TOKENS/);
});

test("C: papo casual vai sem ferramentas; pergunta de dado, resposta a pergunta dele e música continuam com ferramentas", () => {
  for (const text of ["E aí, tudo bem?", "obrigado Henry", "valeu", "haha", "me conta uma piada", "boa noite"]) assert.equal(henryNeedsTools(text), false, text);
  for (const text of ["quantos leads hoje", "coloque racionais para tocar", "e o Gabriel?", "abre a agenda", "Ei"]) assert.equal(henryNeedsTools(text), true, text);
  assert.match(server, /\/\\\?\\s\*\$\/\.test\(lastAssistant\) \|\| henryNeedsTools\(text\)/);
});

// --- D. Vocabulário -------------------------------------------------------------------------------------------------
test("D: aberturas e finais de hoje vão como 'evite'; a última abertura é citada; música e bom dia variam", () => {
  const turns = [
    { role: "assistant", text: "Beleza, então. Qualquer coisa é só chamar." },
    { role: "assistant", text: "Bom dia, Matheus! Tudo certo por aí?" },
    { role: "assistant", text: "Tranquilo, conta comigo nessa." }
  ];
  assert.deepEqual(closingsFrom(turns), ["Qualquer coisa é só chamar", "Tranquilo, conta comigo nessa"]); // pergunta não entra
  const prompt = buildHenryDynamicPrompt({ usedOpenings: openingsFrom(turns), usedClosings: closingsFrom(turns) });
  assert.match(prompt, /Sua última resposta começou com "Tranquilo, conta comigo nessa"/);
  assert.match(prompt, /Finais que você JÁ usou hoje/);
  assert.ok(openingsFrom(Array.from({ length: 30 }, (_, index) => ({ role: "assistant", text: `Frase ${index} aqui` }))).length === 15);
  // Música: começo sorteado sem repetir os de hoje; nada de "Pronto, tá tocando!" o dia todo.
  assert.ok(MUSIC_PLAYING_OPENERS.length >= 6);
  assert.notEqual(pickMusicPlayingOpener(["Pronto, tá tocando!"], () => 0), "Pronto, tá tocando!");
  assert.equal(musicPlayingLine({ name: "O Quinto Vigia", artists: "Fulano" }, { opener: "Som na caixa!" }), "Som na caixa! O Quinto Vigia, de Fulano.");
  for (const opener of MUSIC_PLAYING_OPENERS) assert.ok(isSafeToSpeak(`${opener} Evidências.`), opener);
  // Bom dia: mesma pergunta da música com outro jeito; todas terminam em pergunta (pergunta aberta).
  assert.ok(MORNING_OPENINGS.length >= 5);
  for (const build of MORNING_OPENINGS) assert.equal(henryAsksQuestion(build("Matheus")), true);
  assert.notEqual(morningOpening("Matheus", { avoid: ["E aí, Matheus! Posso"], random: () => 0 }).slice(0, 10), "E aí, Mathe");
  assert.match(server, /usedClosings: closingsFrom\(memoryTurns\)/);
});

test("D: frases de espera — banco maior, nenhuma repete no dia até o banco do assunto acabar", () => {
  assert.ok(HENRY_WAIT_PHRASES.length >= 50, `${HENRY_WAIT_PHRASES.length}`);
  const withAudio = HENRY_WAIT_PHRASES.filter((phrase) => phrase.topics.includes("relatorio"));
  const used = [];
  for (let index = 0; index < withAudio.length; index += 1) {
    const choice = pickWaitPhrase({ topic: "relatorio", recentIds: used, avoid: used.length, random: () => 0.5 });
    assert.ok(!used.includes(choice.id), `${choice.id} repetiu no dia`);
    used.push(choice.id);
  }
  assert.match(ui, /mm-henry-wait-used/);
});

// --- E. Avisos da Central por voz -----------------------------------------------------------------------------------
test("E: 'leia os avisos' e variações; nada além disso", () => {
  for (const text of ["Henry, leia os avisos", "leia os alertas", "quais os avisos?", "tem aviso?", "O que que tem de aviso pendente?", "me fala os avisos", "avisos pendentes"]) assert.equal(isReadAlertsCommand(text), true, text);
  for (const text of ["quantos leads hoje", "avisa o Gabriel que eu cheguei", "leia o relatório", "tem cliente novo?"]) assert.equal(isReadAlertsCommand(text), false, text);
  assert.match(ui, /isReadAlertsCommand\(question\)/);
  assert.ok(HENRY_ALERT_PHRASES.none.length >= 5);
  for (const phrase of HENRY_ALERT_PHRASES.none) assert.ok(isHenryAlertPhrase(phrase));
});

test("E: avisos da Central viram pendente do chamado, lidos do mais recente, com barreira da fala por aviso", () => {
  assert.equal(henryVoiceNoticesFromSetting({}), true); // nasce ligado
  assert.equal(henryVoiceNoticesFromSetting({ voiceNotices: false }), false);
  const items = noticePendingItems([{ id: "11111111-1111-4111-8111-111111111111", created_at: "2026-10-23T12:00:00Z" }, { id: "" }]);
  assert.deepEqual(items, [{ key: "notice:11111111-1111-4111-8111-111111111111", noticeId: "11111111-1111-4111-8111-111111111111", kind: "notice", at: "2026-10-23T12:00:00.000Z" }]);
  assert.equal(mergeAlertPending([], items).length, 1); // o pendente aceita o aviso da Central
  const lines = composeHenryNoticeLines([
    { id: "a", title: "Cliente novo na roleta", body: "Entrou um cliente pelo anúncio", created_at: "2026-10-23T10:00:00Z" },
    { id: "b", title: "Meta Diária", body: "A equipe passou de metade da meta", created_at: "2026-10-23T11:00:00Z" },
    { id: "c", title: "Contato", body: "Ligar para 14 99999-1234", created_at: "2026-10-23T09:00:00Z" }
  ]);
  assert.ok(lines.text.startsWith("Tem 3 avisos da Central. Meta Diária"), lines.text); // mais recente primeiro
  assert.doesNotMatch(lines.text, /99999/); // telefone nunca é falado
  assert.match(lines.text, /melhor ver na tela/);
  assert.deepEqual(lines.spokenIds, ["b", "a", "c"]);
  const many = composeHenryNoticeLines(Array.from({ length: 8 }, (_, index) => ({ id: `n${index}`, title: `Aviso ${index}`, body: "", created_at: `2026-10-23T1${index}:00:00Z` })));
  assert.match(many.text, /E mais 3 na Central de Alertas/);
  assert.equal(many.spokenIds.length, 5);
});

test("E: só o informativo sai da tela, só com o Henry ativo; importante continua; visto pelo mesmo caminho da tela", () => {
  assert.match(gate, /voiceModeRef\.current/);
  assert.match(gate, /HENRY_NOTICE_ITEMS_EVENT/);
  assert.match(gate, /else showHeld\(\)/); // Henry desligou/fechou: os guardados voltam como card
  assert.match(gate, /<ImportantDialog key=\{currentImportant\.id\}/); // a janela que bloqueia não muda
  assert.match(ui, /fetch\("\/api\/admin\/alerts\/shown"/);
  assert.match(ui, /publish\(false\)/); // ao desmontar, a Central volta a mostrar
  assert.match(ui, /alertRef\.current\.deviceActive && isAlertHour/);
  assert.match(route, /noticeIds = voiceNotices \?/);
  assert.match(readFileSync(new URL("../lib/henry-voice-client-alerts.js", import.meta.url), "utf8"), /listMyPendingAlerts\(auth\)/);
});

// --- F. Música: busca pelo pedido, confirmação e play conferido ------------------------------------------------------
const reply = (status, body = null) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => (body === null ? "" : JSON.stringify(body)) });
const VIGIA = { uri: "spotify:track:1111111111aaaaaaaaaa22", name: "O Quinto Vigia", artists: [{ name: "Artista X" }] };
const VIDA_LOKA = { uri: "spotify:track:3333333333bbbbbbbbbb44", name: "Vida Loka, Pt. 1", artists: [{ name: "Racionais MC's" }] };

test("F: 'o quinto vigia' acha a faixa certa mesmo fora do 1º lugar; nada parecido → pergunta, não toca", () => {
  const data = { tracks: { items: [VIDA_LOKA, VIGIA] }, artists: { items: [{ uri: "spotify:artist:5555555555cccccccccc66", name: "Racionais MC's" }] }, playlists: { items: [] }, albums: { items: [] } };
  const picked = pickSpotifySearchResult(data, "o quinto vigia");
  assert.equal(picked.item.uri, VIGIA.uri);
  assert.equal(picked.good, true);
  const none = pickSpotifySearchResult({ tracks: { items: [VIDA_LOKA] } }, "o quinto vigia");
  assert.equal(none.good, false);
  assert.equal(none.item.uri, VIDA_LOKA.uri);
  assert.equal(pickSpotifySearchResult({ artists: { items: [{ uri: "spotify:artist:5555555555cccccccccc66", name: "Racionais MC's" }] }, tracks: { items: [VIDA_LOKA] } }, "racionais").type, "artist");
  assert.equal(pickSpotifySearchResult({ playlists: { items: [{ uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", name: "Rock Classics" }] } }, "rock clássico", { preferType: "playlist" }).good, true);
  const ask = describeSpotifyResult({ action: "tocar", query: "o quinto vigia" }, { ok: false, reason: "confirm", candidate: { name: "Vida Loka, Pt. 1", artists: "Racionais MC's" } });
  assert.match(ask, /Achei 'Vida Loka, Pt\. 1', de Racionais MC's\. É essa\?/);
  assert.match(ask, /sem tocar nada/);
  assert.equal(isMusicRequest("Coloque a musica o quinto vigia e em seguida me fale o desempenho do gabriel"), true);
  assert.equal(musicQueryFromText("Coloque a musica o quinto vigia e em seguida me fale o desempenho do gabriel"), "o quinto vigia");
  assert.equal(isMusicRequest("coloque racionais para tocar"), true);
  assert.equal(isMusicRequest("coloca na agenda a visita do Pedro"), false);
});

test("F: corpo do play — faixa em uris, playlist/álbum/artista em context_uri; confere o que tocou e tenta 1x de novo", async () => {
  assert.deepEqual(spotifyPlayBody(VIGIA.uri), { uris: [VIGIA.uri] });
  assert.deepEqual(spotifyPlayBody("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"), { context_uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M" });
  assert.deepEqual(spotifyPlayBody("spotify:album:1111111111aaaaaaaaaa22"), { context_uri: "spotify:album:1111111111aaaaaaaaaa22" });
  const tokens = { getAccessToken: async () => "at" };
  const sleep = async () => {};
  const run = async ({ playing }) => {
    const log = [];
    let plays = 0;
    const fetchImpl = async (url, options) => {
      const path = url.replace("https://api.spotify.com", "");
      log.push({ method: options.method, path, body: options.body ? JSON.parse(options.body) : null });
      if (path.startsWith("/v1/search")) return reply(200, { tracks: { items: [VIDA_LOKA, VIGIA] } });
      if (path.startsWith("/v1/me/player/play")) {
        plays += 1;
        return reply(204);
      }
      if (path.startsWith("/v1/me/player/currently-playing")) return reply(200, { is_playing: true, item: { uri: playing(plays) } });
      return reply(204);
    };
    const result = await runSpotifyCommand({ action: "tocar", query: "o quinto vigia", type: "track" }, { fetchImpl, tokens, sleep });
    return { result, log, plays };
  };
  const ok = await run({ playing: () => VIGIA.uri });
  assert.equal(ok.result.ok, true);
  assert.equal(ok.result.playing.name, "O Quinto Vigia");
  const search = ok.log.find((item) => item.path.startsWith("/v1/search"));
  assert.match(search.path, /type=track%2Cartist%2Cplaylist%2Calbum/);
  assert.match(search.path, /limit=10/);
  assert.deepEqual(ok.log.find((item) => item.path.startsWith("/v1/me/player/play")).body, { uris: [VIGIA.uri] });
  // 1º play "deu certo" mas seguiu tocando a anterior → tenta de novo e confere.
  const retried = await run({ playing: (plays) => (plays >= 2 ? VIGIA.uri : VIDA_LOKA.uri) });
  assert.equal(retried.plays, 2);
  assert.equal(retried.result.ok, true);
  // Nunca começou → motivo curto, sem fingir que tocou.
  const stuck = await run({ playing: () => VIDA_LOKA.uri });
  assert.deepEqual({ ok: stuck.result.ok, reason: stuck.result.reason, plays: stuck.plays }, { ok: false, reason: "not_started", plays: 2 });
  assert.match(describeSpotifyResult({ action: "tocar", query: "x" }, stuck.result), /não começou/);
});

// --- G/H. Pedido composto, cena e corretor ----------------------------------------------------------------------------
test("G/H: pedido composto mantém a resposta do modelo; cena da música antes da de dados; cenas zeradas no pedido novo", () => {
  assert.match(server, /const musicOnly = context\.tools\.length > 0 && context\.tools\.every/);
  assert.match(server, /else if \(context\.musicPlayed && musicOnly\)/);
  assert.match(ui, /deferredTopicRef\.current = topic;/);
  assert.match(ui, /deferredTopicRef\.current = "";\n    setScene\(\{ topic: startTopic, label: "", brokers: \[\]/);
  // consultar_corretor: números do período começam junto com o reconhecimento do corretor (antes, em fila).
  assert.match(server, /const numbers = Promise\.all\(\[softRead\("desempenho do corretor"/);
  assert.match(server, /tempos consultar_corretor/);
});
