// O histórico/jornada do cliente abre POR CIMA da ficha do cliente (2026-10-06).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const code = readFileSync(new URL("../components/ClientJourneyActions.jsx", import.meta.url), "utf8");

test("o modal de histórico é um <dialog> nativo aberto com showModal (camada de topo, acima da ficha)", () => {
  assert.ok(code.includes("<dialog ref={openAsModal}"));
  assert.ok(code.includes("node.showModal()"));
  assert.ok(code.includes("</dialog>,"));
  assert.ok(!code.includes('role="dialog" aria-modal="true" aria-label="Jornada e histórico"'), "não pode voltar a ser um div fixo");
});

test("fechar: botão, Esc (evento nativo close) e clique no fundo", () => {
  assert.ok(code.includes("onClose={() => setOpen(false)}"));
  assert.ok(code.includes("event.target === event.currentTarget"));
  assert.ok(code.includes('aria-label="Fechar histórico" onClick={() => setOpen(false)}'));
});
