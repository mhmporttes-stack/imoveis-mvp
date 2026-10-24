// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] Campos de valor do formulário: reais inteiros com ",00" fixo ("deixe ali
// vírgula e 00 na frente"). Antes "3800" virava "R$ 38,00" (máscara pelos centavos).
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";

// lib/*.js usa import sem extensão (padrão do Next): o hook resolve para Node puro.
register("data:text/javascript," + encodeURIComponent(`
  import { existsSync } from "node:fs";
  import { fileURLToPath } from "node:url";
  const ROOT = ${JSON.stringify(new URL("..", import.meta.url).href)};
  export async function resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) specifier = new URL(specifier.slice(2), ROOT).href;
    if ((specifier.startsWith(".") || specifier.startsWith("file:")) && !/\\.[cm]?js$/.test(specifier)) {
      const url = new URL(specifier, context.parentURL);
      if (existsSync(fileURLToPath(url) + ".js")) return next(url.href + ".js", context);
    }
    return next(specifier, context);
  }
`));

const { formatWholeReaisInput, wholeReaisCaretPosition } = await import("../lib/whole-reais-input.mjs");
const { parseCurrencyNumber, validateStepValue } = await import("../lib/simulation-registration-format.js");

const norm = (text) => text.replace(/ /g, " ");
const fmt = (raw) => norm(formatWholeReaisInput(raw));

test("cliente digita reais inteiros e o campo mostra ,00 fixo", () => {
  assert.equal(fmt("3800"), "R$ 3.800,00");
  assert.equal(fmt("7500"), "R$ 7.500,00");
  assert.equal(fmt(""), "R$ 0,00");
  assert.equal(fmt("1"), "R$ 1,00");
});

test("digitando no campo já formatado (cursor antes da vírgula ou no fim)", () => {
  // cursor antes da vírgula: "R$ 7.500" + "1" + ",00"
  assert.equal(fmt("R$ 7.5001,00"), "R$ 75.001,00");
  // cursor no fim: o dígito depois do ",00" entra nos reais
  assert.equal(fmt("R$ 7.500,001"), "R$ 75.001,00");
  // a partir do valor inicial "R$ 0,00" (valor disponível)
  assert.equal(fmt("R$ 05,00"), "R$ 5,00");
  assert.equal(fmt("R$ 0,005"), "R$ 5,00");
});

test("apagar tira o último dígito dos reais, nunca os centavos fixos", () => {
  assert.equal(fmt("R$ 7.50,00"), "R$ 750,00", "backspace antes da vírgula");
  assert.equal(fmt("R$ 7.500,0"), "R$ 750,00", "backspace no fim");
  assert.equal(fmt("R$ ,00"), "R$ 0,00");
});

test("valor gravado é o mesmo número digitado (3800 → 3800.00) e a regra renda ≥ R$ 1.000 não muda", () => {
  assert.equal(parseCurrencyNumber(formatWholeReaisInput("3800")), 3800);
  assert.equal(parseCurrencyNumber(formatWholeReaisInput("R$ 7.500,001")), 75001);
  assert.equal(parseCurrencyNumber(formatWholeReaisInput("0")), 0);
  const step = { id: "primaryMonthlyIncome", kind: "currency" };
  assert.ok(validateStepValue(step, { primaryMonthlyIncome: formatWholeReaisInput("999") }), "R$ 999,00 continua recusado");
  assert.equal(validateStepValue(step, { primaryMonthlyIncome: formatWholeReaisInput("1000") }), "");
});

test("cursor fica antes da vírgula", () => {
  const text = formatWholeReaisInput("7500");
  assert.equal(text.slice(wholeReaisCaretPosition(text)), ",00");
});

test("o campo do formulário usa a máscara de reais inteiros", () => {
  const source = readFileSync(new URL("../components/simulation-form/CurrencyInputStep.jsx", import.meta.url), "utf8");
  assert.match(source, /formatWholeReaisInput\(event\.target\.value\)/);
  assert.ok(!source.includes("formatCurrencyFromDigits"), "não volta para a máscara pelos centavos");
});
