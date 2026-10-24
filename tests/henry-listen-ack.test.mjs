// Confirmação de escuta do Henry (dono, 2026-10-23 — docs/BUSINESS_RULES.md HENRY-1 "Confirmação de escuta"): som,
// interjeição ou frase curta logo depois do fim da fala, sem repetir seguido, nunca em resposta a uma pergunta dele.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_ACK_ITEMS,
  HENRY_ACK_TONES,
  HENRY_ACK_WEIGHTS,
  HENRY_WAIT_PHRASES,
  NARRATION_AFTER_ACK_MS,
  NARRATION_FIRST_DELAY_MS,
  ackToneDurationMs,
  henryAckContext,
  isAckPhrase,
  pickListenAck,
  shouldAcknowledgeHeard,
  shouldNarrate
} from "../lib/henry-voice-narration.mjs";
import { henryListenAckOn, mergeHenryStyle, parseHenryStylePatch, resolveHenryStyle } from "../lib/henry-voice-style.mjs";

const audio = { base64: "QQ==", contentType: "audio/mpeg" };
const phrases = HENRY_ACK_ITEMS.map((item) => ({ ...item, audio }));
const seq = (...values) => {
  let index = 0;
  return () => values[index++ % values.length];
};

test("banco: interjeições e frases curtas do dono, ids únicos, fora das frases de espera; sons curtos", () => {
  const words = HENRY_ACK_ITEMS.filter((item) => item.topics.includes("ack_word")).map((item) => item.text);
  const lines = HENRY_ACK_ITEMS.filter((item) => item.topics.includes("ack_phrase")).map((item) => item.text);
  assert.deepEqual(words, ["Hum…", "Opa.", "Uhum.", "Beleza.", "Certo.", "Show.", "Fechou."]);
  assert.equal(lines.length, 6);
  assert.ok(lines.includes("Peraí que eu confiro."));
  const ids = [...HENRY_ACK_ITEMS, ...HENRY_WAIT_PHRASES].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(HENRY_ACK_ITEMS.every(isAckPhrase));
  assert.ok(!HENRY_WAIT_PHRASES.some(isAckPhrase));
  for (const item of HENRY_ACK_ITEMS) {
    assert.ok(item.text.split(/\s+/).length <= 5, item.text);
    assert.doesNotMatch(item.text, /\d|henry/i);
  }
  assert.ok(HENRY_ACK_TONES.length >= 3);
  for (const tone of HENRY_ACK_TONES) assert.ok(ackToneDurationMs(tone) < 400, tone.id); // ~300 ms
  assert.equal(HENRY_ACK_WEIGHTS.tone + HENRY_ACK_WEIGHTS.word + HENRY_ACK_WEIGHTS.phrase, 1);
});

test("quando NÃO confirmar: desligado, mudo, sem fala, resposta a pergunta dele, comando na hora, outra fala tocando", () => {
  const base = { enabled: true, muted: false, heard: true };
  assert.equal(shouldAcknowledgeHeard(base), true);
  assert.equal(shouldAcknowledgeHeard({ ...base, enabled: false }), false);
  assert.equal(shouldAcknowledgeHeard({ ...base, muted: true }), false);
  assert.equal(shouldAcknowledgeHeard({ ...base, heard: false }), false);
  assert.equal(shouldAcknowledgeHeard({ ...base, awaitingReply: true }), false); // "pode falar" do aviso, "rock" do bom dia
  assert.equal(shouldAcknowledgeHeard({ ...base, instant: true }), false); // "leia os avisos", "desliga a tela"
  assert.equal(shouldAcknowledgeHeard({ ...base, speaking: true }), false); // resposta já tocando
});

test("tipo pelo pedido: dados/demorado → frase; papo → som ou interjeição; sem texto → sorteio", () => {
  assert.equal(henryAckContext({ mode: "report" }), "data");
  assert.equal(henryAckContext({ question: "como foi a semana do Gabriel" }), "data");
  assert.equal(henryAckContext({ question: "quantos clientes novos hoje" }), "data");
  assert.equal(henryAckContext({ question: "obrigado" }), "chat");
  assert.equal(henryAckContext({ question: "tudo bem com você" }), "chat");
  assert.equal(henryAckContext({ question: "" }), "unknown");
  for (let index = 0; index < 20; index += 1) {
    const pick = pickListenAck({ context: "data", phrases, random: () => index / 20 });
    assert.equal(pick.kind, "phrase");
    const chat = pickListenAck({ context: "chat", phrases, random: () => index / 20 });
    assert.ok(chat.kind === "tone" || chat.kind === "word", chat.kind);
  }
});

test("sorteio ponderado ~40/35/25 sem texto", () => {
  assert.equal(pickListenAck({ phrases, random: seq(0.1, 0) }).kind, "tone");
  assert.equal(pickListenAck({ phrases, random: seq(0.5, 0) }).kind, "word");
  assert.equal(pickListenAck({ phrases, random: seq(0.9, 0) }).kind, "phrase");
  const counts = { tone: 0, word: 0, phrase: 0 };
  for (let index = 0; index < 1000; index += 1) counts[pickListenAck({ phrases, random: seq(index / 1000, 0.5) }).kind] += 1;
  assert.ok(Math.abs(counts.tone - 400) <= 10 && Math.abs(counts.word - 350) <= 10 && Math.abs(counts.phrase - 250) <= 10, JSON.stringify(counts));
});

