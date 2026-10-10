import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAdPrefillText } from "../lib/whatsapp-referral.mjs";

// Caso Luana (2026-10-10): 1ª mensagem do anúncio chegou sem referral e só a saudação espontânea saiu.
test("texto pré-preenchido do anúncio conta como clique no anúncio", () => {
  assert.equal(isAdPrefillText("Olá! Posso ter mais informações sobre isso?"), true);
  assert.equal(isAdPrefillText("Olá! Vi o anúncio e quero fazer a simulação do meu financiamento."), true);
  assert.equal(isAdPrefillText("ola posso saber mais informacoes sobre isto"), true);
  assert.equal(isAdPrefillText("Link:\n\n\nOlá! Posso ter mais informações sobre isso?"), true);
});

test("mensagem comum não vira anúncio", () => {
  assert.equal(isAdPrefillText("Olá, boa tarde"), false);
  assert.equal(isAdPrefillText("Quero saber mais informações sobre isso, tenho renda de 3 mil e moro de aluguel. Olá! Posso ter mais informações sobre isso?"), false);
  assert.equal(isAdPrefillText(""), false);
});

test("motor usa o texto só na 1ª mensagem textual", () => {
  const flows = readFileSync(new URL("../lib/whatsapp-flows.js", import.meta.url), "utf8");
  assert.match(flows, /hasReferral: Boolean\(message\.referral\) \|\| \(isFirstMessage && isTextual && isAdPrefillText\(text\)\)/);
});
