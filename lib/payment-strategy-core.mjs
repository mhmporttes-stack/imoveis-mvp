// Estratégia de pagamento (amortização extraordinária) da apresentação da simulação — motor PURO, sem servidor.
// Regra do dono (2026-10-17/18, docs/BUSINESS_RULES.md PRES-24): a amortização extra REDUZ O PRAZO; a parcela segue o
// sistema da simulação:
//  - PRICE: a prestação (juros + amortização) calculada para o prazo original fica FIXA; o valor extra abate o saldo e o
//    contrato termina antes.
//  - SAC: a cota de amortização mensal (saldo inicial ÷ prazo) fica FIXA; os juros caem com o saldo e o contrato termina antes.
// Juros: taxa NOMINAL anual da simulação (ou deduzida da parcela, `deduceAnnualRate`) ÷ 12 (convenção do SFH; a "taxa efetiva" é derivada dela). Valores em centavos
// arredondados a cada mês. O motor não conhece seguros nem taxa de administração (a parcela digitada da Caixa os inclui):
// só compara juros e prazo com e sem a estratégia. Não toca nos números da apresentação nem do PDF da simulação.

// Nome visível da funcionalidade (regra do dono, 2026-10-18: "ESTRATÉGIA COM AMORTIZAÇÃO"; antes "Estratégia de pagamento").
// Fonte única para botão, título da folha e resumo do CRM.
export const STRATEGY_NAME = "Estratégia com amortização";
export const STRATEGY_NAME_CAPS = "ESTRATÉGIA COM AMORTIZAÇÃO";

export const STRATEGY_MAX_TERM = 600;
// Prazo padrão da estratégia quando a simulação não tem prazo (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-18: "é o caso quase
// sempre"). Só para prazo EM BRANCO/zero; prazo digitado inválido (> 600) continua sem estratégia.
export const DEFAULT_STRATEGY_TERM = 420;
export const STRATEGY_MAX_AMOUNT = 10_000_000;
export const FGTS_INTERVAL_MONTHS = 24;
export const FGTS_MONTHLY_RATE = 0.08; // depósito mensal do FGTS: 8% do salário bruto
// 13º sempre em DEZEMBRO (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-19: o seletor de mês saiu). Escolha antiga gravada com
// outro mês é ignorada: o motor usa sempre este mês.
export const THIRTEENTH_SALARY_MONTH = 12;
// "Valor extra por ano" também sempre em DEZEMBRO (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-19: o seletor de mês saiu,
// igual ao 13º). Escolha antiga gravada com outro mês é tratada como dezembro.
export const DEFAULT_ANNUAL_EXTRA_MONTH = 12;

export const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const round2 = (value) => Math.round(value * 100) / 100;

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function validMonth(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 12 ? number : fallback;
}

/** Mês do calendário (1-12) da parcela `k` (1 = primeira), sabendo o mês da primeira parcela. */
export function calendarMonthOf(k, startMonth = 1) {
  return ((validMonth(startMonth, 1) - 1 + k - 1) % 12) + 1;
}

/** Prestação fixa da Tabela Price. Taxa zero → saldo ÷ prazo. */
export function pricePayment(principal, monthlyRate, months) {
  if (!(months > 0)) return 0;
  if (!(monthlyRate > 0)) return round2(principal / months);
  return round2((principal * monthlyRate) / (1 - (1 + monthlyRate) ** -months));
}

/**
 * Valor extra a abater no mês `k` (já somados 13º, FGTS a cada 2 anos, extra mensal e extra anual).
 * `extras` vem de `choicesToExtras` (só opções ligadas e com valor > 0).
 */
export function extraForMonth(k, startMonth, extras = {}) {
  const month = calendarMonthOf(k, startMonth);
  let total = 0;
  if (extras.decimoTerceiro && month === THIRTEENTH_SALARY_MONTH) total += positive(extras.decimoTerceiro.valor);
  if (extras.fgts) {
    const every = Number.isInteger(extras.fgts.intervaloMeses) && extras.fgts.intervaloMeses > 0 ? extras.fgts.intervaloMeses : FGTS_INTERVAL_MONTHS;
    if (k % every === 0) total += positive(extras.fgts.valor);
  }
  if (extras.extraMensal) total += positive(extras.extraMensal.valor);
  if (extras.extraAnual && month === DEFAULT_ANNUAL_EXTRA_MONTH) total += positive(extras.extraAnual.valor); // sempre dezembro
  return round2(total);
}