test("nunca repete o mesmo item seguido; evita os já usados hoje; sem áudio cai no som", () => {
  let last = "";
  for (let index = 0; index < 300; index += 1) {
    const pick = pickListenAck({ lastId: last, phrases, random: Math.random });
    assert.notEqual(pick.id, last);
    last = pick.id;
  }
  const words = HENRY_ACK_ITEMS.filter((item) => item.topics.includes("ack_word")).map((item) => item.id);
  const usedToday = words.slice(0, -1);
  for (let index = 0; index < 10; index += 1) {
    assert.equal(pickListenAck({ context: "chat", usedToday, phrases, random: seq(0.6, index / 10) }).id, words[words.length - 1]);
  }
  // Banco do dia acabou: volta a usar, menos o anterior.
  const again = pickListenAck({ context: "chat", usedToday: words, lastId: words[0], phrases, random: seq(0.6, 0) });
  assert.equal(again.kind, "word");
  assert.notEqual(again.id, words[0]);
  // Sem crédito/cache (nenhum áudio): sempre o som, nunca a voz do navegador.
  for (const context of ["data", "chat", "unknown"]) assert.equal(pickListenAck({ context, phrases: [], random: seq(0.9, 0) }).kind, "tone");
  assert.equal(pickListenAck({ context: "data", phrases: phrases.map(({ audio: _audio, ...rest }) => rest), random: () => 0 }).kind, "tone");
});

test("frase de espera só ~2,5 s depois da confirmação", () => {
  const base = { startedAt: 1000, playing: false, replied: false, hasAudio: true };
  const now = 1000 + NARRATION_FIRST_DELAY_MS + 500;
  assert.equal(shouldNarrate({ ...base, now }), true);
  assert.equal(shouldNarrate({ ...base, now, ackEndedAt: now - NARRATION_AFTER_ACK_MS + 1 }), false);
  assert.equal(shouldNarrate({ ...base, now, ackEndedAt: now - NARRATION_AFTER_ACK_MS }), true);
});

test("liga/desliga 'Confirmar que ouviu' em Voz e personalidade, ligado por padrão", () => {
  assert.equal(resolveHenryStyle({}).listenAck, "on");
  assert.equal(henryListenAckOn({}), true);
  assert.equal(henryListenAckOn({ listenAck: "off" }), false);
  assert.equal(henryListenAckOn({ listenAck: "talvez" }), true);
  assert.deepEqual(parseHenryStylePatch({ listenAck: "off" }), { ok: true, patch: { listenAck: "off" } });
  assert.equal(parseHenryStylePatch({ listenAck: false }).ok, false);
  assert.equal(mergeHenryStyle({ listenAck: "off" }, { tone: "executivo" }).listenAck, "off");
});

test("tela: confirma antes da transcrição, fila sem sobreposição, frases no cache da narração", () => {
  const ui = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  const server = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  const finish = ui.slice(ui.indexOf("const finishRecording = useCallback"), ui.indexOf('mode: "transcribe", audio, durationMs, deviceId'));
  assert.match(finish, /acknowledgeHeard\(/); // antes do fetch da transcrição
  assert.match(ui, /queue\.playing && queue\.narrating/); // a resposta espera só a confirmação terminar
  assert.match(ui, /speechQueueRef\.current\.playing && speechQueueRef\.current\.acking/); // o pedido não corta a confirmação
  assert.match(ui, /!isAckPhrase\(phrase\)/); // confirmações fora das frases de espera
  assert.match(server, /\[\.\.\.HENRY_ACK_ITEMS, \.\.\.HENRY_WAIT_PHRASES/);
});

// Dono, 2026-10-24: "quando eu peço uma música ele fala 'estou dando uma olhadinha'". Música → só som ou interjeição;
// sem texto (gravação, antes da transcrição) a frase sorteada é sempre neutra, nunca de verificação de dados.
test("música nunca ganha frase de verificação; sem texto só frase neutra", () => {
  for (const question of ["toca Legião Urbana", "coloca uma playlist de sertanejo", "quero ouvir um rock", "próxima música", "Henrique, toca Racionais"]) {
    assert.equal(henryAckContext({ question }), "music", question);
  }
  assert.equal(henryAckContext({ question: "quantas músicas tem na playlist" }), "data");
  for (let index = 0; index < 50; index += 1) {
    const music = pickListenAck({ context: "music", phrases, random: () => index / 50 });
    assert.ok(music.kind === "tone" || music.kind === "word", music.kind);
    const unknown = pickListenAck({ context: "unknown", phrases, random: seq(0.9, index / 50) });
    assert.equal(unknown.kind, "phrase");
    assert.ok(HENRY_ACK_ITEMS.find((item) => item.id === unknown.id).neutral, unknown.text);
    // Como chega do servidor/cache (sem o campo neutral): continua só neutra.
    const cached = pickListenAck({ context: "unknown", phrases: phrases.map(({ neutral: _neutral, ...rest }) => rest), random: seq(0.9, index / 50) });
    assert.ok(HENRY_ACK_ITEMS.find((item) => item.id === cached.id).neutral, cached.id);
  }
  const neutral = HENRY_ACK_ITEMS.filter((item) => item.neutral).map((item) => item.text);
  assert.deepEqual(neutral, ["Já te falo.", "Deixa comigo.", "Um segundinho."]);
});
