import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { firstName, interpolate, matchTrigger } from "../lib/whatsapp-flow-core.mjs";

// Saudação do contato espontâneo (dono, 2026-10-09): "Boa tarde, Maria." / "Boa tarde." sem nome utilizável.
test("primeiro nome só quando parece nome de pessoa", () => {
  assert.equal(firstName("Maria da Silva"), "Maria");
  assert.equal(firstName("Cristiano @adsivar"), "Cristiano");
  assert.equal(firstName("Silene Costa 🥰🥰"), "Silene");
  assert.equal(firstName("G2f Corretora de Seguros"), "");
  assert.equal(firstName("😍😍"), "");
  assert.equal(firstName("+55 14 99999-0000"), "");
  assert.equal(firstName(""), "");
});

test("a frase sai sem nome sem deixar vírgula ou ponto sobrando", () => {
  const text = "{{saudacao}}, {{primeiro_nome}}.\nEm instantes, um dos meus associados dará início ao seu atendimento.";
  assert.equal(interpolate(text, { saudacao: "Boa tarde", primeiro_nome: "Maria" }), "Boa tarde, Maria.\nEm instantes, um dos meus associados dará início ao seu atendimento.");
  assert.equal(interpolate(text, { saudacao: "Boa tarde", primeiro_nome: "" }), "Boa tarde.\nEm instantes, um dos meus associados dará início ao seu atendimento.");
});

test("primeira mensagem dispara; equipe é filtrada no motor", () => {
  assert.equal(matchTrigger({ type: "first_message" }, { isFirstMessage: true }), true);
  assert.equal(matchTrigger({ type: "first_message" }, { isFirstMessage: false }), false);
  const flows = readFileSync(new URL("../lib/whatsapp-flows.js", import.meta.url), "utf8");
  assert.match(flows, /findInternalTeamPhone\(canonicalWhatsappPhone\(phone\)\)/);
});

// Sequência do anúncio (dono, 2026-10-10): mensagem que começa pelo nome, sem nome utilizável.
test("linha que começa pela variável vazia não fica com vírgula sobrando", () => {
  const text = "{{primeiro_nome}}, estou te enviando um link.";
  assert.equal(interpolate(text, { primeiro_nome: "Keite" }), "Keite, estou te enviando um link.");
  assert.equal(interpolate(text, { primeiro_nome: "" }), "Estou te enviando um link.");
  assert.equal(interpolate("{{saudacao}} {{primeiro_nome}}, tudo bem?", { saudacao: "Boa tarde", primeiro_nome: "" }), "Boa tarde, tudo bem?");
});