/**
 * Evolução do financiamento mês a mês.
 * @param {{ principal:number, annualRate:number, termMonths:number, system:"price"|"sac", startMonth?:number, extras?:object }} input
 *   annualRate em % ao ano (ex.: 5.4). extras: { decimoTerceiro:{valor,mes}, fgts:{valor,intervaloMeses?}, extraMensal:{valor}, extraAnual:{valor,mes} }
 * @returns {{ months:number, totalInterest:number, totalPaid:number, totalExtra:number, balances:number[], paidOffEarly:boolean }}
 *   balances[0] = saldo inicial; balances[k] = saldo depois do mês k (já com o extra do mês).
 */
export function simulateFinancing({ principal, annualRate, termMonths, system = "price", startMonth = 1, extras = {} } = {}) {
  const P = round2(positive(principal));
  const n = Math.min(Math.floor(positive(termMonths)), STRATEGY_MAX_TERM);
  const i = positive(annualRate) / 100 / 12;
  const empty = { months: 0, totalInterest: 0, totalPaid: 0, totalExtra: 0, balances: [P], paidOffEarly: false };
  if (!P || !n) return empty;

  const sac = system === "sac";
  const fixedPayment = sac ? 0 : pricePayment(P, i, n);
  const fixedAmortization = sac ? round2(P / n) : 0;
  let balance = P;
  let totalInterest = 0;
  let totalPaid = 0;
  let totalExtra = 0;
  const balances = [P];
  let k = 0;

  while (balance > 0 && k < n) {
    k += 1;
    const interest = round2(balance * i);
    let amortization = sac ? fixedAmortization : round2(fixedPayment - interest);
    // última parcela do prazo original (ou amortização que já cobre o saldo): quita o resto, inclusive centavos de arredondamento
    if (k === n || amortization >= balance) amortization = balance;
    if (amortization < 0) amortization = 0;
    balance = round2(balance - amortization);
    totalInterest = round2(totalInterest + interest);
    totalPaid = round2(totalPaid + interest + amortization);

    if (balance > 0) {
      const extra = Math.min(extraForMonth(k, startMonth, extras), balance);
      if (extra > 0) {
        balance = round2(balance - extra);
        totalExtra = round2(totalExtra + extra);
        totalPaid = round2(totalPaid + extra);
      }
    }
    balances.push(balance);
  }
  return { months: k, totalInterest, totalPaid, totalExtra, balances, paidOffEarly: k < n };
}

/** "35 anos", "12 anos e 4 meses", "8 meses", "1 ano e 1 mês". */
export function formatDuration(months) {
  const total = Math.max(0, Math.round(Number(months) || 0));
  const years = Math.floor(total / 12);
  const rest = total % 12;
  const y = years ? `${years} ${years === 1 ? "ano" : "anos"}` : "";
  const m = rest ? `${rest} ${rest === 1 ? "mês" : "meses"}` : "";
  if (y && m) return `${y} e ${m}`;
  return y || m || "0 meses";
}

// Gráfico da Estratégia (dono, 2026-10-19): "arredonde a diferença de anos entre as linhas sempre para apenas os anos, remova
// parte de mês" e, na ponta de cada linha, só os anos ("11 anos"). Cada ponta arredonda ao ano mais próximo (mínimo 1) e a
// diferença é a das próprias pontas — o que o cliente lê bate na conta (35 − 11 = 24). Só rótulo do gráfico: as colunas
// "Sem/Com amortização" e o PDF continuam com o prazo exato (formatDuration).
export function roundedYears(months) {
  const value = Math.max(0, Number(months) || 0);
  return value > 0 ? Math.max(1, Math.round(value / 12)) : 0;
}

