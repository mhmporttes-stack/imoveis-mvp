// Estratégia de pagamento (amortização extraordinária) da apresentação da simulação — motor PURO, sem servidor.
// Regra do dono (2026-10-17/18, docs/BUSINESS_RULES.md PRES-24): a amortização extra REDUZ O PRAZO; a parcela segue o
// sistema da simulação:
//  - PRICE: a prestação (juros + amortização) calculada para o prazo original fica FIXA; o valor extra abate o saldo e o
//    contrato termina antes.
//  - SAC: a cota de amortização mensal (saldo inicial ÷ prazo) fica FIXA; os juros caem com o saldo e o contrato termina antes.
// Juros: taxa NOMINAL anual da simulação ÷ 12 (convenção do SFH; a "taxa efetiva" é derivada dela). Valores em centavos
// arredondados a cada mês. O motor não conhece seguros nem taxa de administração (a parcela digitada da Caixa os inclui):
// só compara juros e prazo com e sem a estratégia. Não toca nos números da apresentação nem do PDF da simulação.

export const STRATEGY_MAX_TERM = 600;
export const STRATEGY_MAX_AMOUNT = 10_000_000;
export const FGTS_INTERVAL_MONTHS = 24;
export const IR_REFUND_MONTH = 6; // junho: começo dos lotes de restituição
export const DEFAULT_13TH_MONTH = 12;

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
 * Valor extra a abater no mês `k` (já somados 13º, restituição do IR, FGTS a cada 2 anos e extra mensal).
 * `extras` vem de `choicesToExtras` (só opções ligadas e com valor > 0).
 */
export function extraForMonth(k, startMonth, extras = {}) {
  const month = calendarMonthOf(k, startMonth);
  let total = 0;
  if (extras.decimoTerceiro && month === validMonth(extras.decimoTerceiro.mes, DEFAULT_13TH_MONTH)) total += positive(extras.decimoTerceiro.valor);
  if (extras.restituicaoIr && month === validMonth(extras.restituicaoIr.mes, IR_REFUND_MONTH)) total += positive(extras.restituicaoIr.valor);
  if (extras.fgts) {
    const every = Number.isInteger(extras.fgts.intervaloMeses) && extras.fgts.intervaloMeses > 0 ? extras.fgts.intervaloMeses : FGTS_INTERVAL_MONTHS;
    if (k % every === 0) total += positive(extras.fgts.valor);
  }
  if (extras.extraMensal) total += positive(extras.extraMensal.valor);
  return round2(total);
}

/**
 * Evolução do financiamento mês a mês.
 * @param {{ principal:number, annualRate:number, termMonths:number, system:"price"|"sac", startMonth?:number, extras?:object }} input
 *   annualRate em % ao ano (ex.: 5.4). extras: { decimoTerceiro:{valor,mes}, restituicaoIr:{valor,mes?}, fgts:{valor,intervaloMeses?}, extraMensal:{valor} }
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

// ---------- escolhas do cliente/corretor (entrada da tela e do endpoint público) ----------
export const CHOICE_KEYS = ["decimoTerceiro", "restituicaoIr", "fgts", "extraMensal"];
const OPTION_KEYS = { decimoTerceiro: ["ativo", "valor", "mes"], restituicaoIr: ["ativo", "valor"], fgts: ["ativo", "valor"], extraMensal: ["ativo", "valor"] };

export function emptyChoices() {
  return {
    decimoTerceiro: { ativo: false, valor: 0, mes: DEFAULT_13TH_MONTH },
    restituicaoIr: { ativo: false, valor: 0 },
    fgts: { ativo: false, valor: 0 },
    extraMensal: { ativo: false, valor: 0 }
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
 * Formato: { decimoTerceiro:{ativo,valor,mes}, restituicaoIr:{ativo,valor}, fgts:{ativo,valor}, extraMensal:{ativo,valor} }.
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
    const valor = cleanAmount(option.valor);
    if (valor === null) return null;
    result[key].ativo = option.ativo === true;
    result[key].valor = valor;
    if (key === "decimoTerceiro" && option.mes !== undefined) {
      if (!Number.isInteger(option.mes) || option.mes < 1 || option.mes > 12) return null;
      result[key].mes = option.mes;
    }
  }
  return result;
}

/** Escolhas → extras do motor (só opções ligadas e com valor > 0). */
export function choicesToExtras(choices) {
  const c = choices || {};
  const on = (key) => c[key]?.ativo === true && positive(c[key]?.valor) > 0;
  const extras = {};
  if (on("decimoTerceiro")) extras.decimoTerceiro = { valor: c.decimoTerceiro.valor, mes: validMonth(c.decimoTerceiro.mes, DEFAULT_13TH_MONTH) };
  if (on("restituicaoIr")) extras.restituicaoIr = { valor: c.restituicaoIr.valor, mes: IR_REFUND_MONTH };
  if (on("fgts")) extras.fgts = { valor: c.fgts.valor, intervaloMeses: FGTS_INTERVAL_MONTHS };
  if (on("extraMensal")) extras.extraMensal = { valor: c.extraMensal.valor };
  return extras;
}

