// Estimativa automática de financiamento Caixa / Minha Casa Minha Vida (site público, tela final de /simulacao).
// Motor PURO (sem servidor, sem banco): os mesmos números aparecem para o cliente e, recalculados com os dados da ficha,
// na ficha do cliente no CRM como "estimativa automática do site" (nunca gravados em `simulations`).
// Regras do dono (2026-10-19, docs/BUSINESS_RULES.md SIM-AUTO-1..3): resultado só depois de o cliente deixar nome e
// WhatsApp; aviso "Valores estimados, sujeitos à análise de crédito da Caixa."; calibrado com as simulações reais da Caixa.
//
// Fontes de cada parâmetro (consultadas/calibradas em 2026-10-19):
//  - gov.br/cidades › MCMV-FGTS (linha financiada): faixas de renda, taxas nominais por faixa (cotista × não cotista,
//    regiões S/SE/CO), subsídio até R$ 55.000 (fora da Região Norte) para renda até R$ 5.000, tetos de imóvel
//    (Faixa 3 R$ 400 mil; Classe Média R$ 600 mil), prazo máximo de 35 anos.
//  - Calibração com 288 simulações reais da Caixa gravadas no CRM (2026-07-21 a 2026-10-18): a última parcela Price de
//    TODAS as simulações coerentes = parcela Price pura na taxa oficial + taxa de administração (R$ 25 acima de
//    R$ 2.850); seguro MIP por faixa de idade e DFI sobre o valor do imóvel; teto de parcela; cota de 80%; subsídio.
//    O que é inferido dos dados (e não de norma publicada) está marcado "calibrado".

export const ESTIMATE_VERSION = "2026-10-19";
export const ESTIMATE_DISCLAIMER = "Valores estimados, sujeitos à análise de crédito da Caixa.";

export const MAX_TERM_MONTHS = 420; // 35 anos (gov.br)
export const MAX_AGE_PLUS_TERM_MONTHS = 966; // idade + prazo ≤ 80 anos e 6 meses (calibrado: confere com a Caixa)
export const MIN_TERM_MONTHS = 60;
export const INCOME_COMMITMENT = 0.3; // parcela ≤ 30% da renda bruta familiar
export const INSTALLMENT_MARGIN = 15.03; // calibrado: a 1ª parcela da Caixa sai sempre 30% da renda − R$ 15,03 (imóvel de R$ 235 mil)
// Recalibrado em 2026-10-19 (Faixa 3, imóveis acima de R$ 235 mil): a margem é PROPORCIONAL ao valor do imóvel —
// R$ 15,03 em 235 mil, R$ 19,19 em 300 mil, R$ 25,58 em 400 mil (casos reais e o teste #C6771 com renda de R$ 7.000
// na Caixa: 2.100 − 25,58 = R$ 2.074,42, financiado R$ 291.128,51 — bate no centavo).
export const INSTALLMENT_MARGIN_RATE = INSTALLMENT_MARGIN / 235000;
export const FINANCING_QUOTA = 0.8; // calibrado: financiamento travado em exatamente 80% do valor do imóvel
export const ADMIN_FEE_ABOVE = 2850; // calibrado: taxa de administração só acima de R$ 2.850
export const ADMIN_FEE = 25;
export const DFI_RATE = 0.00007106; // calibrado: seguro de danos físicos, mensal, sobre o valor do imóvel
export const MAX_SUBSIDY = 55000; // gov.br (regiões fora do Norte)
export const SUBSIDY_INCOME_LIMIT = 4000; // REGRA OFICIAL — dono, 2026-10-19: subsídio zero acima de R$ 4.000 (igual à Caixa nos casos reais)
export const SINGLE_NO_DEPENDENT_SUBSIDY_FACTOR = 0.3; // calibrado: um só comprador sem filhos recebe 30% do desconto
// REGRA OFICIAL — dono, 2026-10-19 (backtest: 12 de 12 casos reais com subsídio zero): comprador SOZINHO, SEM dependentes
// e renda acima de R$ 3.200 → subsídio ZERO (novo e usado).
export const SINGLE_NO_DEPENDENT_SUBSIDY_INCOME_LIMIT = 3200;
// REGRA OFICIAL — dono, 2026-10-19: valor do imóvel padrão COMEÇA em R$ 235.000 em todas as faixas (no backtest a Caixa
// financiou R$ 188 mil = 80% de 235 mil em parte das simulações de Faixa 3/4); o corretor edita para mais até o teto.
export const DEFAULT_PROPERTY_VALUE = 235000;