export function formatRoundedYears(months) {
  const years = roundedYears(months);
  return `${years} ${years === 1 ? "ano" : "anos"}`;
}

/** "N anos a menos" entre as pontas das linhas; "" quando a diferença arredondada é 0 (o texto não aparece). */
export function yearsLessText(semMonths, comMonths) {
  const diff = roundedYears(semMonths) - roundedYears(comMonths);
  return diff > 0 ? `${diff} ${diff === 1 ? "ano" : "anos"} a menos` : "";
}

// ---------- 13º LÍQUIDO estimado (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-19, PRES-24) ----------
// "o 13º automático passa a usar o valor LÍQUIDO aproximado, não o bruto": 13º líquido = bruto − INSS (tabela progressiva do
// empregado) − IRRF exclusivo do 13º (tabela progressiva mensal, base = bruto − INSS, sem dependentes). Calculado POR PESSOA
// CLT (cada uma com o seu INSS/IR) e somado. O FGTS continua sobre o BRUTO. Tabelas num só lugar (abaixo) — ao virar o ano,
// atualize as duas e a vigência.
//
// INSS do empregado — vigência a partir da competência janeiro/2026: Portaria Interministerial MPS/MF nº 13, de 09/01/2026
// (fonte: gov.br/inss › "Tabela de contribuição mensal", consultada em 2026-10-19). Faixas: [teto da faixa, alíquota].
export const INSS_EMPLOYEE_BRACKETS_2026 = [
  [1621.0, 0.075],
  [2902.84, 0.09],
  [4354.27, 0.12],
  [8475.55, 0.14] // teto do salário de contribuição
];
// IRRF — tabela progressiva mensal a partir de janeiro/2026 (Lei nº 15.191/2025; fonte: gov.br/receitafederal › Meu Imposto de
// Renda › Tabelas › 2026, consultada em 2026-10-19). Faixas: [teto da base, alíquota, parcela a deduzir].
export const IRRF_MONTHLY_BRACKETS_2026 = [
  [2428.8, 0, 0],
  [2826.65, 0.075, 182.16],
  [3751.05, 0.15, 394.16],
  [4664.68, 0.225, 675.49],
  [Infinity, 0.275, 908.73]
];
// Redução da Lei nº 15.270/2025 (isenção até R$ 5.000 a partir de 2026): rendimento tributável até 5.000 → imposto zero
// (redução de até 312,89); de 5.000,01 a 7.350 → redução = 978,62 − 0,133145 × rendimento; acima de 7.350 → sem redução.
// A CONFIRMAR COM O DONO/CONTADOR: a fonte oficial consultada (gov.br/receitafederal, exemplos da Lei 15.270, 2026-10-19) fala
// só de "rendimentos sujeitos à incidência mensal" e não diz se vale para o 13º (tributação exclusiva). Por isso fica DESLIGADA
// (estimativa conservadora: o líquido não fica maior do que pode ser). Para ligar, basta trocar para true.
export const APPLY_IR_REDUCTION_TO_13TH = false;
export const IR_REDUCTION_2026 = { fullUpTo: 5000, phaseOutUpTo: 7350, a: 978.62, b: 0.133145 }; // até 5.000: "imposto devido seja zero"

const cents = (value) => Math.round((Number(value) + 1e-9) * 100) / 100;

/** INSS do empregado (tabela progressiva, com teto) sobre o salário bruto. */
export function employeeInss(gross) {
  const salary = positive(gross);
  let previous = 0;
  let total = 0;
  for (const [ceiling, rate] of INSS_EMPLOYEE_BRACKETS_2026) {
    if (salary <= previous) break;
    total += (Math.min(salary, ceiling) - previous) * rate;
    previous = ceiling;
  }
  return cents(total);
}

