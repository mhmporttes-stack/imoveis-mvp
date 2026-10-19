import assert from "node:assert/strict";
import test from "node:test";

import {
  ESTIMATE_DISCLAIMER,
  ageInMonths,
  estimateFinancing,
  estimateSubsidy
} from "../lib/financiamento-estimativa-core.mjs";

// Casos REAIS do simulador da Caixa gravados no CRM (tabela `simulations`, jul–out/2026), anonimizados: sem nome,
// telefone ou data real — só renda, FGTS (3+ anos), filhos, idade (nascimento sintético com a MESMA idade em meses em
// 2026-10-01) e os números que a Caixa devolveu. `renda` = renda familiar total; `segunda` = parte da 2ª pessoa.
const REFERENCE_DATE = "2026-10-01";
const CAIXA_CASES = [
  {"renda":2900,"segunda":0,"cotista":true,"filhos":false,"nascimento":"2001-10-01","financiadoCaixa":163619.39,"subsidioCaixa":2980,"parcelaCaixa":854.96},
  {"renda":2600,"segunda":0,"cotista":true,"filhos":true,"nascimento":"1988-11-01","financiadoCaixa":153444.23,"subsidioCaixa":17603,"parcelaCaixa":764.97},
  {"renda":2500,"segunda":0,"cotista":true,"filhos":true,"nascimento":"1991-01-01","financiadoCaixa":148387.78,"subsidioCaixa":20860,"parcelaCaixa":734.97},
  {"renda":2800,"segunda":0,"cotista":false,"filhos":false,"nascimento":"2008-08-01","financiadoCaixa":157594.16,"subsidioCaixa":3714,"parcelaCaixa":824.97},
  {"renda":2500,"segunda":0,"cotista":false,"filhos":false,"nascimento":"2008-02-01","financiadoCaixa":140046.44,"subsidioCaixa":6389,"parcelaCaixa":734.97},
  {"renda":3000,"segunda":0,"cotista":true,"filhos":false,"nascimento":"1970-06-01","financiadoCaixa":128179.87,"subsidioCaixa":2382,"parcelaCaixa":884.96},
  {"renda":2400,"segunda":0,"cotista":true,"filhos":true,"nascimento":"1999-12-01","financiadoCaixa":142869,"subsidioCaixa":24466,"parcelaCaixa":704.97},
  {"renda":1800,"segunda":0,"cotista":false,"filhos":false,"nascimento":"2008-10-01","financiadoCaixa":102258.09,"subsidioCaixa":16310,"parcelaCaixa":524.97},
  {"renda":2000,"segunda":0,"cotista":false,"filhos":true,"nascimento":"1993-04-01","financiadoCaixa":113734.24,"subsidioCaixa":42915,"parcelaCaixa":584.97},
  {"renda":1800,"segunda":0,"cotista":false,"filhos":true,"nascimento":"2007-02-01","financiadoCaixa":102258.09,"subsidioCaixa":54366,"parcelaCaixa":524.97},
  {"renda":3500,"segunda":0,"cotista":true,"filhos":true,"nascimento":"1984-09-01","financiadoCaixa":187734.72,"subsidioCaixa":2325,"parcelaCaixa":1034.96},
  {"renda":3000,"segunda":0,"cotista":false,"filhos":false,"nascimento":"2007-05-01","financiadoCaixa":159427.38,"subsidioCaixa":2442,"parcelaCaixa":884.97},
  {"renda":1500,"segunda":0,"cotista":false,"filhos":true,"nascimento":"1992-03-01","financiadoCaixa":83713.59,"subsidioCaixa":55000,"parcelaCaixa":434.97},
  {"renda":3300,"segunda":0,"cotista":true,"filhos":true,"nascimento":"1981-06-01","financiadoCaixa":176394.43,"subsidioCaixa":3793,"parcelaCaixa":974.97},
  {"renda":2173,"segunda":0,"cotista":true,"filhos":false,"nascimento":"1987-08-01","financiadoCaixa":127175.71,"subsidioCaixa":10198,"parcelaCaixa":636.87},
  {"renda":1500,"segunda":0,"cotista":false,"filhos":false,"nascimento":"2008-02-01","financiadoCaixa":84151.48,"subsidioCaixa":16500,"parcelaCaixa":434.97},
  {"renda":3200,"segunda":1200,"cotista":false,"filhos":false,"nascimento":"2002-06-01","financiadoCaixa":170770.76,"subsidioCaixa":4960,"parcelaCaixa":944.97},
  {"renda":2900,"segunda":0,"cotista":false,"filhos":false,"nascimento":"2006-01-01","financiadoCaixa":153755.69,"subsidioCaixa":3053,"parcelaCaixa":854.96},
  {"renda":1629.4,"segunda":0,"cotista":false,"filhos":false,"nascimento":"1998-12-01","financiadoCaixa":91905.99,"subsidioCaixa":16500,"parcelaCaixa":473.79},
  {"renda":2147,"segunda":0,"cotista":true,"filhos":false,"nascimento":"2007-02-01","financiadoCaixa":131385.79,"subsidioCaixa":10464,"parcelaCaixa":629.07},
  {"renda":2550,"segunda":0,"cotista":true,"filhos":true,"nascimento":"2000-04-01","financiadoCaixa":152209.83,"subsidioCaixa":19189,"parcelaCaixa":749.96},
  {"renda":4300,"segunda":2100,"cotista":false,"filhos":false,"nascimento":"1974-10-01","financiadoCaixa":166455.21,"subsidioCaixa":0,"parcelaCaixa":1274.97},
  {"renda":2125,"segunda":0,"cotista":true,"filhos":true,"nascimento":"2003-07-01","financiadoCaixa":129969.76,"subsidioCaixa":35925,"parcelaCaixa":622.46},
  {"renda":2800,"segunda":0,"cotista":true,"filhos":true,"nascimento":"1980-05-01","financiadoCaixa":156971.34,"subsidioCaixa":12086,"parcelaCaixa":824.97},
];

