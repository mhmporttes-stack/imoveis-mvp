import test from "node:test";
import assert from "node:assert/strict";
import { buildInternalPhoneIndex, findInternalPhone } from "../lib/internal-phones-core.mjs";

// Telefones sintéticos.
const index = buildInternalPhoneIndex([
  { userId: "u-corretor", name: "Corretor A", phone: "14 99999-0001" },
  { userId: "u-gestor", name: "Gestor", phone: "+55 (14) 98888-0002" },
  { userId: "u-sessao", name: "Corretor B", phone: "5514977770003" },
  { userId: "u-vazio", name: "Sem telefone", phone: "" },
  { userId: "u-curto", name: "Incompleto", phone: "1234" }
]);

test("acha integrante da equipe por qualquer formato do mesmo telefone", () => {
  assert.equal(findInternalPhone(index, "5514999990001")?.userId, "u-corretor");
  assert.equal(findInternalPhone(index, "+5514988880002")?.userId, "u-gestor");
  assert.equal(findInternalPhone(index, "(14) 97777-0003")?.userId, "u-sessao");
});

test("9º dígito: número salvo sem o 9 casa com o WhatsApp que chega com o 9", () => {
  const legacy = buildInternalPhoneIndex([{ userId: "u", name: "X", phone: "1499990004" }]);
  assert.equal(findInternalPhone(legacy, "5514999990004")?.userId, "u");
});

test("cliente comum não é interno; nome nunca entra na comparação", () => {
  assert.equal(findInternalPhone(index, "5514911112222"), null);
  assert.equal(findInternalPhone(index, ""), null);
  assert.equal(findInternalPhone(index, "Corretor A"), null);
});

test("telefone vazio ou incompleto no cadastro nunca casa com ninguém", () => {
  assert.equal(findInternalPhone(index, "1234"), null);
  assert.equal(index.size, 3);
});