/** IRRF exclusivo do 13º: tabela progressiva mensal sobre (bruto − INSS), sem dependentes. */
export function thirteenthIrrf(gross) {
  const salary = positive(gross);
  const base = Math.max(0, salary - employeeInss(salary));
  const [, rate, deduction] = IRRF_MONTHLY_BRACKETS_2026.find(([ceiling]) => base <= ceiling);
  let tax = Math.max(0, cents(base * rate - deduction));
  if (APPLY_IR_REDUCTION_TO_13TH && tax > 0) {
    const r = IR_REDUCTION_2026;
    const reduction = salary <= r.fullUpTo ? tax : salary <= r.phaseOutUpTo ? Math.max(0, cents(r.a - r.b * salary)) : 0;
    tax = Math.max(0, cents(tax - reduction));
  }
  return tax;
}

/** 13º salário LÍQUIDO estimado de UMA pessoa: bruto − INSS − IRRF do 13º. Função pura. */
export function net13thSalary(gross) {
  const salary = positive(gross);
  if (!salary) return 0;
  return cents(salary - employeeInss(salary) - thirteenthIrrf(salary));
}

// ---------- quais opções valem para o cliente (regras do dono, 2026-10-18, PRES-24) ----------
// 1ª decisão: "FGTS e 13º [...] apenas para clientes que têm no cadastro o regime CLT [...] Se o cliente for informal [...] a
// única opção disponível é o valor mensal [...] adicionar também um valor anual." 2ª decisão (mesmo dia): a restituição do IR
// saiu; 13º e FGTS são AUTOMÁTICOS (sem campo de valor), calculados no servidor pela renda bruta CLT do cadastro:
//   13º  = 13º LÍQUIDO estimado de cada pessoa CLT, somados (dono, 2026-10-19; antes 1 salário bruto), sempre em dezembro;
//   FGTS = salário × 8% × 24, a cada 2 anos (meses 24, 48, ...).
// Salário = `primary_monthly_income` (se `primary_income_type` = CLT) + `secondary_monthly_income` (só em simulação conjunta e
// se `secondary_income_type` = CLT). Sem renda CLT → as duas opções não existem (só o extra por mês e, se informal, por ano).
export const GATED_OPTION_KEYS = ["decimoTerceiro", "fgts"];
const CLT_INCOME_TYPE = "registered_employment";
// 3ª decisão (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-18): "Valor extra por ano" só para cliente INFORMAL (Autônomo ou sem
// tipo de renda). Se alguém da simulação (titular; e o 2º participante em simulação conjunta) for CLT ou Declarante de IR, a
// opção não existe. "Valor extra por mês" continua para todos.
const FORMAL_INCOME_TYPES = [CLT_INCOME_TYPE, "income_tax_declarant"];

/** Cliente informal? (ninguém da simulação é CLT nem Declarante de IR; sem cadastro/tipo de renda = informal). Servidor apenas. */
export function isInformalRegistration(registration) {
  if (!registration) return true;
  if (FORMAL_INCOME_TYPES.includes(registration.primaryIncomeType)) return false;
  if (registration.simulationType === "joint" && FORMAL_INCOME_TYPES.includes(registration.secondaryIncomeType)) return false;
  return true;
}

/** Salários brutos CLT do cadastro, um por pessoa CLT (titular; 2º participante só em simulação conjunta). Servidor apenas. */
export function cltMonthlyIncomes(registration) {
  if (!registration) return [];
  const incomes = [];
  if (registration.primaryIncomeType === CLT_INCOME_TYPE) incomes.push(positive(registration.primaryMonthlyIncome));
  if (registration.simulationType === "joint" && registration.secondaryIncomeType === CLT_INCOME_TYPE) incomes.push(positive(registration.secondaryMonthlyIncome));
  return incomes;
}

/** Renda mensal bruta CLT do cadastro (só das pessoas CLT). Servidor apenas: nunca vai ao DTO público. */
export function cltMonthlyIncome(registration) {
  return round2(cltMonthlyIncomes(registration).reduce((sum, value) => sum + value, 0));
}

/**
 * Opções do cliente (vão no DTO público; nunca a renda nem o tipo de renda): valores automáticos de 13º/FGTS (0 = opção
 * indisponível) e `extraAnual` (booleano: só informal).
 */
