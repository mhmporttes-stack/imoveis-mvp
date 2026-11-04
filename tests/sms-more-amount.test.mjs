import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// "Carregar mais N" (dono, 2026-11-04): o servidor aceita de 1 a 200 por toque (padrão 50); a tela oferece 50/100/150/200.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("servidor: quantidade validada (1 a 200, padrão 50) e usada no extra do dia", () => {
  const source = read("lib/sms-batch.js");
  assert.match(source, /export function normalizeMoreAmount/);
  assert.match(source, /const next = extra \+ normalizeMoreAmount\(amount\)/);
  const route = read("app/api/admin/lote-sms/route.js");
  assert.match(route, /addSmsExtraBatch\(auth, body\.amount\)/);
});

test("tela: opções 50, 100, 150 e 200 e o botão mostra a quantidade escolhida", () => {
  const ui = read("components/SmsBatchWorkspace.jsx");
  assert.match(ui, /MORE_AMOUNTS = \[50, 100, 150, 200\]/);
  assert.match(ui, /amount: moreAmount/);
  assert.ok(!ui.includes("Carregar mais 50 contatos"));
});
