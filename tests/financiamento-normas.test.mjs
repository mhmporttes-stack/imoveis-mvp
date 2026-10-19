import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_SUBSIDY, estimateFinancing, estimateSubsidy, estimateUsedSubsidy, propertyValueSubsidyFactor } from "../lib/financiamento-estimativa-core.mjs";

// Normas do MCMV aplicadas ao motor (pesquisa na base jurídica do MCID, 2026-10-19): Res. CCFGTS 702/2012 compilada,
// IN MCID 48 (subsídio) e IN MCID 45/2025 alterada pela IN 22 de 08/10/2026 (usado na Faixa 4).
const REF = "2026-10-19";
const person = (income, extra = {}) => ({ simulationType: "individual", primaryIncomeType: "registered_employment", primaryMonthlyIncome: income, oldestBirthDate: "1990-03-15", hasOverThreeYearsRegisteredWork: true, hasChildrenUnder18: true, hasResidentialProperty: false, ...extra });

test("subsídio cai com imóvel abaixo de 67,5% do teto (R$ 158.625): R702 art. 30 / IN48 art. 53 (FDfin)", () => {
  assert.equal(estimateSubsidy({ income: 2000, cotista: false, fullFamily: true, propertyValue: 120000 }), 39563);
  assert.equal(estimateSubsidy({ income: 2000, cotista: false, fullFamily: true }), 42915, "sem valor digitado: como sempre");
  assert.equal(propertyValueSubsidyFactor({ income: 2000, cotista: false, propertyValue: 158625 }), 1);
  assert.equal(propertyValueSubsidyFactor({ income: 2000, cotista: false, propertyValue: 235000 }), 1);
  assert.ok(estimateUsedSubsidy({ income: 2000, cotista: false, fullFamily: true, propertyValue: 120000 }) < estimateUsedSubsidy({ income: 2000, cotista: false, fullFamily: true }));
});

test("subsídio mínimo de R$ 1.500 (abaixo, zero) — R702 art. 30 §3º / IN48 art. 53 §10; redutores acumulam (IN48 art. 54)", () => {
  assert.equal(MIN_SUBSIDY, 1500);
  for (const income of [1800, 2200, 2600, 3000, 3200, 3400, 3800, 4000]) {
    for (const fullFamily of [true, false]) {
      const novo = estimateSubsidy({ income, cotista: true, fullFamily });
      const usado = estimateUsedSubsidy({ income, cotista: true, fullFamily });
      assert.ok(novo === 0 || novo >= 1500, `novo ${income} ${fullFamily}`);
      assert.ok(usado === 0 || usado >= 1500, `usado ${income} ${fullFamily}`);
    }
  }
  // sozinho (−70%) e usado (−50%) acumulam: 0,3 × 0,5 × integral
  const full = estimateSubsidy({ income: 2000, cotista: true, fullFamily: true });
  assert.ok(Math.abs(estimateUsedSubsidy({ income: 2000, cotista: true, fullFamily: false }) - Math.round(Math.floor(full / 2) * 0.3)) <= 1);
  assert.equal(estimateSubsidy({ income: 4100, cotista: true, fullFamily: true }), 0, "renda acima de R$ 4.000: sem subsídio");
});

test("usado na Faixa 4 (Sul/Sudeste): financiamento até 60% do valor — IN MCID 45/2025 art. 6º (IN 22/2026)", () => {
  const estimate = estimateFinancing(person(12000, { propertyValue: 500000 }), REF);
  assert.equal(estimate.financing, 400000);
  assert.equal(estimate.used.financing, 300000);
  assert.ok(estimate.used.priceFirstInstallment < estimate.priceFirstInstallment);
  const faixa3 = estimateFinancing(person(7000, { propertyValue: 300000 }), REF);
  assert.equal(faixa3.used.financing, faixa3.financing, "Faixa 3: mesma cota do novo");
});