export function strategyOptionsFromRegistration(registration) {
  const salary = cltMonthlyIncome(registration);
  // 13º: líquido POR PESSOA e somado (cada uma tem o seu INSS/IR — nunca sobre a soma). FGTS: sobre o bruto.
  const decimoTerceiro = round2(cltMonthlyIncomes(registration).reduce((sum, value) => sum + net13thSalary(value), 0));
  return { decimoTerceiro, fgts: round2(salary * FGTS_MONTHLY_RATE * FGTS_INTERVAL_MONTHS), extraAnual: isInformalRegistration(registration) };
}

/** Opção permitida para esta base? Extra mensal vale para todos; extra anual só com `opcoes.extraAnual === true` (informal); 13º/FGTS só com valor automático > 0. */
export function isOptionAllowed(base, key) {
  if (key === "extraMensal") return true;
  if (key === "extraAnual") return base?.opcoes?.extraAnual === true;
  const value = base?.opcoes?.[key];
  return GATED_OPTION_KEYS.includes(key) && typeof value === "number" && positive(value) > 0;
}

/** Valor automático da opção (13º por ano / FGTS a cada 2 anos) para esta base; 0 se indisponível. */
export function automaticOptionValue(base, key) {
  return isOptionAllowed(base, key) && GATED_OPTION_KEYS.includes(key) ? round2(positive(base.opcoes[key])) : 0;
}

// ---------- escolhas do cliente/corretor (entrada da tela e do endpoint público) ----------
// 13º e FGTS NÃO aceitam `valor` (o servidor calcula; valor vindo do cliente → recusa). O 13º não tem mais mês (sempre
// dezembro, 2026-10-19) e o extra anual também não (dezembro, 2026-10-19): `mes` ainda é ACEITO nos dois (tela antiga
// aberta / escolha gravada antes) mas ignorado.
export const CHOICE_KEYS = ["decimoTerceiro", "fgts", "extraMensal", "extraAnual"];
const OPTION_KEYS = { decimoTerceiro: ["ativo", "mes"], fgts: ["ativo"], extraMensal: ["ativo", "valor"], extraAnual: ["ativo", "valor", "mes"] };
const MONTH_OPTION_KEYS = [];
const IGNORED_OPTION_KEYS = { decimoTerceiro: ["mes"], extraAnual: ["mes"] }; // aceitos na entrada, nunca guardados nem reenviados
const AMOUNT_OPTION_KEYS = ["extraMensal", "extraAnual"];

export function emptyChoices() {
  return {
    decimoTerceiro: { ativo: false },
    fgts: { ativo: false },
    extraMensal: { ativo: false, valor: 0 },
    extraAnual: { ativo: false, valor: 0 }
  };
}

function cleanAmount(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number) || number < 0 || number > STRATEGY_MAX_AMOUNT) return null;
  return round2(number);
}

/**
 * Valida as escolhas (allowlist ESTRITA: chave desconhecida, tipo errado ou valor fora do limite → null).
 * Formato: { decimoTerceiro:{ativo,mes}, fgts:{ativo}, extraMensal:{ativo,valor}, extraAnual:{ativo,valor,mes} }.
 * Não sabe quais opções valem para o cliente: depois de carregar a base, o servidor confere com `choicesFitBase`.
 */
export function parseStrategyChoices(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (Object.keys(input).some((key) => !CHOICE_KEYS.includes(key))) return null;
  const result = emptyChoices();
  for (const key of CHOICE_KEYS) {
    const option = input[key];
    if (option === undefined) continue;
    if (!option || typeof option !== "object" || Array.isArray(option)) return null;
    if (Object.keys(option).some((field) => !OPTION_KEYS[key].includes(field))) return null;
    if (option.ativo !== undefined && typeof option.ativo !== "boolean") return null;
    result[key].ativo = option.ativo === true;
    if (AMOUNT_OPTION_KEYS.includes(key)) {
      const valor = cleanAmount(option.valor);
      if (valor === null) return null;
      result[key].valor = valor;
    }
    if ((MONTH_OPTION_KEYS.includes(key) || IGNORED_OPTION_KEYS[key]?.includes("mes")) && option.mes !== undefined) {
      if (!Number.isInteger(option.mes) || option.mes < 1 || option.mes > 12) return null;
      if (MONTH_OPTION_KEYS.includes(key)) result[key].mes = option.mes;
    }
  }
  return result;
}

