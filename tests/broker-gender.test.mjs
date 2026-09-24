import test from "node:test";
import assert from "node:assert/strict";
import { buildBrokerGenderVars, normalizeGender } from "../lib/broker-gender.js";

test("feminino: cargo, nossa e artigo no feminino, por categoria", () => {
  assert.deepEqual(buildBrokerGenderVars({ gender: "female", role: "associate" }), { cargo_corretor: "associada", nosso_cargo: "nossa associada", o_a: "a", ele_ela: "ela" });
  assert.equal(buildBrokerGenderVars({ gender: "female", role: "broker" }).nosso_cargo, "nossa corretora");
  assert.equal(buildBrokerGenderVars({ gender: "female", role: "manager" }).cargo_corretor, "gestora");
});

test("masculino: cargo, nosso e artigo no masculino", () => {
  assert.deepEqual(buildBrokerGenderVars({ gender: "male", role: "broker" }), { cargo_corretor: "corretor", nosso_cargo: "nosso corretor", o_a: "o", ele_ela: "ele" });
});

test("sem sexo informado usa (a), nunca assume masculino", () => {
  const vars = buildBrokerGenderVars({ role: "associate" });
  assert.equal(vars.nosso_cargo, "nosso(a) associado(a)");
  assert.equal(vars.o_a, "o(a)");
  assert.equal(buildBrokerGenderVars(null).cargo_corretor, "corretor(a)");
});

test("normalizeGender só aceita male/female", () => {
  assert.equal(normalizeGender("Female"), "female");
  assert.equal(normalizeGender("outro"), "");
  assert.equal(normalizeGender(undefined), "");
});