// Faixas (renda bruta familiar mensal) — gov.br. Taxas nominais a.a. S/SE/CO: [cotista FGTS (3+ anos), não cotista].
// Teto do imóvel: Faixas 1 e 2 em Marília = R$ 235.000 (REGRA OFICIAL — dono, 2026-10-19; bate com a Caixa, que trava
// em 80% de 235 mil = R$ 188.000); Faixa 3 R$ 400 mil e Classe Média R$ 600 mil (gov.br).
export const INCOME_BANDS = [
  { upTo: 2160, faixa: "Faixa 1", rates: [4.25, 4.75], propertyCap: 235000 },
  { upTo: 2850, faixa: "Faixa 1", rates: [4.5, 5.0], propertyCap: 235000 },
  { upTo: 3200, faixa: "Faixa 1", rates: [4.75, 5.25], propertyCap: 235000 },
  { upTo: 3500, faixa: "Faixa 2", rates: [5.0, 5.5], propertyCap: 235000 },
  { upTo: 4000, faixa: "Faixa 2", rates: [5.5, 6.0], propertyCap: 235000 },
  { upTo: 5000, faixa: "Faixa 2", rates: [6.5, 7.0], propertyCap: 235000 },
  { upTo: 9600, faixa: "Faixa 3", rates: [7.66, 8.16], propertyCap: 400000 },
  { upTo: 13000, faixa: "Faixa 4 (Classe Média)", rates: [10, 10], propertyCap: 600000 }
];

// Seguro MIP (morte e invalidez), mensal, sobre o valor financiado, por idade completa do proponente mais velho.
// Calibrado: idêntico em todas as simulações da mesma faixa de idade. Acima de 65 anos não há simulação real para
// calibrar — usa a última faixa conhecida (A CONFIRMAR).
export const MIP_BY_AGE = [
  { upTo: 25, rate: 0.0000819 },
  { upTo: 30, rate: 0.0000849 },
  { upTo: 35, rate: 0.0001079 },
  { upTo: 40, rate: 0.0001439 },
  { upTo: 45, rate: 0.0002439 },
  { upTo: 50, rate: 0.0003639 },
  { upTo: 55, rate: 0.0006515 },
  { upTo: 60, rate: 0.0007745 },
  { upTo: Infinity, rate: 0.0013141 }
];

// Subsídio (desconto MCMV) integral por renda — pontos tirados das simulações reais da Caixa, interpolação linear
// entre eles. Cotista do FGTS recebe um pouco menos que o não cotista (a taxa dele já é menor).
const SUBSIDY_POINTS = {
  cotista: [
    [1770, 55000], [1800, 53583], [2000, 42211], [2100, 37133], [2125, 35925], [2147, 34880], [2173, 33993],
    [2200, 32760], [2250, 30547], [2300, 28429], [2400, 24466], [2500, 20860], [2550, 19189], [2600, 17603],
    [2700, 14681], [2800, 12086], [2900, 9933], [3000, 7940], [3200, 4893], [3300, 3793], [3380, 3089], [3400, 2325],
    [3500, 2325]
  ],
  naoCotista: [
    [1785, 55000], [1800, 54366], [1900, 49167], [1963, 44910], [2000, 42915], [2100, 37790], [2200, 33342],
    [2300, 28963], [2500, 21297], [2550, 19603], [2800, 12380], [2900, 10177], [3000, 8141], [3200, 4960],
    [3300, 3850], [3380, 3140], [3400, 2325], [3500, 2325]
  ]
};
const SUBSIDY_FLOOR_3500_4000 = 1836; // calibrado: valor fixo da Caixa entre R$ 3.500,01 e R$ 4.000