/** Escolhas → corpo do POST (só os campos aceitos por `parseStrategyChoices`; nunca o valor automático de 13º/FGTS). */
export function choicesForRequest(choices) {
  const out = {};
  for (const key of CHOICE_KEYS) {
    const option = choices?.[key];
    if (option) out[key] = Object.fromEntries(OPTION_KEYS[key].filter((field) => option[field] !== undefined && !IGNORED_OPTION_KEYS[key]?.includes(field)).map((field) => [field, option[field]]));
  }
  return out;
}

/** Escolhas gravadas (formato antigo ou novo) → escolhas válidas, sem recusar: só os campos conhecidos (prévia do CRM). */
export function choicesFromSaved(saved) {
  if (!saved || typeof saved !== "object") return emptyChoices();
  return parseStrategyChoices(choicesForRequest(saved)) || emptyChoices();
}

/** As escolhas cabem na base? Falso se alguma opção NÃO permitida para o cliente vier ligada ou com valor. */
export function choicesFitBase(choices, base) {
  return CHOICE_KEYS.every((key) => isOptionAllowed(base, key) || choices?.[key]?.ativo !== true);
}

/**
 * Cópia das escolhas com as opções não permitidas zeradas e o valor AUTOMÁTICO de 13º/FGTS preenchido pela base (é o que se
 * grava em `payment_strategy.escolhas`, para o painel do CRM mostrar o valor usado).
 */
export function restrictChoices(choices, base) {
  const empty = emptyChoices();
  const result = {};
  for (const key of CHOICE_KEYS) {
    if (!isOptionAllowed(base, key)) {
      result[key] = empty[key];
      continue;
    }
    result[key] = { ...empty[key], ...(choices?.[key] || {}) };
    if (GATED_OPTION_KEYS.includes(key)) result[key].valor = automaticOptionValue(base, key);
  }
  return result;
}

/**
 * Escolhas → extras do motor (só opções ligadas e com valor > 0). Com `base`: só as permitidas, 13º/FGTS com o valor
 * automático da base. Sem `base` (painel do CRM lendo uma estratégia já gravada): usa o valor gravado.
 */
export function choicesToExtras(choices, base) {
  const c = base === undefined ? choices || {} : restrictChoices(choices, base);
  const on = (key) => c[key]?.ativo === true && positive(c[key]?.valor) > 0;
  const extras = {};
  if (on("decimoTerceiro")) extras.decimoTerceiro = { valor: c.decimoTerceiro.valor, mes: THIRTEENTH_SALARY_MONTH }; // mês gravado antigo é ignorado
  if (on("fgts")) extras.fgts = { valor: c.fgts.valor, intervaloMeses: FGTS_INTERVAL_MONTHS };
  if (on("extraMensal")) extras.extraMensal = { valor: c.extraMensal.valor };
  if (on("extraAnual")) extras.extraAnual = { valor: c.extraAnual.valor, mes: DEFAULT_ANNUAL_EXTRA_MONTH }; // mês gravado antigo é ignorado
  return extras;
}

export function hasActiveExtras(choices, base) {
  return Object.keys(choicesToExtras(choices, base)).length > 0;
}

/** Texto curto das opções ligadas (PDF, painel do CRM). Com `base`, só as opções permitidas para o cliente. */
export function describeChoices(choices, formatMoney, base) {
  const extras = choicesToExtras(choices, base);
  const money = typeof formatMoney === "function" ? formatMoney : (value) => String(value);
  const lines = [];
  // "(líquido estimado)" só com a base (valor recalculado agora); sem base = valor gravado, que pode ser o bruto de antes de 2026-10-19
  if (extras.decimoTerceiro) lines.push(`13º salário${base === undefined ? "" : " (líquido estimado)"}: ${money(extras.decimoTerceiro.valor)} por ano, em dezembro`);
  if (extras.fgts) lines.push(`FGTS: ${money(extras.fgts.valor)} a cada 2 anos`);
  if (extras.extraMensal) lines.push(`Valor extra: ${money(extras.extraMensal.valor)} por mês`);
  if (extras.extraAnual) lines.push(`Valor extra: ${money(extras.extraAnual.valor)} por ano, em dezembro`);
  return lines;
}

