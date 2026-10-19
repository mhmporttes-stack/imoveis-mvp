// Simulador Caixa: o valor do imóvel acompanha o teto da faixa da renda enquanto não é digitado (dono, 2026-10-19).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INCOME_BANDS, bandForIncome } from "../lib/financiamento-estimativa-core.mjs";
import { simulate } from "../lib/caixa-simulator-core.mjs";

const ui = readFileSync(new URL("../components/CaixaSimulator.jsx", import.meta.url), "utf8");
const REF = "2026-10-19";
const money = (value) => `R$ ${Number(value).toLocaleString("pt-BR")}`;
const answers = (income) => ({ joint: "false", primaryMonthlyIncome: money(income), secondaryMonthlyIncome: "", oldestBirthDate: "1997-01-04", fgtsThreeYears: "true", dependents: "true", firstProperty: "true", propertyValue: "", downPayment: "", fgtsAvailable: "" });

test("o teto da faixa muda com a renda: R$ 235 mil / R$ 400 mil / R$ 600 mil", () => {
  assert.equal(bandForIncome(4500).propertyCap, 235000);
  assert.equal(bandForIncome(6000).propertyCap, 400000);
  assert.equal(bandForIncome(11000).propertyCap, 600000);
  assert.equal(INCOME_BANDS.at(-1).propertyCap, 600000);
});

test("com o valor do teto da faixa o motor usa esse valor (não os R$ 235 mil de sempre)", () => {
  for (const [income, cap, faixa] of [[4500, 235000, "Faixa 2"], [6000, 400000, "Faixa 3"], [11000, 600000, "Faixa 4"]]) {
    const result = simulate({ ...answers(income), propertyValue: money(bandForIncome(income).propertyCap) }, REF);
    assert.equal(result.eligible, true, `${income}`);
    assert.equal(result.propertyValue, cap, `${income}`);
    assert.match(result.faixa, new RegExp(faixa));
  }
  // sem valor (como era antes), a renda de R$ 6.000 ficava em R$ 235 mil
  assert.equal(simulate(answers(6000), REF).propertyValue, 235000);
});

test("tela: enquanto não digita, o campo e o motor usam o teto da faixa; digitado vale o digitado; o voto leva o valor efetivo", () => {
  assert.ok(ui.includes("const autoPropertyValue = formatCurrencyInput(String(bandCap || DEFAULT_PROPERTY_VALUE));"));
  assert.ok(ui.includes("const propertyFieldValue = answers.propertyValue || autoPropertyValue;"));
  assert.ok(ui.includes("propertyValue: answers.propertyValue || (bandCap ? autoPropertyValue : \"\")"));
  assert.ok(ui.includes("simulate(effectiveAnswers, todayInSaoPaulo())"));
  assert.ok(ui.includes("send(\"POST\", { vote: value, answers: effectiveAnswers })"));
  assert.ok(ui.includes("Teto da faixa (automático)"));
  assert.ok(ui.indexOf("const bandCap") < ui.indexOf("const effectiveAnswers") && ui.indexOf("const effectiveAnswers") < ui.indexOf("const result = useMemo"));
});
