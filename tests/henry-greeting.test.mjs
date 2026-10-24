// Saudação pura ao Henry (dono, 2026-10-24: "Eu só falei boa noite, não era para ele analisar dados."): só responde o
// cumprimento — sem ferramentas, sem frase de espera, sem confirmação de escuta. Saudação + pedido segue o fluxo normal.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { henryGreetingRequest, isHenryGreeting } from "../lib/henry-voice-persona.mjs";
import { detectWakeWord } from "../lib/henry-voice-core.mjs";
import { shouldAcknowledgeHeard, shouldNarrate } from "../lib/henry-voice-narration.mjs";

test("saudação/cortesia pura é reconhecida", () => {
  for (const text of ["boa noite", "Henry, boa noite", "Boa noite, Henry!", "bom dia", "Boa tarde Henry, tudo bem?", "oi", "Olá, Henry", "e aí, tudo bem?", "tudo bem com você?", "obrigado Henry", "muito obrigado", "valeu", "tchau", "tchau Henry, até amanhã", "boa noite pra você também"]) {
    assert.equal(isHenryGreeting(text), true, text);
  }
});

test("saudação + pedido real, ou outra coisa, não é saudação pura", () => {
  for (const text of ["boa noite, quantos clientes novos?", "bom dia Henry, como está o funil?", "boa noite, me fala do Gabriel", "oi, abre a agenda", "obrigado, agora toca racionais", "quantos leads hoje", "sim", "Ei", "", "Henry"]) {
    assert.equal(isHenryGreeting(text), false, text);
  }
});

test("saudação pura não toca frase de espera nem confirmação de escuta", () => {
  const base = { now: 10000, startedAt: 1000, hasAudio: true };
  assert.equal(shouldNarrate(base), true);
  assert.equal(shouldNarrate({ ...base, quiet: true }), false);
  const heard = { enabled: true, heard: true };
  assert.equal(shouldAcknowledgeHeard(heard), true);
  assert.equal(shouldAcknowledgeHeard({ ...heard, greeting: true }), false);
});

test("servidor e tela: saudação pura nunca liga ferramentas nem narração", () => {
  const server = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  assert.match(server, /const greeting = !image && isHenryGreeting\(text\);/);
  assert.match(server, /const withTools = Boolean\(image\) \|\| \(!greeting && \(/);
  const screen = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(screen, /quiet: mode === "question" && isHenryGreeting\(question\)/);
  assert.match(screen, /quiet: wait\.quiet/);
  assert.match(screen, /greeting: mode === "question" && isHenryGreeting\(question\)/);
});

test("boa tarde/boa noite, Henry deixa de abrir o relatório; bom dia/olá, Henry continuam com o relatório (HENRY-1)", () => {
  for (const shown of ["Henry, boa noite", "boa noite, Henry", "Boa tarde, Henry", "boa noite", "boa noite Henry, tudo bem?"]) {
    assert.deepEqual(henryGreetingRequest({ mode: "report", question: "", shown }), { mode: "question", question: shown }, shown);
  }
  for (const shown of ["bom dia, Henry", "Olá, Henry", "oi Henry", "bom dia"]) {
    assert.deepEqual(henryGreetingRequest({ mode: "report", question: "", shown }), { mode: "report", question: "" }, shown);
  }
  assert.deepEqual(henryGreetingRequest({ mode: "question", question: "quantos leads hoje", shown: "boa noite Henry, quantos leads hoje" }), { mode: "question", question: "quantos leads hoje" });
  // o caminho real: "Henry, boa noite" é detectado como relatório e é desviado
  assert.equal(detectWakeWord("Henry, boa noite").kind, "report");
  const screen = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(screen, /let \{ mode, question \} = henryGreetingRequest\(request\);/);
  assert.match(screen, /henryGreetingRequest\(\{ mode: detectedMode, question: detectedQuestion, shown: text \}\)/);
});
