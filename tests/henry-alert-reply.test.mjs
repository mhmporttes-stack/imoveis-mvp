// Resposta ao aviso do Henry (incidente do dono, 2026-10-24): "eu tenho um aviso, posso te falar agora?" →
// "sim, pode me falar, qual é esse aviso?" → "não tenho nenhum aviso, deixa eu procurar no CRM".
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ALERT_FOLLOWUP_MS,
  HENRY_ALERT_MEMORY_MARK,
  HENRY_ALERT_PHRASES,
  buildHenryAlertNote,
  classifyAlertAnswer,
  decideAlertReply,
  henryAlertFixedPhrases,
  henryAlertNoteState,
  isAlertFollowUp,
  isExplicitAlertYes,
  isHenryAlertPhrase
} from "../lib/henry-voice-client-alerts-core.mjs";
import { buildHenryDynamicPrompt } from "../lib/henry-voice-persona.mjs";

const NOW = Date.parse("2026-10-24T15:00:00Z");
const CALLED = NOW - 60 * 1000;

const LONG_YES = [
  "sim, pode me falar, qual é esse aviso?",
  "Sim pode me falar qual é esse aviso",
  "pode falar, qual é o aviso?",
  "fala aí, manda o aviso",
  "pode me contar, tô ouvindo",
  "oi Henry, pode falar sim, qual é?",
  "manda ver, qual é o recado?"
];
const FOLLOW_UPS = ["qual o aviso?", "qual é esse aviso?", "o que era?", "o que você ia me falar?", "Henry, qual era o aviso?", "e o aviso?"];

test("frase longa de aceite durante o chamado = entrega o aviso guardado", () => {
  for (const text of LONG_YES) {
    assert.equal(classifyAlertAnswer(text), "yes", text);
    assert.equal(decideAlertReply(text, { stage: "waiting", hasPending: true, now: NOW }), "tell", text);
    assert.equal(decideAlertReply(text, { stage: "calling", hasPending: true, now: NOW }), "tell", text);
  }
});

test("pergunta pelo aviso depois do chamado também entrega", () => {
  for (const text of FOLLOW_UPS) {
    assert.ok(isAlertFollowUp(text), text);
    assert.equal(decideAlertReply(text, { stage: "waiting", hasPending: true, now: NOW }), "tell", text);
    // pendente com indicador (o chamado já acabou): continua entregando
    assert.equal(decideAlertReply(text, { stage: "idle", hasPending: true, calledAt: CALLED, now: NOW }), "tell", text);
    assert.equal(decideAlertReply(text, { stage: "idle", hasPending: true, calledAt: 0, now: NOW }), "tell", text);
  }
});

test("aceite com o aviso no indicador: vale logo depois do chamado, não horas depois", () => {
  assert.equal(decideAlertReply("sim, pode falar", { stage: "idle", hasPending: true, calledAt: CALLED, now: NOW }), "tell");
  assert.equal(decideAlertReply("sim, pode falar", { stage: "idle", hasPending: true, calledAt: NOW - ALERT_FOLLOWUP_MS - 1000, now: NOW }), "pass");
  // outra pergunta dele em aberto (bom dia, aniversário): o "sim" é dela
  assert.equal(decideAlertReply("sim", { stage: "idle", hasPending: true, calledAt: CALLED, otherQuestion: true, now: NOW }), "pass");
  assert.equal(decideAlertReply("qual é o aviso?", { stage: "idle", hasPending: true, calledAt: CALLED, otherQuestion: true, now: NOW }), "tell");
});

test("aviso que não pode mais ser entregue = 'já foi resolvido', nunca procurar no CRM", () => {
  assert.equal(decideAlertReply("sim, pode me falar, qual é esse aviso?", { stage: "waiting", hasPending: false, now: NOW }), "resolved");
  assert.equal(decideAlertReply("qual é esse aviso?", { stage: "idle", hasPending: false, calledAt: CALLED, now: NOW }), "resolved");
  assert.equal(decideAlertReply("qual é esse aviso?", { stage: "idle", hasPending: false, calledAt: 0, now: NOW }), "pass");
  assert.ok(HENRY_ALERT_PHRASES.resolved.length >= 5);
  for (const phrase of HENRY_ALERT_PHRASES.resolved) {
    assert.ok(isHenryAlertPhrase(phrase));
    assert.ok(henryAlertFixedPhrases().includes(phrase));
    assert.match(phrase, /resolvido/);
  }
});

test("negativa e pedido de outra coisa continuam como antes", () => {
  for (const text of ["agora não", "depois", "não, depois me fala o aviso", "tô em reunião"]) {
    assert.notEqual(decideAlertReply(text, { stage: "waiting", hasPending: true, now: NOW }), "tell", text);
    assert.equal(decideAlertReply(text, { stage: "idle", hasPending: true, calledAt: CALLED, now: NOW }), "pass", text);
  }
  assert.equal(decideAlertReply("agora não", { stage: "waiting", hasPending: true, now: NOW }), "later");
  assert.equal(decideAlertReply("quantos leads entraram hoje no total", { stage: "waiting", hasPending: true, now: NOW }), "pass");
  assert.equal(decideAlertReply("sim, mas quantos clientes entraram hoje", { stage: "waiting", hasPending: true, now: NOW }), "pass");
  assert.equal(decideAlertReply("quantos clientes entraram hoje", { stage: "idle", hasPending: true, calledAt: CALLED, now: NOW }), "pass");
  assert.equal(isExplicitAlertYes("o que tem hoje"), false);
  assert.equal(decideAlertReply("hmm", { stage: "waiting", hasPending: true, now: NOW }), "noise");
});

test("o modelo sabe do aviso guardado/resolvido (nunca 'não tenho aviso')", () => {
  assert.equal(henryAlertNoteState({ hasPending: true, now: NOW }), "pending");
  assert.equal(henryAlertNoteState({ hasPending: false, calledAt: CALLED, now: NOW }), "resolved");
  assert.equal(henryAlertNoteState({ hasPending: false, calledAt: 0, now: NOW }), "");
  const pending = buildHenryAlertNote("pending");
  assert.ok(pending.startsWith(HENRY_ALERT_MEMORY_MARK));
  assert.match(pending, /Nunca diga que não tem aviso/);
  assert.match(buildHenryAlertNote("resolved"), /já foi resolvido/);
  assert.equal(buildHenryAlertNote(""), "");
  assert.equal(buildHenryAlertNote("qualquer"), "");
  const prompt = buildHenryDynamicPrompt({ todayKey: "2026-10-24", alertNote: pending });
  assert.ok(prompt.includes(pending));
});

test("todos os caminhos passam pela mesma decisão (fala contínua, aperte-para-falar, digitado, desktop)", () => {
  const source = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(source, /decideAlertReply\(/);
  // ask (aperte-para-falar, gravação, digitado, app de desktop) e handleFinal (fala contínua) consultam o aviso
  assert.match(source, /if \(mode === "question" && alertAnswerRef\.current\(question\)\) return;/);
  assert.match(source, /if \(alertAnswerRef\.current\(text, \{ direct:/);
  // o pedido ao modelo leva o estado do aviso
  assert.match(source, /alertState: alertNoteState/);
  const route = readFileSync(new URL("../app/api/admin/henry/route.js", import.meta.url), "utf8");
  assert.match(route, /alertState === "pending" \|\| body\?\.alertState === "resolved"/);
});