function inputOf(item) {
  return {
    primaryMonthlyIncome: item.renda - item.segunda,
    secondaryMonthlyIncome: item.segunda || null,
    hasOverThreeYearsRegisteredWork: item.cotista,
    hasChildrenUnder18: item.filhos,
    oldestBirthDate: item.nascimento,
    hasResidentialProperty: false,
    availablePurchaseResource: 0
  };
}

test("reproduz o valor financiado, o subsídio e a 1ª parcela Price da Caixa nos casos reais", () => {
  for (const item of CAIXA_CASES) {
    const result = estimateFinancing(inputOf(item), REFERENCE_DATE);
    const label = JSON.stringify(item);
    assert.equal(result.eligible, true, label);
    assert.ok(Math.abs(result.financing - item.financiadoCaixa) <= Math.max(2, item.financiadoCaixa * 0.0001), `financiado ${result.financing} — ${label}`);
    assert.ok(Math.abs(result.subsidy - item.subsidioCaixa) <= 1, `subsídio ${result.subsidy} — ${label}`);
    assert.ok(Math.abs(result.priceFirstInstallment - item.parcelaCaixa) <= 0.02, `parcela ${result.priceFirstInstallment} — ${label}`);
  }
});

test("1ª parcela Price fica em 30% da renda menos a folga da Caixa; SAC começa maior", () => {
  const result = estimateFinancing(inputOf(CAIXA_CASES[0]), REFERENCE_DATE);
  assert.ok(result.sacFirstInstallment > result.priceFirstInstallment);
  assert.ok(result.priceIncomeShare <= 30);
  assert.ok(result.sacIncomeShare > result.priceIncomeShare);
});

test("financiamento trava em 80% do teto da faixa (Faixas 1 e 2: R$ 188.000)", () => {
  const result = estimateFinancing({ ...inputOf(CAIXA_CASES[0]), primaryMonthlyIncome: 4200, secondaryMonthlyIncome: null }, REFERENCE_DATE);
  assert.equal(result.financing, 188000);
  assert.equal(result.subsidy, 0);
  assert.ok(result.purchasePower <= 235000);
});

test("entrada mínima = o que falta para a cota de 80% depois do subsídio; recurso maior aumenta o poder de compra", () => {
  const base = { primaryMonthlyIncome: 2300, hasOverThreeYearsRegisteredWork: true, hasChildrenUnder18: false, oldestBirthDate: "2000-01-01", hasResidentialProperty: false, availablePurchaseResource: 0 };
  const semRecurso = estimateFinancing(base, REFERENCE_DATE);
  assert.equal(semRecurso.minimumDownPayment, Math.round(semRecurso.financing / 0.8 - semRecurso.financing - semRecurso.subsidy));
  assert.equal(semRecurso.downPayment, semRecurso.minimumDownPayment);
  assert.equal(semRecurso.purchasePower, Math.round((semRecurso.financing + semRecurso.subsidy + semRecurso.downPayment) * 100) / 100);
  const comRecurso = estimateFinancing({ ...base, availablePurchaseResource: 60000 }, REFERENCE_DATE);
  assert.equal(comRecurso.purchasePower, Math.round((comRecurso.financing + comRecurso.subsidy + 60000) * 100) / 100);
  assert.equal(comRecurso.downPayment, 60000);
  const rendaBaixaComFilhos = estimateFinancing({ ...base, primaryMonthlyIncome: 1800, hasChildrenUnder18: true }, REFERENCE_DATE);
  assert.equal(rendaBaixaComFilhos.downPayment, 0); // subsídio cheio cobre os 20%
});

test("sem estimativa automática quando o MCMV não se aplica ou falta dado", () => {
  const base = inputOf(CAIXA_CASES[0]);
  assert.equal(estimateFinancing({ ...base, hasResidentialProperty: true }, REFERENCE_DATE).reason, "has_property");
  assert.equal(estimateFinancing({ ...base, primaryMonthlyIncome: 15000 }, REFERENCE_DATE).reason, "income_above_program");
  assert.equal(estimateFinancing({ ...base, oldestBirthDate: "1900-01-01" }, REFERENCE_DATE).reason, "birth_date");
  assert.equal(estimateFinancing({ ...base, oldestBirthDate: "1950-01-01" }, REFERENCE_DATE).reason, "age");
});

test("subsídio: teto de R$ 55 mil, 30% para um comprador sem filhos, nada acima de R$ 4.000", () => {
  assert.equal(estimateSubsidy({ income: 1500, cotista: false, fullFamily: true }), 55000);
  assert.equal(estimateSubsidy({ income: 1500, cotista: false, fullFamily: false }), 16500);
  assert.equal(estimateSubsidy({ income: 3800, cotista: true, fullFamily: true }), 1836);
  assert.equal(estimateSubsidy({ income: 4200, cotista: true, fullFamily: true }), 0);
});

test("idade em meses completos e aviso oficial", () => {
  assert.equal(ageInMonths("2000-10-02", "2026-10-01"), 25 * 12 + 11);
  assert.equal(ageInMonths("2000-10-01", "2026-10-01"), 26 * 12);
  assert.equal(ESTIMATE_DISCLAIMER, "Valores estimados, sujeitos à análise de crédito da Caixa.");
});
