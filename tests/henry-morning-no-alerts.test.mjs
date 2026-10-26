// Bom dia sem avisos (REGRA OFICIAL — dono, 2026-10-26, docs/BUSINESS_RULES.md HENRY-1): "Ele não pode me avisar sobre
// os avisos se eu dei play no bom dia, para ele fazer apenas a cena do bom dia."
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MORNING_SESSION_BREATH_MS,
  MORNING_SESSION_MAX_MS,
  SPONTANEOUS_IDLE_MS,
  canSpeakSpontaneously,
  isMorningBlockedSpontaneous,
  morningSessionEnd,
  morningSessionFinishing,
  morningSessionHolds,
  morningSessionStart,
  nextSpontaneousItem
} from "../lib/henry-voice-conversation.mjs";

const ui = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");

test("sessão do bom dia ativa → canSpeakSpontaneously = false; terminou → volta", () => {
  const now = 500000;
  const idle = { phase: "idle", busyAt: now - SPONTANEOUS_IDLE_MS - 1, heardAt: 0, now };
  assert.equal(canSpeakSpontaneously({ ...idle, morningSession: true }), false);
  assert.equal(canSpeakSpontaneously({ ...idle, morningSession: false }), true);
  assert.equal(canSpeakSpontaneously(idle), true);
});

test("a sessão segura do play até o fim e, com tela cheia, mais um respiro de 60 s", () => {
  const t0 = 1000000;
  const session = morningSessionStart(t0);
  assert.equal(morningSessionHolds(session, { now: t0 + 30000 }), true);
  // Última resposta do bom dia: continua segurando até ele parar de falar.
  const finishing = morningSessionFinishing(session);
  assert.equal(finishing.finishing, true);
  assert.equal(morningSessionHolds(finishing, { now: t0 + 60000 }), true);
  const ended = morningSessionEnd(finishing, t0 + 90000);
  assert.equal(ended.active, false);
  // Tela cheia ainda aberta: respiro; fechou: libera na hora.
  assert.equal(morningSessionHolds(ended, { now: t0 + 90000 + 10000, fullscreen: true }), true);
  assert.equal(morningSessionHolds(ended, { now: t0 + 90000 + MORNING_SESSION_BREATH_MS, fullscreen: true }), false);
  assert.equal(morningSessionHolds(ended, { now: t0 + 90000 + 10000, fullscreen: false }), false);
  // Sem sessão / esquecida: nunca cala os avisos para sempre.
  assert.equal(morningSessionHolds(null), false);
  assert.equal(morningSessionHolds(session, { now: t0 + MORNING_SESSION_MAX_MS }), false);
});

test("na fila: avisos esperam; repetição da pergunta da música e 'tá tocando' (parte do bom dia) seguem", () => {
  assert.equal(isMorningBlockedSpontaneous("aviso"), true);
  assert.equal(isMorningBlockedSpontaneous("repetir_pergunta"), false);
  assert.equal(isMorningBlockedSpontaneous("spotify"), false);
  const queue = [{ kind: "aviso" }, { kind: "repetir_pergunta" }];
  assert.equal(nextSpontaneousItem(queue, { morningHold: true }).kind, "repetir_pergunta");
  assert.equal(nextSpontaneousItem([{ kind: "aviso" }], { morningHold: true }), null);
  assert.equal(nextSpontaneousItem(queue, { morningHold: false }).kind, "aviso");
});

test("ligação na tela: play abre a sessão, fila usa a trava e o fim da última resposta encerra", () => {
  assert.match(ui, /beginMorningSession\(\); \/\/ do play até o fim da cena/);
  assert.match(ui, /morningSessionHolds\(morningSessionRef\.current, \{ now, fullscreen: expandedRef\.current \}\)/);
  assert.match(ui, /nextSpontaneousItem\(fresh, \{ morningHold \}\)/);
  assert.match(ui, /if \(!nextMorning\?\.step\) morningSessionRef\.current = morningSessionFinishing/);
  // Chamado no ar quando o bom dia começa deixa de esperar resposta (o "pode" da música não vira "pode falar" do aviso).
  assert.match(ui, /alertRef\.current = \{ \.\.\.alert, stage: "idle", calls: 0 \}/);
  // Todo chamado de aviso passa pela fila espontânea (nenhum caminho direto que fure a trava).
  assert.equal(ui.match(/callForAlertNow\(/g)?.length, 1);
  assert.match(ui, /saySpontaneous\("aviso", \(\) => callForAlertNow\(options\)/);
});
