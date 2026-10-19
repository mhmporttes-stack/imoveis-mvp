import assert from "node:assert/strict";
import test from "node:test";

import {
  ESTIMATE_DISCLAIMER,
  ageInMonths,
  estimateFinancing,
  estimateSubsidy,
  estimateUsedSubsidy
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

test("poder de compra = financiado + subsídio (sem entrada nem recurso); entrada em linha separada", () => {
  const base = { primaryMonthlyIncome: 2300, hasOverThreeYearsRegisteredWork: true, hasChildrenUnder18: false, oldestBirthDate: "2000-01-01", hasResidentialProperty: false, availablePurchaseResource: 0 };
  const semRecurso = estimateFinancing(base, REFERENCE_DATE);
  assert.equal(semRecurso.downPayment, Math.round(semRecurso.financing / 0.8 - semRecurso.financing - semRecurso.subsidy));
  assert.equal(semRecurso.purchasePower, Math.round((semRecurso.financing + semRecurso.subsidy) * 100) / 100);
  const comRecurso = estimateFinancing({ ...base, availablePurchaseResource: 60000 }, REFERENCE_DATE);
  assert.equal(comRecurso.purchasePower, semRecurso.purchasePower);
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

test("imóvel usado: metade do desconto integral (para baixo), teto R$ 24.750; 30% para um comprador sem filhos", () => {
  // Pares reais (novo → usado) do simulador da Caixa gravados no CRM.
  assert.equal(estimateUsedSubsidy({ income: 2000, cotista: false, fullFamily: true }), 21457); // novo 42.915
  assert.equal(estimateUsedSubsidy({ income: 2300, cotista: true, fullFamily: true }), 14214); // novo 28.429
  assert.equal(estimateUsedSubsidy({ income: 2125, cotista: true, fullFamily: true }), 17962); // novo 35.925
  assert.equal(estimateUsedSubsidy({ income: 1500, cotista: false, fullFamily: true }), 24750); // novo 55.000 (teto)
  assert.equal(estimateUsedSubsidy({ income: 1500, cotista: false, fullFamily: false }), 7425); // novo 16.500
  assert.equal(estimateUsedSubsidy({ income: 2000, cotista: false, fullFamily: false }), 6437); // novo 12.874
  const result = estimateFinancing(inputOf(CAIXA_CASES[0]), REFERENCE_DATE);
  assert.equal(result.used.purchasePower, Math.round((result.financing + result.used.subsidy) * 100) / 100);
});

test("última parcela Price = prestação pura + taxa de administração (como a Caixa)", () => {
  // Caso real: renda 2.300, cotista, 18 anos → Caixa: 1ª 674,97 e última 647,07 para 136.726,92.
  const result = estimateFinancing({ primaryMonthlyIncome: 2300, hasOverThreeYearsRegisteredWork: true, hasChildrenUnder18: true, oldestBirthDate: "2008-02-01", hasResidentialProperty: false }, REFERENCE_DATE);
  assert.ok(Math.abs(result.priceLastInstallment - 647.07) <= 0.05, String(result.priceLastInstallment));
  assert.ok(result.sacLastInstallment < result.sacFirstInstallment);
});

// Renda considerada (REGRA OFICIAL — dono, 2026-10-19: "achar o MELHOR CENÁRIO").
const informal = "self_employed_unregistered";
const base = { oldestBirthDate: "1998-01-01", hasResidentialProperty: false, availablePurchaseResource: 0 };

test("renda: CLT e declarante de IR nunca mudam", () => {
  for (const type of ["registered_employment", "income_tax_declarant"]) {
    const result = estimateFinancing({ ...base, primaryMonthlyIncome: 6000, primaryIncomeType: type, hasChildrenUnder18: true, hasOverThreeYearsRegisteredWork: true }, REFERENCE_DATE);
    assert.equal(result.income, 6000);
    assert.equal(result.incomeRule, "declared");
    assert.equal(result.incomeAdjusted, false);
  }
});

test("renda: informal sem filho e sem 3 anos de registro = direto R$ 2.550 (mesmo declarando menos ou mais)", () => {
  for (const declared of [1500, 10000]) {
    const result = estimateFinancing({ ...base, primaryMonthlyIncome: declared, primaryIncomeType: informal, hasChildrenUnder18: false, hasOverThreeYearsRegisteredWork: false }, REFERENCE_DATE);
    assert.equal(result.income, 2550);
    assert.equal(result.incomeRule, "max");
    assert.equal(result.declaredIncome, declared);
  }
});

test("renda: informal com só filho OU só 3 anos = declarada, com teto de R$ 2.550 por pessoa", () => {
  const onlyKids = { ...base, primaryIncomeType: informal, hasChildrenUnder18: true, hasOverThreeYearsRegisteredWork: false };
  assert.equal(estimateFinancing({ ...onlyKids, primaryMonthlyIncome: 1800 }, REFERENCE_DATE).income, 1800);
  assert.equal(estimateFinancing({ ...onlyKids, primaryMonthlyIncome: 10000 }, REFERENCE_DATE).income, 2550);
  const onlyFgts = { ...base, primaryIncomeType: informal, hasChildrenUnder18: false, hasOverThreeYearsRegisteredWork: true, primaryMonthlyIncome: 4000 };
  assert.equal(estimateFinancing(onlyFgts, REFERENCE_DATE).incomeRule, "cap");
  assert.equal(estimateFinancing(onlyFgts, REFERENCE_DATE).income, 2550);
});

test("renda: informal com filho E 3 anos — novo e usado otimizados separadamente (maior poder; empate → menor parcela)", () => {
  const input = { ...base, primaryMonthlyIncome: 5000, primaryIncomeType: informal, hasChildrenUnder18: true, hasOverThreeYearsRegisteredWork: true };
  const best = estimateFinancing(input, REFERENCE_DATE);
  assert.equal(best.incomeRule, "optimize");
  assert.ok(best.income >= 1621 && best.income <= 2550);
  assert.ok(best.used.income >= 1621 && best.used.income <= 2550);
  for (let income = 1621; income <= 2550; income += 7) {
    const other = estimateFinancing({ ...input, primaryMonthlyIncome: income, primaryIncomeType: "registered_employment" }, REFERENCE_DATE);
    assert.ok(best.financing + best.subsidy >= other.financing + other.subsidy - 0.01, `novo, renda ${income}`);
    assert.ok(best.used.financing + best.used.subsidy >= other.financing + other.used.subsidy - 0.01, `usado, renda ${income}`);
  }
});

test("renda: casal misto — CLT fixa, só a parte informal é ajustada (teto por pessoa)", () => {
  const result = estimateFinancing({ ...base, primaryMonthlyIncome: 3000, primaryIncomeType: "registered_employment", secondaryMonthlyIncome: 9000, secondaryIncomeType: informal, hasChildrenUnder18: false, hasOverThreeYearsRegisteredWork: false }, REFERENCE_DATE);
  assert.equal(result.primaryIncomeConsidered, 3000);
  assert.equal(result.secondaryIncomeConsidered, 2550);
  assert.equal(result.income, 5550);
});

test("refazer: usa a renda do cadastro (informal só com teto de R$ 2.550) e devolve a sugestão do melhor cenário", async () => {
  const { suggestedInformalIncome } = await import("../lib/financiamento-estimativa-core.mjs");
  const input = { ...base, primaryMonthlyIncome: 1800, primaryIncomeType: informal, hasChildrenUnder18: true, hasOverThreeYearsRegisteredWork: true };
  const redo = estimateFinancing(input, REFERENCE_DATE, { incomeMode: "registered" });
  assert.equal(redo.income, 1800);
  assert.equal(redo.informalCapped, false);
  const best = estimateFinancing(input, REFERENCE_DATE);
  assert.deepEqual(suggestedInformalIncome(input, REFERENCE_DATE), { novo: best.income, usado: best.used.income });
  const high = estimateFinancing({ ...input, primaryMonthlyIncome: 9000 }, REFERENCE_DATE, { incomeMode: "registered" });
  assert.equal(high.income, 2550);
  assert.equal(high.informalCapped, true);
  const clt = estimateFinancing({ ...input, primaryIncomeType: "registered_employment", primaryMonthlyIncome: 3100 }, REFERENCE_DATE, { incomeMode: "registered" });
  assert.equal(clt.income, 3100);
  assert.equal(suggestedInformalIncome({ ...input, primaryIncomeType: "registered_employment" }, REFERENCE_DATE), null);
});
