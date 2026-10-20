import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 2026-10-20: telas de erro do painel e do site — mensagem simples, sem detalhe técnico, com a marca atual.
for (const file of ["app/admin/error.jsx", "app/global-error.jsx"]) {
  test(`${file}: client component com Tentar de novo / Voltar ao início, sem expor o erro`, () => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /^"use client";/);
    assert.match(source, /reset\(\)/);
    assert.match(source, /Tentar de novo/);
    assert.match(source, /Voltar ao início/);
    assert.match(source, /console\.error\(/);
    assert.doesNotMatch(source, /error\.(message|stack|digest)/);
    assert.match(source, /\/assets\/matheus-machado-symbol\.png/);
  });
}

test("global-error traz o próprio html/body", () => {
  const source = readFileSync(new URL("../app/global-error.jsx", import.meta.url), "utf8");
  assert.match(source, /<html lang="pt-BR">/);
  assert.match(source, /<body /);
});