const round2 = (value) => Math.round(value * 100) / 100;

function interpolate(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    if (x <= x1) {
      const [x0, y0] = points[index - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

/** Parcela Price pura (sem seguros/taxas). Mesma fórmula de `pricePayment` (lib/payment-strategy-core.mjs), sem arredondar. */
export function priceFactor(monthlyRate, months) {
  if (!(monthlyRate > 0)) return 1 / months;
  return monthlyRate / (1 - (1 + monthlyRate) ** -months);
}

export function bandForIncome(income) {
  return INCOME_BANDS.find((band) => income <= band.upTo) || null;
}

export function mipRateForAge(ageYears) {
  return MIP_BY_AGE.find((band) => ageYears <= band.upTo).rate;
}

/** Idade em meses completos na data de referência (datas "AAAA-MM-DD"). null se a data for inválida/placeholder. */
export function ageInMonths(birthDate, referenceDate) {
  const birth = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birthDate || ""));
  const ref = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(referenceDate || ""));
  if (!birth || !ref) return null;
  const [by, bm, bd] = birth.slice(1).map(Number);
  const [ry, rm, rd] = ref.slice(1).map(Number);
  if (by < 1920) return null; // 1900-01-01 = data de nascimento não informada
  const months = (ry - by) * 12 + (rm - bm) - (rd < bd ? 1 : 0);
  return months >= 18 * 12 ? months : null;
}

function fullSubsidy(income, cotista) {
  if (!(income > 0) || income > SUBSIDY_INCOME_LIMIT) return 0;
  return income > 3500
    ? SUBSIDY_FLOOR_3500_4000
    : Math.min(MAX_SUBSIDY, interpolate(cotista ? SUBSIDY_POINTS.cotista : SUBSIDY_POINTS.naoCotista, income));
}

/** Subsídio MCMV estimado (imóvel NOVO). `fullFamily` = filhos menores de 18 ou dois compradores (renda da 2ª pessoa). */
export function estimateSubsidy({ income, cotista, fullFamily }) {
  if (!fullFamily && income > SINGLE_NO_DEPENDENT_SUBSIDY_INCOME_LIMIT) return 0;
  const full = fullSubsidy(income, cotista);
  return Math.round(fullFamily ? full : full * SINGLE_NO_DEPENDENT_SUBSIDY_FACTOR);
}

// Imóvel USADO (calibrado nas simulações reais com os dois tipos): mesmo financiamento, prazo, taxa e parcelas do novo;
// o subsídio é a METADE do desconto integral do novo (arredondado para baixo), com teto de R$ 24.750 — e 30% disso para
// um comprador sem filhos (como no novo).
// Acima de R$ 2.850 a Caixa deu subsídio ZERO no usado em 18 de 24 simulações reais (dono, 2026-10-19: "é a Caixa que
// dá zero às vezes") — o motor usa zero aí. Até R$ 2.850 a Caixa também zerou em ~1 de cada 4 casos desde meados de
// setembro, sem relação com renda, filhos, FGTS ou data (provável valor/município do imóvel, que a ficha não tem):
// mantida a metade (A CONFIRMAR).
export const USED_SUBSIDY_CAP = 24750;
export const USED_SUBSIDY_INCOME_LIMIT = 2850;

export function estimateUsedSubsidy({ income, cotista, fullFamily }) {
  if (income > USED_SUBSIDY_INCOME_LIMIT) return 0;
  if (!fullFamily && income > SINGLE_NO_DEPENDENT_SUBSIDY_INCOME_LIMIT) return 0;
  const full = Math.min(Math.floor(Math.round(fullSubsidy(income, cotista)) / 2), USED_SUBSIDY_CAP);
  return Math.round(fullFamily ? full : full * SINGLE_NO_DEPENDENT_SUBSIDY_FACTOR);
}

/**
 * Estimativa a partir dos dados da ficha do formulário (com a renda considerada pelas regras acima) (camelCase, como em `validateSimulationRegistration().data` e na
 * ficha do CRM). `referenceDate` = "AAAA-MM-DD" (data da simulação, para a idade).
 * Devolve { eligible: false, reason } quando não dá para estimar pelo MCMV — nesse caso a tela mostra o texto de sempre
 * (o corretor apresenta a simulação).
 */
