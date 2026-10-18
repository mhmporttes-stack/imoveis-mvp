// Estratégia de pagamento da apresentação (PRES-24): motor puro, escolhas em allowlist, base do DTO e PDF.
import test from "node:test";
import assert from "node:assert/strict";
import {
  FGTS_INTERVAL_MONTHS,
  balanceChartPaths,
  buildStrategyMessage,
  calendarMonthOf,
  choicesFitBase,
  choicesToExtras,
  compareStrategy,
  describeChoices,
  emptyChoices,
  extraForMonth,
  formatDuration,
  isOptionAllowed,
  parseStrategyChoices,
  pricePayment,
  restrictChoices,
  simulateFinancing,
  strategyHeadline,
  strategyOptionsFromRegistration
} from "../lib/payment-strategy-core.mjs";
import { PUBLIC_DTO_FIELDS, PUBLIC_STRATEGY_FIELDS, PUBLIC_STRATEGY_OPTION_FIELDS, buildPaymentStrategyBase, buildPublicPresentation, withPaymentStrategy } from "../lib/simulation-presentation-core.mjs";
import { generatePaymentStrategyPdf, strategyPdfFileName } from "../lib/payment-strategy-pdf.mjs";

const close = (actual, expected, tolerance = 1) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (±${tolerance})`);
const ALL = { decimoTerceiro: true, restituicaoIr: true, fgts: true };
const base = { sistema: "price", financiamento: 200000, taxaAnual: 5.4, prazoMeses: 420, parcela: 1250, mesInicial: 11, opcoes: ALL };

// ---------- motor: sem estratégia ----------
test("Price sem extras: prestação fixa, prazo cheio, saldo zera e juros = total pago - financiado", () => {
  const i = 0.054 / 12;
  const pmt = pricePayment(200000, i, 420);
  close(pmt, (200000 * i) / (1 - (1 + i) ** -420), 0.01);
  const result = simulateFinancing({ principal: 200000, annualRate: 5.4, termMonths: 420, system: "price" });
  assert.equal(result.months, 420);
  assert.equal(result.balances.at(-1), 0);
  assert.equal(result.balances[0], 200000);
  assert.equal(result.paidOffEarly, false);
  assert.equal(result.totalExtra, 0);
  close(result.totalInterest, pmt * 420 - 200000, 5); // centavos de arredondamento mês a mês (a última parcela absorve)
  close(result.totalPaid, 200000 + result.totalInterest, 0.01);
});

test("SAC sem extras: amortização fixa, juros = i·P·(n+1)/2", () => {
  const result = simulateFinancing({ principal: 120000, annualRate: 6, termMonths: 360, system: "sac" });
  assert.equal(result.months, 360);
  assert.equal(result.balances.at(-1), 0);
  close(result.totalInterest, 0.005 * 120000 * 361 / 2, 2);
  // saldo cai em linha reta: P/n por mês
  close(result.balances[1], 120000 - 120000 / 360, 0.01);
  close(result.balances[180], 60000, 1); // cota arredondada a centavos
});

test("taxa zero: sem juros", () => {
  const result = simulateFinancing({ principal: 12000, annualRate: 0, termMonths: 12, system: "price" });
  assert.equal(result.months, 12);
  assert.equal(result.totalInterest, 0);
});

// ---------- extras ----------
test("calendário: 13º no mês escolhido, IR em junho, FGTS a cada 24 meses, extra todo mês", () => {
  assert.equal(calendarMonthOf(1, 11), 11);
  assert.equal(calendarMonthOf(2, 11), 12);
  assert.equal(calendarMonthOf(3, 11), 1);
  const extras = { decimoTerceiro: { valor: 3000, mes: 12 } };
  assert.equal(extraForMonth(2, 11, extras), 3000); // dezembro
  assert.equal(extraForMonth(1, 11, extras), 0);
  assert.equal(extraForMonth(14, 11, extras), 3000); // dezembro do ano seguinte
  const ir = { restituicaoIr: { valor: 1500, mes: 6 } };
  assert.equal(extraForMonth(8, 11, ir), 1500); // nov + 7 = junho
  const fgts = { fgts: { valor: 10000, intervaloMeses: FGTS_INTERVAL_MONTHS } };
  assert.equal(extraForMonth(23, 1, fgts), 0);
  assert.equal(extraForMonth(24, 1, fgts), 10000);
  assert.equal(extraForMonth(36, 1, fgts), 0);
  assert.equal(extraForMonth(48, 1, fgts), 10000);
  assert.equal(extraForMonth(5, 1, { extraMensal: { valor: 200 } }), 200);
  assert.equal(extraForMonth(24, 12, { decimoTerceiro: { valor: 1000, mes: 11 }, fgts: { valor: 5000 }, extraMensal: { valor: 100 } }), 6100);
});

test("Price com extra mensal: prestação mantida, prazo e juros caem", () => {
  const sem = simulateFinancing({ principal: 200000, annualRate: 5.4, termMonths: 420, system: "price" });
  const com = simulateFinancing({ principal: 200000, annualRate: 5.4, termMonths: 420, system: "price", extras: { extraMensal: { valor: 300 } } });
  assert.ok(com.months < sem.months);
  assert.ok(com.totalInterest < sem.totalInterest);
  assert.equal(com.paidOffEarly, true);
  assert.equal(com.balances.at(-1), 0);
  assert.ok(com.totalExtra <= 300 * com.months && com.totalExtra > 300 * (com.months - 2)); // 300 por mês (o último pode ser menor)
  // total pago = financiado + juros (o extra é amortização)
  close(com.totalPaid, 200000 + com.totalInterest, 0.05);
});

test("SAC com extra igual à cota de amortização: prazo cai pela metade (cota fixa, não a parcela)", () => {
  const A = 108000 / 360; // 300,00 exatos
  const com = simulateFinancing({ principal: 108000, annualRate: 6, termMonths: 360, system: "sac", extras: { extraMensal: { valor: A } } });
  assert.equal(com.months, 180);
  assert.equal(com.balances.at(-1), 0);
  close(com.balances[1], 108000 - 2 * A, 0.001);
  const sem = simulateFinancing({ principal: 108000, annualRate: 6, termMonths: 360, system: "sac" });
  assert.ok(com.totalInterest < sem.totalInterest / 1.9);
});

test("quitação antecipada: extra maior que o saldo quita no mês e nunca passa do saldo", () => {
  const result = simulateFinancing({ principal: 50000, annualRate: 9, termMonths: 240, system: "price", startMonth: 12, extras: { decimoTerceiro: { valor: 1_000_000, mes: 12 } } });
  assert.equal(result.months, 1);
  assert.equal(result.balances.at(-1), 0);
  assert.ok(result.totalExtra < 50000);
  close(result.totalPaid, 50000 + result.totalInterest, 0.01);
  close(result.totalInterest, 50000 * 0.0075, 0.01);
});

test("compareStrategy: economia de juros e meses a menos; base inválida → null", () => {
  const choices = { ...emptyChoices(), decimoTerceiro: { ativo: true, valor: 3000, mes: 12 }, fgts: { ativo: true, valor: 8000 } };
  const comparison = compareStrategy(base, choices);
  assert.ok(comparison.economiaJuros > 0);
  assert.equal(comparison.mesesAMenos, comparison.sem.months - comparison.com.months);
  close(comparison.economiaJuros, comparison.sem.totalInterest - comparison.com.totalInterest, 0.01);
  const none = compareStrategy(base, emptyChoices());
  assert.equal(none.economiaJuros, 0);
  assert.equal(none.mesesAMenos, 0);
  // opção desligada não conta, mesmo com valor
  assert.equal(compareStrategy(base, { ...emptyChoices(), extraMensal: { ativo: false, valor: 500 } }).economiaJuros, 0);
  for (const bad of [null, { ...base, taxaAnual: 0 }, { ...base, prazoMeses: 0 }, { ...base, prazoMeses: 601 }, { ...base, financiamento: 0 }, { ...base, sistema: "outro" }]) {
    assert.equal(compareStrategy(bad, choices), null);
  }
  const paths = balanceChartPaths(comparison, { width: 320, height: 140 });
  assert.match(paths.sem, /^M0 0 /);
  assert.match(paths.com, / 140$/); // termina no saldo zero
});

// ---------- escolhas (allowlist) ----------
test("parseStrategyChoices: allowlist estrita", () => {
  const ok = parseStrategyChoices({ decimoTerceiro: { ativo: true, valor: 2500.5, mes: 11 }, extraMensal: { ativo: false, valor: 0 } });
  assert.deepEqual(ok.decimoTerceiro, { ativo: true, valor: 2500.5, mes: 11 });
  assert.deepEqual(ok.fgts, { ativo: false, valor: 0 });
  assert.deepEqual(parseStrategyChoices({}), emptyChoices());
  for (const bad of [null, [], "x", { cpf: {} }, { fgts: { ativo: true, valor: -1 } }, { fgts: { ativo: true, valor: "100" } }, { fgts: { ativo: "sim", valor: 1 } },
    { fgts: { ativo: true, valor: 1, mes: 3 } }, { decimoTerceiro: { ativo: true, valor: 1, mes: 13 } }, { extraMensal: { ativo: true, valor: 20_000_000 } }, { extraMensal: { valor: 1, telefone: "1" } }]) {
    assert.equal(parseStrategyChoices(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(Object.keys(choicesToExtras(ok)), ["decimoTerceiro"]);
  assert.deepEqual(describeChoices(ok, (v) => `R$${v}`), ["13º salário: R$2500.5 por ano, em novembro"]);
});

test("formatDuration e mensagem do WhatsApp (só o primeiro nome)", () => {
  assert.equal(formatDuration(420), "35 anos");
  assert.equal(formatDuration(148), "12 anos e 4 meses");
  assert.equal(formatDuration(13), "1 ano e 1 mês");
  assert.equal(formatDuration(8), "8 meses");
  const comparison = compareStrategy(base, { ...emptyChoices(), extraMensal: { ativo: true, valor: 400 } });
  const message = buildStrategyMessage({ firstName: "Mariana Souza", comparison, formatMoney: (v) => `R$ ${v}` });
  assert.match(message, /^Olá! Aqui é Mariana\. Montei a estratégia/);
  assert.ok(!message.includes("Souza"));
  assert.match(buildStrategyMessage({ firstName: "", comparison: null }), /quero conversar/);
});

// ---------- base do DTO ----------
function simulation(overrides = {}) {
  return {
    clientName: "Mariana Souza Lima",
    simulationDate: "2026-10-03",
    interestRateAnnual: 5.4,
    registration: { cpf: "123.456.789-09", phone: "14999887766", monthlyIncome: 8123.45, responsibleUserId: "u1", simulationType: "individual", primaryIncomeType: "registered_employment" },
    simulationModels: {
      novo: { financingValue: "190.000,00", subsidyValue: "42.000,00", firstInstallment: "1.085,40", lastInstallment: "812,15", termMonths: "420",
        sac: { financingValue: "185.000,00", subsidyValue: "42.000,00", firstInstallment: "1.300,00", lastInstallment: "500,00", termMonths: "360" } }
    },
    properties: [],
    ...overrides
  };
}

test("base da estratégia = modelo destacado pela apresentação (Price; só SAC → SAC), sem redigitar", () => {
  const clt = { decimoTerceiro: true, restituicaoIr: false, fgts: true };
  assert.deepEqual(buildPaymentStrategyBase(simulation()), { sistema: "price", financiamento: 190000, taxaAnual: 5.4, prazoMeses: 420, parcela: 1085.4, mesInicial: 11, opcoes: clt });
  const sacOnly = simulation({ simulationModels: { usado: { financingValue: "", subsidyValue: "", firstInstallment: "", lastInstallment: "", termMonths: "", sac: { financingValue: "150.000,00", firstInstallment: "1.400,00", lastInstallment: "420,00", termMonths: "300" } } } });
  assert.deepEqual(buildPaymentStrategyBase(sacOnly), { sistema: "sac", financiamento: 150000, taxaAnual: 5.4, prazoMeses: 300, parcela: 1400, mesInicial: 11, opcoes: clt });
  assert.equal(buildPaymentStrategyBase(simulation({ interestRateAnnual: null })), null); // sem taxa: sem estratégia
  assert.equal(buildPaymentStrategyBase(simulation({ simulationDate: "2026-12-20" })).mesInicial, 1); // dezembro → janeiro
  const noTerm = simulation();
  noTerm.simulationModels.novo.termMonths = "";
  assert.equal(buildPaymentStrategyBase(noTerm), null);
});

test("DTO público: `estrategia` só com os campos da allowlist e nada sensível", () => {
  const sim = simulation();
  const dto = withPaymentStrategy(buildPublicPresentation({ simulation: sim, defaultReason: "x" }), sim);
  for (const key of Object.keys(dto)) assert.ok(PUBLIC_DTO_FIELDS.includes(key), key);
  assert.deepEqual(Object.keys(dto.estrategia).sort(), [...PUBLIC_STRATEGY_FIELDS].sort());
  assert.deepEqual(Object.keys(dto.estrategia.opcoes).sort(), [...PUBLIC_STRATEGY_OPTION_FIELDS].sort());
  for (const flag of Object.values(dto.estrategia.opcoes)) assert.equal(typeof flag, "boolean");
  const json = JSON.stringify(dto);
  for (const forbidden of ["123.456.789-09", "14999887766", "8123", "u1", "Souza", "wa.me", "registered_employment", "income_tax", "self_employed"]) assert.ok(!json.includes(forbidden), forbidden);
  const without = withPaymentStrategy(buildPublicPresentation({ simulation: simulation({ interestRateAnnual: null }), defaultReason: "x" }), simulation({ interestRateAnnual: null }));
  assert.equal("estrategia" in without, false);
  assert.equal(withPaymentStrategy(null, sim), null);
});

// ---------- PDF ----------
test("PDF: gera um A4 válido, nome do arquivo sem acento", async () => {
  const comparison = compareStrategy(base, { ...emptyChoices(), decimoTerceiro: { ativo: true, valor: 3000, mes: 12 } });
  const bytes = await generatePaymentStrategyPdf({ base, choices: { ...emptyChoices(), decimoTerceiro: { ativo: true, valor: 3000, mes: 12 } }, comparison, firstName: "Mariana", dateText: "18/10/2026" });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  assert.ok(bytes.length > 1500);
  assert.equal(strategyPdfFileName("Júlia Ávila"), "estrategia-de-pagamento-julia-avila.pdf");
  assert.equal(strategyPdfFileName(""), "estrategia-de-pagamento.pdf");
});

// ---------- opções conforme o cadastro (regra do dono, 2026-10-18) ----------
test("opções por tipo de renda: CLT, CLT + declarante de IR, informal, sem dado", () => {
  const clt = strategyOptionsFromRegistration({ simulationType: "individual", primaryIncomeType: "registered_employment" });
  assert.deepEqual(clt, { decimoTerceiro: true, restituicaoIr: false, fgts: true });
  // composição de renda: basta UM participante CLT / declarante
  assert.deepEqual(strategyOptionsFromRegistration({ simulationType: "joint", primaryIncomeType: "registered_employment", secondaryIncomeType: "income_tax_declarant" }), { decimoTerceiro: true, restituicaoIr: true, fgts: true });
  assert.deepEqual(strategyOptionsFromRegistration({ simulationType: "joint", primaryIncomeType: "self_employed_unregistered", secondaryIncomeType: "registered_employment" }), { decimoTerceiro: true, restituicaoIr: false, fgts: true });
  assert.deepEqual(strategyOptionsFromRegistration({ simulationType: "individual", primaryIncomeType: "income_tax_declarant" }), { decimoTerceiro: false, restituicaoIr: true, fgts: false });
  // segundo participante só conta em simulação conjunta
  assert.deepEqual(strategyOptionsFromRegistration({ simulationType: "individual", primaryIncomeType: "self_employed_unregistered", secondaryIncomeType: "registered_employment" }), { decimoTerceiro: false, restituicaoIr: false, fgts: false });
  const informal = strategyOptionsFromRegistration({ simulationType: "individual", primaryIncomeType: "self_employed_unregistered" });
  assert.deepEqual(informal, { decimoTerceiro: false, restituicaoIr: false, fgts: false });
  for (const semDado of [undefined, null, {}, { primaryIncomeType: "" }]) assert.deepEqual(strategyOptionsFromRegistration(semDado), informal);
  // extras por mês e por ano: todos os perfis
  for (const opcoes of [clt, informal, undefined]) {
    assert.equal(isOptionAllowed({ opcoes }, "extraMensal"), true);
    assert.equal(isOptionAllowed({ opcoes }, "extraAnual"), true);
  }
  assert.equal(isOptionAllowed({ opcoes: informal }, "fgts"), false);
  assert.equal(isOptionAllowed({}, "decimoTerceiro"), false); // base sem flags → conservador
});

test("motor e servidor recusam opção não permitida (o cliente não força pela API)", () => {
  const informalBase = { ...base, opcoes: { decimoTerceiro: false, restituicaoIr: false, fgts: false } };
  const forced = { ...emptyChoices(), fgts: { ativo: true, valor: 50000 }, decimoTerceiro: { ativo: true, valor: 5000, mes: 12 } };
  assert.equal(choicesFitBase(forced, informalBase), false);
  assert.equal(choicesFitBase({ ...emptyChoices(), fgts: { ativo: false, valor: 10 } }, informalBase), false); // valor escondido também
  assert.equal(choicesFitBase(forced, base), true);
  // mesmo que chegasse ao motor, não entra no cálculo
  assert.equal(compareStrategy(informalBase, forced).economiaJuros, 0);
  assert.deepEqual(restrictChoices(forced, informalBase), emptyChoices());
  assert.deepEqual(describeChoices(forced, (v) => `R$${v}`, informalBase), []);
  const cltBase = { ...base, opcoes: { decimoTerceiro: true, restituicaoIr: false, fgts: true } };
  const withIr = { ...emptyChoices(), restituicaoIr: { ativo: true, valor: 2000 } };
  assert.equal(choicesFitBase(withIr, cltBase), false);
  assert.equal(choicesFitBase(emptyChoices(), cltBase), true); // tela manda todas as chaves desligadas
});

test("valor extra por ano: mês escolhido, todos os perfis, frase do resultado", () => {
  assert.equal(extraForMonth(2, 11, { extraAnual: { valor: 1000, mes: 12 } }), 1000);
  assert.equal(extraForMonth(3, 11, { extraAnual: { valor: 1000, mes: 12 } }), 0);
  assert.equal(extraForMonth(8, 11, { extraAnual: { valor: 1000, mes: 6 } }), 1000);
  const parsed = parseStrategyChoices({ extraMensal: { ativo: true, valor: 100 }, extraAnual: { ativo: true, valor: 1000, mes: 3 } });
  assert.deepEqual(parsed.extraAnual, { ativo: true, valor: 1000, mes: 3 });
  assert.equal(parseStrategyChoices({ extraAnual: { ativo: true, valor: 1, mes: 0 } }), null);
  const informalBase = { ...base, opcoes: { decimoTerceiro: false, restituicaoIr: false, fgts: false } };
  const comparison = compareStrategy(informalBase, parsed);
  assert.ok(comparison.economiaJuros > 0);
  assert.ok(comparison.economiaJuros > compareStrategy(informalBase, { ...parsed, extraAnual: { ativo: false, valor: 0, mes: 12 } }).economiaJuros);
  const money = (v) => `R$ ${v}`;
  assert.deepEqual(describeChoices(parsed, money, informalBase), ["Valor extra: R$ 100 por mês", "Valor extra: R$ 1000 por ano, em março"]);
  assert.equal(strategyHeadline(comparison, parsed, informalBase, money), `Com R$ 100/mês + R$ 1000/ano você termina em ${formatDuration(comparison.com.months)} e economiza R$ ${comparison.economiaJuros} de juros.`);
  assert.equal(strategyHeadline(compareStrategy(informalBase, emptyChoices()), emptyChoices(), informalBase, money), null);
});

test("PDF de perfil informal com 13º forçado: só as opções válidas entram", async () => {
  const informalBase = { ...base, opcoes: { decimoTerceiro: false, restituicaoIr: false, fgts: false } };
  const choices = { ...emptyChoices(), extraAnual: { ativo: true, valor: 1000, mes: 12 }, decimoTerceiro: { ativo: true, valor: 9000, mes: 12 } };
  const comparison = compareStrategy(informalBase, choices);
  const bytes = await generatePaymentStrategyPdf({ base: informalBase, choices, comparison, firstName: "Ana", dateText: "18/10/2026" });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  assert.equal(comparison.com.totalExtra % 1000, 0); // só múltiplos do extra anual; o 13º não entrou
});
