import test from "node:test";
import assert from "node:assert/strict";
import { currencyInputToNumber, formatCurrencyInput } from "../lib/property-filter-options.js";

// Filtro de valor do site (bug 2026-10-15): digitar tecla por tecla não pode multiplicar o valor.
test("digitar 300000 tecla por tecla dá R$ 300.000", () => {
  let field = "";
  for (const key of "300000") field = formatCurrencyInput(field + key);
  assert.equal(field.replace(/\s/g, " "), "R$ 300.000");
  assert.equal(currencyInputToNumber(field), 300000);
});

test("apagar um dígito volta o valor certo", () => {
  const field = formatCurrencyInput("R$ 300.00");
  assert.equal(currencyInputToNumber(field), 30000);
  assert.equal(formatCurrencyInput(""), "");
});