// ---------- renda considerada na simulação (REGRA OFICIAL — dono, 2026-10-19: "achar o MELHOR CENÁRIO") ----------
// 1) Renda informal (Autônomo = `self_employed_unregistered`): a Caixa aceita no máximo R$ 2.550 POR PESSOA.
// 2) CLT (`registered_employment`) e quem declara IR (`income_tax_declarant`): renda informada, nunca mexida.
// 3) Informal COM filho menor de 18 E mais de 3 anos de registro: testa toda renda informal entre 1 salário mínimo e
//    R$ 2.550 por pessoa informal, SEPARADAMENTE para novo e usado (critério em `estimateFinancing`).
// 4) Informal SEM 3 anos de registro e SEM filho: direto R$ 2.550.
//    Só UM dos dois (filho OU 3 anos): o que os corretores fazem nas simulações reais — renda declarada até R$ 2.550.
// 5) Casal misto: a parte CLT/IR fica fixa; só a informal segue as regras acima.
export const INFORMAL_INCOME_TYPE = "self_employed_unregistered";
export const INFORMAL_INCOME_CAP = 2550;
export const MINIMUM_WAGE_2026 = 1621; // salário mínimo 2026 (mesmo valor da 1ª faixa do INSS em lib/payment-strategy-core.mjs)

function people(input) {
  const list = [{ income: Number(input.primaryMonthlyIncome) || 0, type: input.primaryIncomeType || "" }];
  const secondary = Number(input.secondaryMonthlyIncome) || 0;
  if (secondary > 0) list.push({ income: secondary, type: input.secondaryIncomeType || "" });
  return list;
}

/** Regra de renda aplicada: "declared" (nada informal), "cap" (até R$ 2.550), "max" (direto R$ 2.550), "optimize". */
export function incomeRuleFor(input = {}) {
  if (!people(input).some((person) => person.type === INFORMAL_INCOME_TYPE)) return "declared";
  const kids = input.hasChildrenUnder18 === true;
  const fgts = input.hasOverThreeYearsRegisteredWork === true;
  if (kids && fgts) return "optimize";
  if (!kids && !fgts) return "max";
  return "cap";
}

function withIncomes(input, list) {
  return { ...input, primaryMonthlyIncome: list[0]?.income || 0, secondaryMonthlyIncome: list[1]?.income || null };
}

