import test from "node:test";
import assert from "node:assert/strict";
import { currencyInputToNumber, formatCurrencyInput, wholeReaisFromCurrencyInput } from "../lib/property-filter-options.js";

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

// Estratégia com amortização (dono, 2026-10-18): reais inteiros com ",00" fixo, digitando tecla por tecla.
test("máscara com centavos fixos: 300 → R$ 300,00; 1000 → R$ 1.000,00", () => {
  const nb = (text) => text.replace(/\s/g, " ");
  const typeKeys = (keys) => {
    let field = "";
    // o cursor fica antes do ",00": cada tecla entra no fim dos reais
    for (const key of keys) field = formatCurrencyInput(String(wholeReaisFromCurrencyInput(field.replace(/,00$/, `${key},00`) || key)), { cents: true });
    return field;
  };
  assert.equal(nb(typeKeys("300")), "R$ 300,00");
  assert.equal(nb(typeKeys("1000")), "R$ 1.000,00");
  assert.equal(wholeReaisFromCurrencyInput("R$ 1.000,00"), 1000);
  assert.equal(wholeReaisFromCurrencyInput("R$ 300,005"), 3005); // digitou depois do ",00"
  assert.equal(wholeReaisFromCurrencyInput("R$ 300,0"), 30); // apagou um zero do ",00"
  assert.equal(wholeReaisFromCurrencyInput("R$ 30,00"), 30); // backspace antes do ",00"
  assert.equal(wholeReaisFromCurrencyInput(""), 0);
  assert.equal(wholeReaisFromCurrencyInput("7"), 7);
  // o filtro do site continua sem centavos
  assert.equal(nb(formatCurrencyInput("1000")), "R$ 1.000");
});
