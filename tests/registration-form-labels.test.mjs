import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { FIRST_PROPERTY_OPTIONS, firstPropertyOptionValue, hasResidentialPropertyFromFirstPropertyOption } from "../lib/registration-form-labels.mjs";

// Bloco "Cadastro do cliente" (dono, 2026-10-19): "Primeiro imóvel" é só o rótulo invertido de has_residential_property.
test("Primeiro imóvel = Sim grava has_residential_property = false (e Não grava true)", () => {
  assert.equal(hasResidentialPropertyFromFirstPropertyOption("true"), false);
  assert.equal(hasResidentialPropertyFromFirstPropertyOption("false"), true);
  assert.equal(firstPropertyOptionValue(false), "true");
  assert.equal(firstPropertyOptionValue(true), "false");
  assert.equal(firstPropertyOptionValue(undefined), "");
  for (const stored of [true, false]) assert.equal(hasResidentialPropertyFromFirstPropertyOption(firstPropertyOptionValue(stored)), stored);
  assert.deepEqual(FIRST_PROPERTY_OPTIONS.map((option) => option.value), ["true", "false"]);
});

test("bloco do cadastro: só 'Cadastro do cliente', minimizado, rótulos curtos, botão no fim, mesmo campo gravado", () => {
  const generator = readFileSync(new URL("../components/SimulationGenerator.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(generator, /Ficha completa|Use estes campos para criar ou atualizar/);
  assert.match(generator, /useState\(\(\) => !initialSimulation\?\.registrationId\)/);
  assert.match(generator, /aria-expanded=\{registrationOpen\}/);
  for (const label of ["3 anos FGTS", "Dependentes", "Primeiro imóvel"]) assert.match(generator, new RegExp(`label="${label}"`));
  assert.match(generator, /updateRegistration\("hasResidentialProperty", hasResidentialPropertyFromFirstPropertyOption\(value\)\)/);
  const block = generator.slice(generator.indexOf("{registrationOpen ? ("));
  assert.ok(block.indexOf('label="Primeiro imóvel"') < block.indexOf("Atualizar cadastro"));
});