// `incomeMode`: "best" (padrão — 1ª simulação automática do cadastro do site: renda do melhor cenário pelas regras acima)
// ou "registered" ("Refazer simulação automática", REGRA OFICIAL — dono, 2026-10-19: usa a renda que está no cadastro,
// só com o teto de R$ 2.550 por pessoa informal; a renda do melhor cenário vira só sugestão — ver `suggestedInformalIncome`).
export function estimateFinancing(input = {}, referenceDate, { incomeMode = "best" } = {}) {
  const list = people(input);
  const declaredIncome = round2(list.reduce((sum, person) => sum + person.income, 0));
  const rule = incomeMode === "registered"
    ? (list.some((person) => person.type === INFORMAL_INCOME_TYPE) ? "cap" : "declared")
    : incomeRuleFor(input);
  const informal = list.filter((person) => person.type === INFORMAL_INCOME_TYPE);
  const declaredAdjusted = list.map((person) => {
    if (person.type !== INFORMAL_INCOME_TYPE) return person;
    return { ...person, income: rule === "max" ? INFORMAL_INCOME_CAP : Math.min(person.income, INFORMAL_INCOME_CAP) };
  });
  // NOVO e USADO otimizados SEPARADAMENTE, cada um com a sua renda ideal (REGRA OFICIAL — dono, 2026-10-19; substitui
  // "maior imóvel sem entrada" e o "maior poder puro"): melhor cenário = maior poder de compra (financiado + subsídio do
  // tipo) com a parcela pesando R$ 60 de poder para cada R$ 1 de 1ª parcela (`INSTALLMENT_WEIGHT`); empate → menor parcela.
  let bestNew = null;
  let bestUsed = null;
  if (rule === "optimize") {
    for (let each = MINIMUM_WAGE_2026; each <= INFORMAL_INCOME_CAP; each += 1) {
      const candidate = list.map((person) => (person.type === INFORMAL_INCOME_TYPE ? { ...person, income: each } : person));
      const estimate = estimateForIncomes(withIncomes(input, candidate), referenceDate);
      if (!estimate.eligible) continue;
      bestNew = better(bestNew, { power: scenarioScore(estimate.financing + estimate.subsidy, estimate.priceFirstInstallment), estimate, candidate });
      bestUsed = better(bestUsed, { power: scenarioScore(estimate.financing + estimate.used.subsidy, estimate.priceFirstInstallment), estimate, candidate });
    }
  }
  const newPick = bestNew || { estimate: estimateForIncomes(withIncomes(input, declaredAdjusted), referenceDate), candidate: declaredAdjusted };
  const usedPick = bestUsed || newPick;
  const result = newPick.estimate;
  if (!result.eligible) return result;
  const usedEstimate = usedPick.estimate;
  return {
    ...result,
    declaredIncome,
    incomeRule: rule,
    incomeAdjusted: informal.length > 0 && Math.abs(result.income - declaredIncome) > 0.005,
    informalCapped: informal.some((person) => person.income > INFORMAL_INCOME_CAP),
    primaryIncomeConsidered: newPick.candidate[0]?.income || 0,
    secondaryIncomeConsidered: newPick.candidate[1]?.income || 0,
    // Imóvel USADO com a SUA renda (pode diferir da do novo quando a renda informal é otimizada).
    used: {
      ...usedEstimate.used,
      income: usedEstimate.income,
      primaryIncomeConsidered: usedPick.candidate[0]?.income || 0,
      secondaryIncomeConsidered: usedPick.candidate[1]?.income || 0,
      faixa: usedEstimate.faixa,
      // Valor do imóvel do USADO = teto da faixa da renda DELE (pode diferir do novo) ou o valor digitado.
      propertyValue: usedEstimate.propertyValue,
      propertyCap: usedEstimate.propertyCap,
      annualRate: usedEstimate.annualRate,
      termMonths: usedEstimate.termMonths,
      financing: usedEstimate.financing,
      priceFirstInstallment: usedEstimate.priceFirstInstallment,
      priceLastInstallment: usedEstimate.priceLastInstallment,
      sacFirstInstallment: usedEstimate.sacFirstInstallment,
      sacLastInstallment: usedEstimate.sacLastInstallment,
      priceIncomeShare: round2((usedEstimate.priceFirstInstallment / usedEstimate.income) * 100),
      sacIncomeShare: round2((usedEstimate.sacFirstInstallment / usedEstimate.income) * 100)
    }
  };
}

// Peso da parcela no melhor cenário (REGRA OFICIAL — dono, 2026-10-19): "R$ 1 de parcela = R$ 60 de poder de compra".
export const INSTALLMENT_WEIGHT = 60;

/** Nota do cenário: poder de compra − 60 × 1ª parcela (maior é melhor). */
export function scenarioScore(purchasePower, firstInstallment) {
  return (Number(purchasePower) || 0) - INSTALLMENT_WEIGHT * (Number(firstInstallment) || 0);
}

function better(current, candidate) {
  if (!current) return candidate;
  if (candidate.power > current.power + 0.005) return candidate;
  if (Math.abs(candidate.power - current.power) <= 0.005 && candidate.estimate.priceFirstInstallment < current.estimate.priceFirstInstallment) return candidate;
  return current;
}

/** Rendas do melhor cenário (novo e usado) para quem tem renda informal — sugestão do "Refazer"; null sem informal. */
export function suggestedInformalIncome(input = {}, referenceDate) {
  if (!people(input).some((person) => person.type === INFORMAL_INCOME_TYPE)) return null;
  const best = estimateFinancing(input, referenceDate);
  return best.eligible ? { novo: best.income, usado: best.used.income } : null;
}