/** "Com R$ 100/mês + R$ 1.000/ano você quita seu imóvel em 28 anos e economiza R$ 40.000,00 de juros." (null sem economia) */
export function strategyHeadline(comparison, choices, base, formatMoney) {
  if (!comparison || !(comparison.economiaJuros > 0)) return null;
  const extras = choicesToExtras(choices, base);
  const money = typeof formatMoney === "function" ? formatMoney : (value) => String(value);
  const parts = [];
  if (extras.extraMensal) parts.push(`${money(extras.extraMensal.valor)}/mês`);
  if (extras.extraAnual) parts.push(`${money(extras.extraAnual.valor)}/ano`);
  if (extras.decimoTerceiro) parts.push(`13º líquido de ${money(extras.decimoTerceiro.valor)}`);
  if (extras.fgts) parts.push(`FGTS de ${money(extras.fgts.valor)} a cada 2 anos`);
  if (!parts.length) return null;
  return `Com ${parts.join(" + ")} você quita seu imóvel em ${formatDuration(comparison.com.months)} e economiza ${money(comparison.economiaJuros)} de juros.`;
}

// ---------- taxa deduzida da parcela (simulação sem taxa gravada) ----------
// Pedido do dono (2026-10-18): o botão some na maioria das simulações porque a taxa é campo opcional. Sem taxa gravada, a
// taxa NOMINAL anual é deduzida da própria parcela digitada do modelo destacado — nunca um valor padrão inventado:
//  - PRICE: resolve i em parcela = F·i / (1 − (1+i)^−n) (bisseção). Usa a ÚLTIMA parcela quando existe: na Caixa os
//    seguros (MIP/DFI) e a taxa de administração pesam na 1ª e quase somem na última (nas simulações reais com taxa
//    gravada, a última devolve a taxa exata ou ~0,1–0,2 p.p. acima; a 1ª, ~0,3–0,7 p.p. acima). Sem a última, usa a 1ª.
//  - SAC: i = (1ª parcela − F/n) / F.
// O modelo não separa seguros/taxa de administração da parcela, então a taxa deduzida tende a ficar um pouco ACIMA da
// real (economia de juros um pouco maior). Fora de 0,5% a 20% ao ano → sem taxa (sem estratégia).
export const DEDUCED_RATE_MIN = 0.5;
export const DEDUCED_RATE_MAX = 20;

/** Taxa nominal anual (% a.a., 2 casas) deduzida da parcela, ou null quando não dá para deduzir com segurança. */
export function deduceAnnualRate({ system = "price", financing, termMonths, firstInstallment, lastInstallment } = {}) {
  const F = positive(financing);
  const n = Number(termMonths);
  if (!F || !Number.isInteger(n) || n <= 0 || n > STRATEGY_MAX_TERM) return null;
  let monthly = null;
  if (system === "sac") {
    const first = positive(firstInstallment);
    if (first) monthly = (first - F / n) / F;
  } else {
    const payment = positive(lastInstallment) || positive(firstInstallment);
    const maxMonthly = DEDUCED_RATE_MAX / 100 / 12;
    const paymentAt = (i) => (F * i) / (1 - (1 + i) ** -n);
    // parcela abaixo da amortização pura (F/n) ou acima da parcela do teto → fora da faixa
    if (payment && payment > F / n && payment <= paymentAt(maxMonthly * 1.01)) {
      let low = 0;
      let high = maxMonthly * 1.01;
      for (let step = 0; step < 100; step += 1) {
        const mid = (low + high) / 2;
        if (paymentAt(mid) < payment) low = mid;
        else high = mid;
      }
      monthly = (low + high) / 2;
    }
  }
  if (monthly === null || !Number.isFinite(monthly)) return null;
  const annual = round2(monthly * 12 * 100);
  return annual >= DEDUCED_RATE_MIN && annual <= DEDUCED_RATE_MAX ? annual : null;
}

