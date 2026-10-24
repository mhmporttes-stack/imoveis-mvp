// Saudação pura ao Henry (dono, 2026-10-24: "Eu só falei boa noite, não era para ele analisar dados."): só responde o
// cumprimento — sem ferramentas, sem frase de espera, sem confirmação de escuta. Saudação + pedido segue o fluxo normal.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isHenryGreeting } from "../lib/henry-voice-persona.mjs";
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
