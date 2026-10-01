import test from "node:test";
import assert from "node:assert/strict";
import { buildGoogleContactName } from "../lib/google-contacts-name.mjs";

// Pedido do dono (2026-10-01): no Google Contacts o contato é salvo como
// "Cliente {nome completo}", sem nunca duplicar o prefixo; o nome no CRM
// não muda (a função só monta o texto enviado ao Google).

test("adiciona o prefixo Cliente ao nome completo", () => {
  assert.equal(buildGoogleContactName("Fabiane Silva"), "Cliente Fabiane Silva");
  assert.equal(buildGoogleContactName("Roberto Santos"), "Cliente Roberto Santos");
});

test("não duplica o prefixo quando o nome já começa com Cliente", () => {
  assert.equal(buildGoogleContactName("Cliente Fabiane Silva"), "Cliente Fabiane Silva");
  assert.equal(buildGoogleContactName("cliente   Fabiane Silva"), "Cliente Fabiane Silva");
  assert.equal(buildGoogleContactName("Cliente Cliente Fabiane Silva"), "Cliente Fabiane Silva");
  assert.equal(buildGoogleContactName(buildGoogleContactName("Roberto Santos")), "Cliente Roberto Santos");
});

test("normaliza espaços sem alterar o nome em si", () => {
  assert.equal(buildGoogleContactName("  Ana   Maria  de Souza "), "Cliente Ana Maria de Souza");
  assert.equal(buildGoogleContactName("Clientela Ltda"), "Cliente Clientela Ltda");
});

test("sem nome, usa o telefone (comportamento anterior) com o prefixo", () => {
  assert.equal(buildGoogleContactName("", "+5514900000001"), "Cliente +5514900000001");
  assert.equal(buildGoogleContactName(null, "+5514900000001"), "Cliente +5514900000001");
  assert.equal(buildGoogleContactName("Cliente", "+5514900000001"), "Cliente +5514900000001");
  assert.equal(buildGoogleContactName("Cliente"), "Cliente");
});

test("não altera o valor recebido (nome do CRM)", () => {
  const crmName = "Fabiane Silva";
  buildGoogleContactName(crmName);
  assert.equal(crmName, "Fabiane Silva");
});