// ---------- base (números da simulação) e comparação ----------
/** Base válida para a estratégia? (financiamento, taxa e prazo maiores que zero; sistema conhecido). `opcoes` = flags. */
export function isStrategyBase(base) {
  return Boolean(base) && positive(base.financiamento) > 0 && positive(base.taxaAnual) > 0
    && Number.isInteger(base.prazoMeses) && base.prazoMeses > 0 && base.prazoMeses <= STRATEGY_MAX_TERM
    && (base.sistema === "price" || base.sistema === "sac");
}

/**
 * Sem estratégia × com estratégia. `base` = { financiamento, taxaAnual, prazoMeses, sistema, mesInicial, opcoes }.
 * Devolve null quando a base não serve. `economiaJuros`/`mesesAMenos` nunca negativos. Opção não permitida pela base
 * (`opcoes`, PRES-24 2026-10-18) nunca entra no cálculo, mesmo que venha ligada.
 */
export function compareStrategy(base, choices) {
  if (!isStrategyBase(base)) return null;
  const common = { principal: base.financiamento, annualRate: base.taxaAnual, termMonths: base.prazoMeses, system: base.sistema, startMonth: validMonth(base.mesInicial, 1) };
  const sem = simulateFinancing(common);
  const com = simulateFinancing({ ...common, extras: choicesToExtras(choices, base) });
  return {
    sem,
    com,
    economiaJuros: Math.max(0, round2(sem.totalInterest - com.totalInterest)),
    mesesAMenos: Math.max(0, sem.months - com.months)
  };
}

/** Resumo gravável/exibível (sem a série de saldos). */
export function strategySummary(comparison) {
  if (!comparison) return null;
  return {
    mesesSem: comparison.sem.months,
    mesesCom: comparison.com.months,
    jurosSem: comparison.sem.totalInterest,
    jurosCom: comparison.com.totalInterest,
    economiaJuros: comparison.economiaJuros,
    totalExtra: comparison.com.totalExtra
  };
}

/**
 * Gráfico do saldo devedor (SVG sem biblioteca): duas linhas, uma amostra por ano (e o último mês).
 * Devolve { sem, com } com o atributo `d` de cada <path> num quadro width × height (origem no canto superior esquerdo).
 */
export function balanceChartPaths(comparison, { width = 320, height = 160 } = {}) {
  if (!comparison) return { sem: "", com: "" };
  const top = comparison.sem.balances[0] || 1;
  const span = Math.max(1, comparison.sem.months);
  const path = (balances) => {
    const points = [];
    for (let k = 0; k < balances.length; k += 12) points.push(k);
    if (points[points.length - 1] !== balances.length - 1) points.push(balances.length - 1);
    return points
      .map((k, index) => `${index ? "L" : "M"}${round2((k / span) * width)} ${round2(height - (balances[k] / top) * height)}`)
      .join(" ");
  };
  return { sem: path(comparison.sem.balances), com: path(comparison.com.balances) };
}

/** Mensagem pronta do cliente para o WhatsApp (só o primeiro nome; nenhum dado sensível). */
export function buildStrategyMessage({ firstName = "", comparison, formatMoney } = {}) {
  const name = String(firstName || "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().split(/\s+/)[0]?.slice(0, 40) || "";
  const money = typeof formatMoney === "function" ? formatMoney : (value) => String(value);
  const hello = `Olá! ${name ? `Aqui é ${name}. ` : ""}`;
  if (!comparison || comparison.economiaJuros <= 0) return `${hello}Vi a estratégia com amortização da minha simulação e quero conversar sobre ela.`;
  return `${hello}Montei a estratégia com amortização da minha simulação: quitar em ${formatDuration(comparison.com.months)} em vez de ${formatDuration(comparison.sem.months)}, com ${money(comparison.economiaJuros)} a menos de juros. Podemos conversar?`;
}
