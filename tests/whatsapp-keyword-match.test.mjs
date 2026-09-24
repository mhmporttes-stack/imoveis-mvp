import test from "node:test";
import assert from "node:assert/strict";
import { keywordMatchesMessage, keywordTokens } from "../lib/whatsapp-keyword-match.mjs";

test('"sim" NÃO casa dentro de "simulação" / "assim" / "simples" / "simular"', () => {
  for (const text of ["Simulação", "quero fazer uma simulação", "Quero simular", "assim mesmo", "é simples", "similar"]) {
    assert.equal(keywordMatchesMessage(text, "sim"), false, text);
  }
});

test('"sim" casa como palavra inteira, com acento, caixa e pontuação livres', () => {
  for (const text of ["sim", "Sim!", "SIM ", "sím", "sim, quero", "pode ser sim 😀", "Eu quero, sim."]) {
    assert.equal(keywordMatchesMessage(text, "sim"), true, text);
  }
});

test('"não" e "nao" se equivalem, mas não casam dentro de outra palavra', () => {
  assert.equal(keywordMatchesMessage("Não", "não"), true);
  assert.equal(keywordMatchesMessage("nao, obrigado", "não"), true);
  assert.equal(keywordMatchesMessage("nacional", "não"), false);
});

test("palavra-chave com várias palavras exige a sequência inteira", () => {
  assert.equal(keywordMatchesMessage("Olá, boa noite!", "Olá boa noite"), true);
  assert.equal(keywordMatchesMessage("boa noite, olá", "olá boa noite"), false);
  assert.equal(keywordMatchesMessage("olá", "olá boa noite"), false);
});

test('a regra "Simulação" casa com "Simulação" (antes era engolida pela regra "sim")', () => {
  assert.equal(keywordMatchesMessage("Simulação", "Simulação"), true);
  assert.equal(keywordMatchesMessage("quero uma simulacao", "Simulação"), true);
});

test("entradas vazias nunca casam", () => {
  assert.equal(keywordMatchesMessage("", "sim"), false);
  assert.equal(keywordMatchesMessage("sim", ""), false);
  assert.equal(keywordMatchesMessage(null, "sim"), false);
  assert.deepEqual(keywordTokens("  !!! "), []);
});