export function hasActiveExtras(choices) {
  return Object.keys(choicesToExtras(choices)).length > 0;
}

/** Texto curto das opções ligadas (PDF, painel do CRM). */
export function describeChoices(choices, formatMoney) {
  const extras = choicesToExtras(choices);
  const money = typeof formatMoney === "function" ? formatMoney : (value) => String(value);
  const lines = [];
  if (extras.decimoTerceiro) lines.push(`13º salário: ${money(extras.decimoTerceiro.valor)} por ano, em ${MONTH_NAMES[extras.decimoTerceiro.mes - 1]}`);
  if (extras.restituicaoIr) lines.push(`Restituição do IR: ${money(extras.restituicaoIr.valor)} por ano, em ${MONTH_NAMES[IR_REFUND_MONTH - 1]}`);
  if (extras.fgts) lines.push(`FGTS: ${money(extras.fgts.valor)} a cada 2 anos`);
  if (extras.extraMensal) lines.push(`Valor extra: ${money(extras.extraMensal.valor)} por mês`);
  return lines;
}

// ---------- base (números da simulação) e comparação ----------
/** Base válida para a estratégia? (financiamento, taxa e prazo maiores que zero; sistema conhecido) */
export function isStrategyBase(base) {
  return Boolean(base) && positive(base.financiamento) > 0 && positive(base.taxaAnual) > 0
    && Number.isInteger(base.prazoMeses) && base.prazoMeses > 0 && base.prazoMeses <= STRATEGY_MAX_TERM
    && (base.sistema === "price" || base.sistema === "sac");
}

/**
 * Sem estratégia × com estratégia. `base` = { financiamento, taxaAnual, prazoMeses, sistema, mesInicial }.
 * Devolve null quando a base não serve. `economiaJuros`/`mesesAMenos` nunca negativos.
 */
export function compareStrategy(base, choices) {
  if (!isStrategyBase(base)) return null;
  const common = { principal: base.financiamento, annualRate: base.taxaAnual, termMonths: base.prazoMeses, system: base.sistema, startMonth: validMonth(base.mesInicial, 1) };
  const sem = simulateFinancing(common);
  const com = simulateFinancing({ ...common, extras: choicesToExtras(choices) });
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
  if (!comparison || comparison.economiaJuros <= 0) return `${hello}Vi a estratégia de pagamento da minha simulação e quero conversar sobre ela.`;
  return `${hello}Montei a estratégia de pagamento da minha simulação: quitar em ${formatDuration(comparison.com.months)} em vez de ${formatDuration(comparison.sem.months)}, com ${money(comparison.economiaJuros)} a menos de juros. Podemos conversar?`;
}
