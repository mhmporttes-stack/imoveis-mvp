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
export const INSTALLMENT_MARGIN = 15.03; // calibrado: a 1ª parcela da Caixa sai sempre 30% da renda − R$ 15,03
export const FINANCING_QUOTA = 0.8; // calibrado: financiamento travado em exatamente 80% do valor do imóvel
export const ADMIN_FEE_ABOVE = 2850; // calibrado: taxa de administração só acima de R$ 2.850
export const ADMIN_FEE = 25;
export const DFI_RATE = 0.00007106; // calibrado: seguro de danos físicos, mensal, sobre o valor do imóvel
export const MAX_SUBSIDY = 55000; // gov.br (regiões fora do Norte)
export const SUBSIDY_INCOME_LIMIT = 4000; // REGRA OFICIAL — dono, 2026-10-19: subsídio zero acima de R$ 4.000 (igual à Caixa nos casos reais)
export const SINGLE_NO_DEPENDENT_SUBSIDY_FACTOR = 0.3; // calibrado: um só comprador sem filhos recebe 30% do desconto

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

/** Subsídio MCMV estimado. `fullFamily` = filhos menores de 18 ou dois compradores (renda da 2ª pessoa). */
export function estimateSubsidy({ income, cotista, fullFamily }) {
  if (!(income > 0) || income > SUBSIDY_INCOME_LIMIT) return 0;
  const full = income > 3500
    ? SUBSIDY_FLOOR_3500_4000
    : Math.min(MAX_SUBSIDY, interpolate(cotista ? SUBSIDY_POINTS.cotista : SUBSIDY_POINTS.naoCotista, income));
  return Math.round(fullFamily ? full : full * SINGLE_NO_DEPENDENT_SUBSIDY_FACTOR);
}

/**
 * Estimativa a partir dos dados da ficha do formulário (camelCase, como em `validateSimulationRegistration().data` e na
 * ficha do CRM). `referenceDate` = "AAAA-MM-DD" (data da simulação, para a idade).
 * Devolve { eligible: false, reason } quando não dá para estimar pelo MCMV — nesse caso a tela mostra o texto de sempre
 * (o corretor apresenta a simulação).
 */
export function estimateFinancing(input = {}, referenceDate) {
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

  const cotista = input.hasOverThreeYearsRegisteredWork === true;
  const annualRate = band.rates[cotista ? 0 : 1];
  const monthlyRate = annualRate / 1200;
  const mip = mipRateForAge(Math.floor(ageMonths / 12));
  const adminFee = income > ADMIN_FEE_ABOVE ? ADMIN_FEE : 0;
  const dfi = DFI_RATE * band.propertyCap; // a Caixa calcula o DFI sobre o valor do imóvel (aqui, o teto da faixa)

  // Maior financiamento cuja 1ª parcela Price (com seguros e taxa) cabe em 30% da renda; nunca acima de 80% do teto.
  const maxInstallment = INCOME_COMMITMENT * income - INSTALLMENT_MARGIN;
  const byIncome = (maxInstallment - adminFee - dfi) / (priceFactor(monthlyRate, termMonths) + mip);
  const financing = round2(Math.min(byIncome, FINANCING_QUOTA * band.propertyCap));
  if (!(financing > 0)) return { eligible: false, reason: "income" };

  const subsidy = estimateSubsidy({ income, cotista, fullFamily: input.hasChildrenUnder18 === true || secondary > 0 });
  // A Caixa financia no máximo 80% do imóvel: para usar todo o financiamento, o imóvel vale pelo menos financiado ÷ 0,8
  // e a diferença que o subsídio não cobre é a entrada (linha separada).
  const downPayment = Math.max(0, Math.round(financing / FINANCING_QUOTA - financing - subsidy));
  // "Pode comprar até" = financiado + subsídio, igual às apresentações (REGRA OFICIAL — dono, 2026-10-19): sem somar a
  // entrada nem o recurso informado.
  const purchasePower = round2(Math.min(band.propertyCap, financing + subsidy));

  const fixedCharges = adminFee + dfi + mip * financing;
  const priceFirst = round2(financing * priceFactor(monthlyRate, termMonths) + fixedCharges);
  const sacFirst = round2(financing / termMonths + financing * monthlyRate + fixedCharges);

  return {
    eligible: true,
    version: ESTIMATE_VERSION,
    faixa: band.faixa,
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
    sacFirstInstallment: sacFirst,
    priceIncomeShare: round2((priceFirst / income) * 100),
    sacIncomeShare: round2((sacFirst / income) * 100)
  };
}

/** Data de hoje em São Paulo ("AAAA-MM-DD") — referência da idade na tela pública. (`getTodayInSaoPaulo` de
 * lib/daily-report.js importa o Supabase do servidor e não pode ir para o navegador.) */
export function todayInSaoPaulo(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}