function estimateForIncomes(input = {}, referenceDate) {
  const primary = Number(input.primaryMonthlyIncome) || 0;
  const secondary = Number(input.secondaryMonthlyIncome) || 0;
  const income = round2(primary + secondary);
  const resource = Math.max(0, Number(input.availablePurchaseResource) || 0);

  if (input.hasResidentialProperty === true) return { eligible: false, reason: "has_property" };
  if (!(income >= 1000)) return { eligible: false, reason: "income" };
  const band = bandForIncome(income);
  if (!band) return { eligible: false, reason: "income_above_program" };
  const ageMonths = ageInMonths(input.oldestBirthDate, referenceDate);
  if (ageMonths === null) return { eligible: false, reason: "birth_date" };
  const termMonths = Math.min(MAX_TERM_MONTHS, MAX_AGE_PLUS_TERM_MONTHS - ageMonths);
  if (termMonths < MIN_TERM_MONTHS) return { eligible: false, reason: "age" };
  // Valor do imóvel DIGITADO (opcional — Simulador Caixa; dono, 2026-10-19). Sem ele, o padrão R$ 235.000
  // (`DEFAULT_PROPERTY_VALUE`) em todas as faixas. Com ele: acima do teto da faixa da renda o imóvel não se enquadra no MCMV nessa
  // faixa (o motor não tem outra regra da Caixa para isso); até o teto, cota de 80%, DFI e subsídio sobre o valor digitado.
  const typedValue = Number(input.propertyValue) > 0 ? round2(Number(input.propertyValue)) : null;
  if (typedValue !== null && typedValue > band.propertyCap) {
    return { eligible: false, reason: "property_above_cap", faixa: band.faixa, propertyCap: band.propertyCap };
  }
  const propertyValue = typedValue ?? Math.min(DEFAULT_PROPERTY_VALUE, band.propertyCap);

  const cotista = input.hasOverThreeYearsRegisteredWork === true;
  const annualRate = band.rates[cotista ? 0 : 1];
  const monthlyRate = annualRate / 1200;
  const mip = mipRateForAge(Math.floor(ageMonths / 12));
  const adminFee = income > ADMIN_FEE_ABOVE ? ADMIN_FEE : 0;
  const dfi = DFI_RATE * propertyValue; // a Caixa calcula o DFI sobre o valor do imóvel (sem valor digitado, o teto da faixa)

  // Maior financiamento cuja 1ª parcela Price (com seguros e taxa) cabe em 30% da renda; nunca acima de 80% do teto.
  const maxInstallment = INCOME_COMMITMENT * income - INSTALLMENT_MARGIN_RATE * propertyValue;
  const byIncome = (maxInstallment - adminFee - dfi) / (priceFactor(monthlyRate, termMonths) + mip);
  const financing = round2(Math.min(byIncome, FINANCING_QUOTA * propertyValue));
  if (!(financing > 0)) return { eligible: false, reason: "income" };

  const fullFamily = input.hasChildrenUnder18 === true || secondary > 0;
  // Com valor digitado, o subsídio só cobre o que sobra do imóvel depois do financiamento (desconto no preço).
  const fitsInValue = (value) => (typedValue === null ? value : Math.max(0, Math.min(value, Math.round(typedValue - financing))));
  const subsidy = fitsInValue(estimateSubsidy({ income, cotista, fullFamily }));
  const usedSubsidy = fitsInValue(estimateUsedSubsidy({ income, cotista, fullFamily }));
  // A Caixa financia no máximo 80% do imóvel: para usar todo o financiamento, o imóvel vale pelo menos financiado ÷ 0,8
  // e a diferença que o subsídio não cobre é a entrada (linha separada).
  const downPaymentFor = (discount) => Math.max(0, Math.round((typedValue ?? financing / FINANCING_QUOTA) - financing - discount));
  const downPayment = downPaymentFor(subsidy);
  // "Pode comprar até" = financiado + subsídio, igual às apresentações (REGRA OFICIAL — dono, 2026-10-19): sem somar a
  // entrada nem o recurso informado.
  const purchasePower = round2(Math.min(propertyValue, financing + subsidy));

  const fixedCharges = adminFee + dfi + mip * financing;
  const priceFirst = round2(financing * priceFactor(monthlyRate, termMonths) + fixedCharges);
  const sacFirst = round2(financing / termMonths + financing * monthlyRate + fixedCharges);
  // Última parcela (como a Caixa mostra): Price = prestação pura + taxa de administração (calibrado: bate exato);
  // SAC = última amortização + juros sobre ela + taxa de administração.
  const priceLast = round2(financing * priceFactor(monthlyRate, termMonths) + adminFee);
  const sacLast = round2((financing / termMonths) * (1 + monthlyRate) + adminFee);

  return {
    eligible: true,
    version: ESTIMATE_VERSION,
    faixa: band.faixa,
    propertyValue,
    propertyValueTyped: typedValue !== null,
    propertyCap: band.propertyCap,
    income,
    cotista,
    annualRate,
    termMonths,
    financing,
    subsidy,
    downPayment,
    resource,
    purchasePower,
    priceFirstInstallment: priceFirst,
    priceLastInstallment: priceLast,
    sacFirstInstallment: sacFirst,
    sacLastInstallment: sacLast,
    used: {
      subsidy: usedSubsidy,
      downPayment: downPaymentFor(usedSubsidy),
      purchasePower: round2(Math.min(propertyValue, financing + usedSubsidy))
    },
    priceIncomeShare: round2((priceFirst / income) * 100),
    sacIncomeShare: round2((sacFirst / income) * 100)
  };
}

