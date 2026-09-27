import assert from "node:assert/strict";
import test from "node:test";
import { buildRecipientVariables } from "../lib/whatsapp-broadcast-variables.mjs";

test("Disparo usa só o primeiro nome no {{1}} — não o nome completo do cadastro", () => {
  const mapping = { 1: { source: "contact_name" } };
  assert.deepEqual(buildRecipientVariables(mapping, { name: "DEIVID KAUAN SANTOS GONZAGA" }), { 1: "DEIVID" });
  assert.deepEqual(buildRecipientVariables(mapping, { name: "Maria da Silva" }), { 1: "Maria" });
  assert.deepEqual(buildRecipientVariables(mapping, { name: "Ana" }), { 1: "Ana" });
});

test("variável 'fixed' não é afetada; sem nome não quebra", () => {
  assert.deepEqual(buildRecipientVariables({ 1: { source: "fixed", value: "Equipe" } }, { name: "Qualquer Coisa" }), { 1: "Equipe" });
  assert.deepEqual(buildRecipientVariables({ 1: { source: "contact_name" } }, { name: "" }), { 1: "" });
  assert.deepEqual(buildRecipientVariables({ 1: { source: "contact_name" } }, {}), { 1: "" });
});

test("várias variáveis (ex.: {{1}} e {{2}}) recebem o mesmo primeiro nome quando ambas são do contato", () => {
  const mapping = { 1: { source: "contact_name" }, 2: { source: "contact_name" } };
  assert.deepEqual(buildRecipientVariables(mapping, { name: "João Pedro Alves" }), { 1: "João", 2: "João" });
});
