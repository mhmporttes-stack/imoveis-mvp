import assert from "node:assert/strict";
import test from "node:test";
import { isUsableContactName } from "../lib/contact-name.mjs";

test("nomes de verdade passam", () => {
  assert.equal(isUsableContactName("Maria"), true);
  assert.equal(isUsableContactName("  João da Silva  "), true);
  assert.equal(isUsableContactName("Ana"), true);
});

test("regra obrigatória: sem nome, vazio, espaços e placeholders nunca passam", () => {
  for (const value of [null, undefined, "", "   ", ".", "-", "0800", "123456789", "Sem Nome", "sem nome", "SEM NOME", "desconhecido", "N/A", "na", "Cliente", "teste", "Teste", "Cliente WhatsApp"]) {
    assert.equal(isUsableContactName(value), false, `deveria rejeitar: ${JSON.stringify(value)}`);
  }
});

test("nunca inventa nome: a função só diz sim/não, não transforma o valor", () => {
  assert.equal(isUsableContactName("maria"), true); // preserva capitalização — quem exibe decide, aqui só valida
});
