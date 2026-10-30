import test from "node:test";
import assert from "node:assert/strict";
import { classifyClosingMessage, defaultClosingConfig, isClosingMessage, normalizeClosingText, resolveClosingConfig, sanitizePhraseList } from "../lib/chat-closing-message-core.mjs";

// WA-38: aba "Sem resposta" ignora encerramento curto e negativa na última mensagem do cliente.
const config = defaultClosingConfig();

test("normaliza: minúsculas, sem acento, sem pontuação, letras repetidas", () => {
  assert.equal(normalizeClosingText("Obrigadaaa!!! 🙏"), "obrigada");
  assert.equal(normalizeClosingText("Tá BOM."), "ta bom");
  assert.equal(normalizeClosingText("Blzz"), "blz");
  assert.equal(normalizeClosingText("👍"), "");
});

test("encerramentos curtos saem da aba", () => {
  for (const text of ["ok", "Ok", "Obrigada", "obrigado!", "Blz", "Blzz", "👍", "🙏🏼🙏🏼", "☺️😘", "Combinado, obrigada", "Ok muito obrigada tá", "kkkkk", "Boa tarde Sair", "Sair", "Entendi", "Magina", "Amém", "[Figurinha]", "Tá bom"]) {
    assert.equal(classifyClosingMessage(text, config), "closing", text);
  }
});

test("negativas que não seguem em atendimento saem da aba", () => {
  for (const text of ["Não tenho interesse", "Bom dia, no momento não tenho interesse", "Não tenho interesse em imóvel ou em comprar nd.", "Já comprei", "bom dia comprei um imovel ja mas obrigado", "Pare de mandar mensagem", "Não quero mais", "Boa tarde número errado não é da Glicélia aqui"]) {
    assert.notEqual(classifyClosingMessage(text, config), "", text);
  }
});

test("continua na aba: perguntas, cumprimentos, respostas com conteúdo", () => {
  for (const text of ["ok, mas qual o valor?", "Ok mas qual o valor", "Bom dia", "Oi", "Boa tarde", "Sim", "Não", "?", "Qual valor seria", "Não quero perder essa oportunidade", "a gente ja ia sair", "[Áudio]", "[Imagem]", "Obrigada, me manda as fotos", "Não tenho interesse nesse, tem outro?", "Ainda não tenho 18 mil de entrada", ""]) {
    assert.equal(isClosingMessage(text, config), false, text);
  }
});

test("lista editável: config salva substitui o padrão", () => {
  const custom = resolveClosingConfig({ closing: ["Fechou!"], negative: [] });
  assert.equal(classifyClosingMessage("fechou", custom), "closing");
  assert.equal(classifyClosingMessage("ok", custom), "");
  assert.equal(classifyClosingMessage("👍", custom), "closing");
  assert.deepEqual(resolveClosingConfig(null), config);
  assert.deepEqual(sanitizePhraseList("Ok\n ok \n\nObrigado"), ["ok", "obrigado"]);
});
