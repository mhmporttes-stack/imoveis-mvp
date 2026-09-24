import test from "node:test";
import assert from "node:assert/strict";
import { buildBrokerGenderVars, normalizeGender } from "../lib/broker-gender.js";

test("com CRECI: corretor/corretora, nosso/nossa e artigo conforme o gênero", () => {
  assert.deepEqual(buildBrokerGenderVars({ gender: "female", hasCreci: true }), { cargo_corretor: "corretora", nosso_cargo: "nossa corretora", o_a: "a", ele_ela: "ela" });
  assert.deepEqual(buildBrokerGenderVars({ gender: "male", hasCreci: true }), { cargo_corretor: "corretor", nosso_cargo: "nosso corretor", o_a: "o", ele_ela: "ele" });
});

test("sem CRECI: sempre associado(a) do corretor Matheus Machado, qualquer categoria", () => {
  assert.equal(buildBrokerGenderVars({ gender: "female", hasCreci: false, role: "broker" }).cargo_corretor, "associada do corretor Matheus Machado");
  assert.equal(buildBrokerGenderVars({ gender: "male", role: "manager" }).nosso_cargo, "nosso associado do corretor Matheus Machado");
  assert.equal(buildBrokerGenderVars({ gender: "female", role: "associate" }).nosso_cargo, "nossa associada do corretor Matheus Machado");
});

test("sem sexo informado usa (a), nunca assume masculino", () => {
  assert.equal(buildBrokerGenderVars({ hasCreci: true }).nosso_cargo, "nosso(a) corretor(a)");
  assert.equal(buildBrokerGenderVars({}).cargo_corretor, "associado(a) do corretor Matheus Machado");
  assert.equal(buildBrokerGenderVars(null).o_a, "o(a)");
});

test("normalizeGender só aceita male/female", () => {
  assert.equal(normalizeGender("Female"), "female");
  assert.equal(normalizeGender("outro"), "");
  assert.equal(normalizeGender(undefined), "");
});
