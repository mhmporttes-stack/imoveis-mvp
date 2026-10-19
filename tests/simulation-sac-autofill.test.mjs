import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { estimateSacForType } from "../lib/financiamento-estimativa-core.mjs";

// "Preencher automaticamente" do SAC (dono, 2026-10-19): mesmo motor, cadastro + valor do imóvel + taxa/prazo do tipo.
const REF = "2026-10-19";
const reg = { simulationType: "individual", primaryIncomeType: "registered_employment", primaryMonthlyIncome: 1963, oldestBirthDate: "1990-03-15", hasOverThreeYearsRegisteredWork: false, hasChildrenUnder18: true, hasResidentialProperty: false };

test("SAC: 1ª parcela no limite da renda (maior que a Price → financia menos), última pela amortização", () => {
  const sac = estimateSacForType({ registration: { ...reg, primaryMonthlyIncome: 3000, hasOverThreeYearsRegisteredWork: true }, type: "novo", referenceDate: REF });
  assert.equal(sac.ok, true);
  assert.equal(sac.firstInstallment, Math.round((0.3 * 3000 - 15.03) * 100) / 100);
  assert.ok(sac.lastInstallment < sac.firstInstallment);
  assert.equal(sac.termMonths, 420);
});

test("taxa e prazo do tipo são respeitados (prazo nunca acima do máximo pela idade)", () => {
  const sac = estimateSacForType({ registration: reg, type: "usado", annualRate: 5.5, termMonths: 360, referenceDate: REF });
  assert.equal(sac.annualRate, 5.5);
  assert.equal(sac.termMonths, 360);
  const old = estimateSacForType({ registration: { ...reg, oldestBirthDate: "1960-01-01" }, type: "novo", termMonths: 420, referenceDate: REF });
  assert.ok(old.termMonths < 420);
});

test("faltando dado, devolve o que falta (sem inventar)", () => {
  const missing = estimateSacForType({ registration: { primaryMonthlyIncome: 0 }, type: "novo", referenceDate: REF });
  assert.equal(missing.ok, false);
  assert.ok(missing.missing.includes("renda no cadastro"));
  assert.ok(missing.missing.some((item) => /nascimento/.test(item)));
});

test("Gerador: botão no bloco SAC, ajuda curta (sem o texto longo), campos seguem editáveis", () => {
  const ui = readFileSync(new URL("../components/SimulationGenerator.jsx", import.meta.url), "utf8");
  assert.match(ui, /Preencher automaticamente/);
  assert.match(ui, /onClick=\{\(\) => fillSacAutomatically\(key\)\}/);
  assert.doesNotMatch(ui, /Opcional\. Preencha o SAC \(além do Price\)/);
  assert.match(ui, /Para calcular, falta:/);
});
