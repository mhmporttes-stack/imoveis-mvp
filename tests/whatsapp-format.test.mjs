// Formatação do WhatsApp no Chat (2026-10-09).
import test from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseWhatsappText, stripWhatsappFormatting } from "../lib/whatsapp-format.mjs";

const types = (nodes) => nodes.map((n) => n.type);

test("negrito, itálico, tachado e combinados", () => {
  assert.deepEqual(parseInline("*Maria Eduarda Moreira*"), [{ type: "bold", children: [{ type: "text", text: "Maria Eduarda Moreira" }] }]);
  assert.deepEqual(types(parseInline("a _b_ ~c~ d")), ["text", "italic", "text", "strike", "text"]);
  const nested = parseInline("*_ambos_*");
  assert.equal(nested[0].type, "bold");
  assert.equal(nested[0].children[0].type, "italic");
});

test("não formata no meio da palavra, com espaço colado nem sem fechar", () => {
  assert.deepEqual(types(parseInline("arquivo_nome_x")), ["text"]);
  assert.deepEqual(types(parseInline("2 * 3 * 4")), ["text"]);
  assert.deepEqual(types(parseInline("*aberto sem fechar")), ["text"]);
  assert.deepEqual(types(parseInline("* item*")), ["text"]);
  assert.deepEqual(types(parseInline("**")), ["text"]);
});

test("monoespaçado, código, link com sublinhado intacto", () => {
  assert.deepEqual(types(parseInline("```bloco``` e `cod`")), ["mono", "text", "code"]);
  const link = parseInline("veja https://site.com/a_b_c ok");
  assert.deepEqual(types(link), ["text", "link", "text"]);
  assert.equal(link[1].href, "https://site.com/a_b_c");
});

test("citação, listas e prévia sem marcadores", () => {
  assert.deepEqual(parseWhatsappText("> citado\n- um\n* dois\n1. três").map((b) => b.type), ["quote", "bullet", "bullet", "numbered"]);
  assert.equal(stripWhatsappFormatting("*Maria*\nParcela _sim_"), "Maria\nParcela sim");
  assert.equal(parseWhatsappText("```a\nb```").length, 1);
});