/**
 * Sugestões para a aba da simulação marcar "confira" (pedido do dono, 2026-10-19): PRAZO = o máximo permitido pela idade
 * do mais velho (420 meses ou até 80 anos e 6 meses) e TAXA = a da simulação automática, senão a última usada na
 * simulação, senão a da faixa de renda do cadastro. Cada uma diz a origem (`source`/`label`). Puro.
 */
export function simulationFieldSuggestions({ registration = {}, simulation = {}, automatic = false, referenceDate } = {}) {
  const ageMonths = ageInMonths(registration.oldestBirthDate, referenceDate);
  const maxTerm = ageMonths === null ? null : Math.min(MAX_TERM_MONTHS, MAX_AGE_PLUS_TERM_MONTHS - ageMonths);
  const termMonths = maxTerm !== null && maxTerm >= MIN_TERM_MONTHS
    ? { value: maxTerm, source: "idade", label: "Prazo máximo pela idade do mais velho" }
    : null;
  const storedRate = Number(simulation.interestRateAnnual) || 0;
  let annualRate = null;
  if (storedRate > 0) {
    annualRate = automatic
      ? { value: storedRate, source: "simulacao_automatica", label: "Taxa da simulação automática" }
      : { value: storedRate, source: "ultima_usada", label: "Última taxa usada nesta simulação" };
  } else {
    const estimate = estimateFinancing(registration, referenceDate, { incomeMode: "registered" });
    if (estimate.eligible) annualRate = { value: estimate.annualRate, source: "faixa_renda", label: "Taxa da faixa de renda do cadastro" };
  }
  // Valor do imóvel (REGRA OFICIAL — dono, 2026-10-19): padrão R$ 235.000 em todas as faixas; o corretor edita para mais
  // até o teto da faixa da renda (novo e usado podem ter rendas e tetos diferentes).
  const byIncome = estimateFinancing(registration, referenceDate, { incomeMode: "registered" });
  const propertyValue = byIncome.eligible
    ? {
        novo: { value: byIncome.propertyValue, faixa: byIncome.faixa, cap: byIncome.propertyCap },
        usado: { value: byIncome.used.propertyValue, faixa: byIncome.used.faixa, cap: byIncome.used.propertyCap },
        label: "Valor padrão do imóvel"
      }
    : null;
  return { termMonths, annualRate, propertyValue };
}

/** Data de hoje em São Paulo ("AAAA-MM-DD") — referência da idade na tela pública. (`getTodayInSaoPaulo` de
 * lib/daily-report.js importa o Supabase do servidor e não pode ir para o navegador.) */
export function todayInSaoPaulo(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}
