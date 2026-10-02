import test from "node:test";
import assert from "node:assert/strict";
import { APPROVED_AUTO_MESSAGES, AUTO_MESSAGE_MAX_VARIANTS, unknownAutoMessageVariables } from "../lib/daily-goal-auto-messages.mjs";
import { hasUnresolvedVariable, normalizeAutoMessageTemplate, renderAutoMessage } from "../lib/daily-goal-auto-core.mjs";

// Modelos aprovados pelo dono (2026-10-02) e variáveis. Nomes sintéticos.

test("quantidade de modelos: 1ª = 4, 2ª = 4, 3ª = 10, todos preenchidos e dentro do limite", () => {
  assert.equal(APPROVED_AUTO_MESSAGES.message1.length, 4);
  assert.equal(APPROVED_AUTO_MESSAGES.message2.length, 4);
  assert.equal(APPROVED_AUTO_MESSAGES.message3.length, 10);
  for (const [key, list] of Object.entries(APPROVED_AUTO_MESSAGES)) {
    assert.ok(list.length <= AUTO_MESSAGE_MAX_VARIANTS[key]);
    for (const text of list) {
      assert.ok(text.trim().length > 10, `${key} vazio`);
      assert.deepEqual(unknownAutoMessageVariables(text), [], text);
      assert.ok(text.startsWith("{saudacao} {primeiro_nome},"), "formato 'Bom dia Nome,' sem vírgula depois da saudação");
    }
    assert.equal(new Set(list).size, list.length, `${key}: modelos repetidos`);
  }
});

test("{saudacao} {primeiro_nome}: 'Bom dia Matheus, tudo bem?' — nunca 'Bom dia, Matheus'", () => {
  const text = renderAutoMessage(APPROVED_AUTO_MESSAGES.message1[0], { saudacao: "Bom dia", primeiroNome: "Matheus" });
  assert.equal(text, "Bom dia Matheus, tudo bem?");
  assert.equal(renderAutoMessage(APPROVED_AUTO_MESSAGES.message1[0], { saudacao: "Boa noite", primeiroNome: "Ana" }), "Boa noite Ana, tudo bem?");
});

test("{associado_a} pelo gênero cadastrado; sem gênero, frase neutra (nunca inferido pelo nome)", () => {
  const [model1, model2] = APPROVED_AUTO_MESSAGES.message2;
  const female = renderAutoMessage(model1, { saudacao: "Boa tarde", primeiroNome: "Ana", nomeCorretor: "Bruna", corretorGender: "female" });
  assert.match(female, /^Boa tarde Ana, tudo bem\? Meu nome é Bruna, sou associada do corretor Matheus Machado\./);
  const male = renderAutoMessage(model2, { saudacao: "Bom dia", primeiroNome: "Ana", nomeCorretor: "Eduardo", corretorGender: "male" });
  assert.match(male, /Meu nome é Eduardo e sou associado do corretor Matheus Machado\./);
  // "Andrea" (nome que poderia enganar) sem gênero cadastrado: não infere.
  const neutral1 = renderAutoMessage(model1, { saudacao: "Bom dia", primeiroNome: "Ana", nomeCorretor: "Andrea", corretorGender: "" });
  assert.match(neutral1, /Meu nome é Andrea, faço parte da equipe do corretor Matheus Machado\./);
  const neutral2 = renderAutoMessage(model2, { saudacao: "Bom dia", primeiroNome: "Ana", nomeCorretor: "Andrea", corretorGender: null });
  assert.match(neutral2, /Meu nome é Andrea e faço parte da equipe do corretor Matheus Machado\./);
  assert.ok(female.includes("\n\nHoje somos especialistas"), "parágrafo preservado");
});

test("todos os modelos aprovados saem sem nenhuma variável sobrando", () => {
  for (const list of Object.values(APPROVED_AUTO_MESSAGES)) {
    for (const template of list) {
      for (const corretorGender of ["male", "female", ""]) {
        const text = renderAutoMessage(template, { saudacao: "Boa tarde", primeiroNome: "Ana", nomeCorretor: "Luan", corretorGender });
        assert.equal(hasUnresolvedVariable(text), false, text);
      }
    }
  }
});

test("variável desconhecida é detectada (não sai para o cliente e é recusada ao salvar)", () => {
  assert.deepEqual(unknownAutoMessageVariables("{saudacao} {primeiro_nom}, oi"), ["primeiro_nom"]);
  assert.equal(hasUnresolvedVariable("Bom dia {nome}, oi"), true);
  assert.equal(hasUnresolvedVariable("Bom dia Ana, oi"), false);
});

test("salvar pela tela mantém os parágrafos e limpa espaços", () => {
  assert.equal(normalizeAutoMessageTemplate("  Oi  {primeiro_nome}?\r\n\r\n\r\nHoje   temos  "), "Oi {primeiro_nome}?\n\nHoje temos");
  assert.equal(normalizeAutoMessageTemplate(APPROVED_AUTO_MESSAGES.message2[0]), APPROVED_AUTO_MESSAGES.message2[0]);
});
