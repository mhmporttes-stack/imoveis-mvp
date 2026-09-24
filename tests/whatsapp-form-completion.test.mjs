import test from "node:test";
import assert from "node:assert/strict";
import {
  FORM_COMPLETION_MESSAGE,
  filterFlowsForPostFormContact,
  isFormCompletionFlowTrigger,
  isFormCompletionMessage,
  shouldSuppressKeywordReply
} from "../lib/whatsapp-form-completion.mjs";

const flow = (name, trigger) => ({ name, published_trigger: trigger });
const dedicated = flow("Formulário concluído", { type: "keyword", keywords: ["preenchi meu cadastro", "receber a minha simulação", "receber minha simulação"], match: "contains" });
const keywordSim = flow("Palavra-chave: simulação", { type: "keyword", keywords: ["simulação"], match: "contains" });
const menu = flow("Menu principal", { type: "any_message" });
const first = flow("Boas-vindas", { type: "first_message" });
const ad = flow("Anúncio", { type: "ad_referral" });
const all = [dedicated, keywordSim, menu, first, ad];

test("a mensagem do botão da tela final é reconhecida", () => {
  assert.equal(isFormCompletionMessage(FORM_COMPLETION_MESSAGE), true);
  assert.equal(isFormCompletionMessage("Olá, PREENCHI meu cadastro!!"), true);
});

test("outras mensagens (inclusive sobre simulação) não são pós-formulário", () => {
  for (const text of ["Quero fazer uma simulação", "Simulação", "sim", "oi", "", null]) assert.equal(isFormCompletionMessage(text), false, String(text));
});

test("só o fluxo dedicado é reconhecido como pós-formulário", () => {
  assert.equal(isFormCompletionFlowTrigger(dedicated.published_trigger), true);
  for (const item of [keywordSim, menu, first, ad]) assert.equal(isFormCompletionFlowTrigger(item.published_trigger), false, item.name);
});

test("mensagem pós-formulário: só o fluxo dedicado pode rodar (menu, boas-vindas e palavra-chave 'simulação' não)", () => {
  assert.deepEqual(filterFlowsForPostFormContact(all, { isFormMessage: true }), [dedicated]);
  assert.deepEqual(filterFlowsForPostFormContact([menu, first, keywordSim], { isFormMessage: true }), []);
});

test("cliente que acabou de preencher o formulário: gatilhos automáticos não disparam, palavra-chave sim", () => {
  assert.deepEqual(filterFlowsForPostFormContact(all, { recentForm: true }), [dedicated, keywordSim]);
});

test("cliente comum: nada muda", () => {
  assert.deepEqual(filterFlowsForPostFormContact(all, {}), all);
});

test("resposta antiga por palavra-chave é suprimida no pós-formulário e para cadastro recente", () => {
  assert.equal(shouldSuppressKeywordReply({ isFormMessage: true }), true);
  assert.equal(shouldSuppressKeywordReply({ recentForm: true }), true);
  assert.equal(shouldSuppressKeywordReply({}), false);
});
