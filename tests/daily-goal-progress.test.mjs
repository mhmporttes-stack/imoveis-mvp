import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyGoalOverallProgress, dailyGoalPercent, evaluateDailyGoalPending, isDailyGoalPendingCandidate, walletDayTarget } from '../lib/daily-goal-progress.mjs';

test('full daily target includes new, second and third contacts', () => {
  const target = 20 + 41 + 9;
  assert.equal(dailyGoalPercent(17, target), 24);
  assert.equal(dailyGoalPercent(70, target), 100);
  assert.equal(dailyGoalPercent(100, target), 130);
});

test('each extra prospect adds one percentage point for any broker', () => {
  for (const target of [20, 36, 70, 100]) {
    assert.equal(dailyGoalPercent(target + 1, target), 101);
    assert.equal(dailyGoalPercent(target + 30, target), 130);
  }
  assert.equal(dailyGoalPercent(111, 20), 191);
});

test('cannot show completion before all required contacts are done', () => {
  assert.equal(dailyGoalPercent(999, 1000), 99);
  assert.equal(dailyGoalPercent(0, 70), 0);
  assert.equal(dailyGoalPercent(0, 0), 0);
});

// ---- Meta Diária = prospecção + pendentes (regra oficial 2026-09-25) ----

const overall = (prospectingDone, pendingDone, prospectingTarget = 100, pendingTotal = 30) =>
  dailyGoalOverallProgress({ prospectingDone, prospectingTarget, pendingDone, pendingTotal });

test('100 de prospecção + 30 pendentes = 130 atividades obrigatórias', () => {
  assert.equal(overall(0, 0).required, 130);
  assert.equal(overall(100, 30).percent, 100);
  assert.equal(overall(80, 20).percent, 77); // 100/130
  assert.equal(overall(100, 29).percent, 99); // falta 1: nunca mostra 100%
});

test('depois dos 100%, só prospecção excedente soma +1 ponto', () => {
  assert.equal(overall(101, 30).percent, 101);
  assert.equal(overall(102, 30).percent, 102);
  assert.equal(overall(110, 30).percent, 110);
  assert.equal(overall(104, 30).percent, 104);
});

test('pendência não gera percentual extra além dos 100%', () => {
  assert.equal(overall(100, 45).percent, 100); // 45 > 30 é limitado a 30
  assert.equal(overall(100, 45).pending.done, 30);
  assert.equal(overall(100, 30).pending.completed, true);
});

test('prospecção extra não paga pendência não trabalhada', () => {
  const skippedPending = overall(130, 0);
  assert.equal(skippedPending.percent < 100, true);
  assert.equal(skippedPending.percent, 77);
  assert.equal(skippedPending.pending.remaining, 30);
});

test('detalhe por obrigação para o card (Prospecção x/y, Pendentes x/y)', () => {
  const done = overall(104, 30);
  assert.deepEqual(done.prospecting, { done: 104, target: 100, completed: true });
  assert.deepEqual(done.pending, { done: 30, total: 30, remaining: 0, completed: true });
  const partial = overall(80, 20);
  assert.equal(partial.prospecting.completed, false);
  assert.equal(partial.pending.remaining, 10);
});

test('sem pendentes o resultado é idêntico à regra antiga', () => {
  for (const [done, target] of [[0, 20], [17, 70], [70, 70], [111, 20], [999, 1000], [0, 0]]) {
    assert.equal(dailyGoalOverallProgress({ prospectingDone: done, prospectingTarget: target }).percent, dailyGoalPercent(done, target));
  }
});

test('só pendentes (carteira vazia) também fecha em 100%', () => {
  assert.equal(dailyGoalOverallProgress({ prospectingDone: 0, prospectingTarget: 0, pendingDone: 5, pendingTotal: 5 }).percent, 100);
  assert.equal(dailyGoalOverallProgress({ prospectingDone: 3, prospectingTarget: 0, pendingDone: 5, pendingTotal: 5 }).percent, 103);
});

const DAY = 24 * 60 * 60 * 1000;
const dayStart = Date.parse('2026-09-25T03:00:00.000Z'); // 00:00 America/Sao_Paulo
const iso = (ms) => new Date(ms).toISOString();

test('candidato: ativo, >3 dias sem contato e sem atividade futura', () => {
  const base = { status: 'awaiting_return', lastWhatsappContactAt: iso(dayStart - 4 * DAY), createdAt: iso(dayStart - 30 * DAY) };
  assert.equal(isDailyGoalPendingCandidate(base, dayStart), true);
  assert.equal(isDailyGoalPendingCandidate({ ...base, lastWhatsappContactAt: iso(dayStart - 2 * DAY) }, dayStart), false);
  // sem contato registrado: vale a data de criação
  assert.equal(isDailyGoalPendingCandidate({ ...base, lastWhatsappContactAt: null, createdAt: iso(dayStart - 5 * DAY) }, dayStart), true);
});

test('quem completa 3 dias durante o dia só entra amanhã', () => {
  // último contato há 2 dias e 20 h no início do dia: vira "+3 dias" às 04:00, mas não entra hoje
  const lateComer = { status: 'awaiting_return', lastWhatsappContactAt: iso(dayStart - 3 * DAY + 4 * 60 * 60 * 1000), createdAt: iso(dayStart - 30 * DAY) };
  assert.equal(isDailyGoalPendingCandidate(lateComer, dayStart), false);
  assert.equal(isDailyGoalPendingCandidate(lateComer, dayStart + DAY), true);
});

test('arquivado, não contactar, atividade futura e status fora do funil ativo não entram', () => {
  const stale = { lastWhatsappContactAt: iso(dayStart - 10 * DAY), createdAt: iso(dayStart - 30 * DAY) };
  assert.equal(isDailyGoalPendingCandidate({ ...stale, status: 'archived' }, dayStart), false);
  assert.equal(isDailyGoalPendingCandidate({ ...stale, status: 'do_not_contact' }, dayStart), false);
  assert.equal(isDailyGoalPendingCandidate({ ...stale, status: 'rejected' }, dayStart), false);
  assert.equal(isDailyGoalPendingCandidate({ ...stale, status: 'in_service', latestActivityAt: iso(dayStart + 2 * DAY) }, dayStart), false);
  // atividade que já estava atrasada no início do dia NÃO protege o cliente
  assert.equal(isDailyGoalPendingCandidate({ ...stale, status: 'in_service', latestActivityAt: iso(dayStart - DAY) }, dayStart), true);
  assert.equal(isDailyGoalPendingCandidate({ ...stale, status: 'in_service' }, dayStart), true);
});

test('pendência resolvida conta 1 atividade; o total congelado não muda', () => {
  const broker = 'b1';
  const now = dayStart + 10 * 60 * 60 * 1000;
  const client = (over) => ({ responsibleUserId: broker, status: 'awaiting_return', lastWhatsappContactAt: iso(dayStart - 5 * DAY), latestActivityAt: null, ...over });
  const clientsById = new Map([
    ['contatado', client({ lastWhatsappContactAt: iso(dayStart + 3600_000) })],
    ['agendado', client({ latestActivityAt: iso(now + DAY) })],
    ['arquivado', client({ status: 'archived' })],
    ['ainda-pendente', client({})],
    ['passado-adiante', client({ responsibleUserId: 'outro', lastWhatsappContactAt: iso(dayStart + 3600_000) })],
    ['ja-na-cadencia', client({ lastWhatsappContactAt: iso(dayStart + 3600_000) })]
  ]);
  const result = evaluateDailyGoalPending({
    brokerId: broker,
    frozenIds: ['contatado', 'agendado', 'arquivado', 'ainda-pendente', 'passado-adiante', 'ja-na-cadencia', 'apagado'],
    clientsById,
    dayStartMs: dayStart,
    nowMs: now,
    attemptClientIds: new Set(['ja-na-cadencia'])
  });
  // repassado, apagado e já contado como prospecção saem da conta
  assert.deepEqual(result, { total: 4, done: 3, remaining: 1 });
});

test('pendência com atividade que já venceu hoje não conta como resolvida', () => {
  const broker = 'b1';
  const now = dayStart + 12 * 60 * 60 * 1000;
  const clientsById = new Map([['x', { responsibleUserId: broker, status: 'in_service', lastWhatsappContactAt: iso(dayStart - 5 * DAY), latestActivityAt: iso(now - 3600_000) }]]);
  const result = evaluateDailyGoalPending({ brokerId: broker, frozenIds: ['x'], clientsById, dayStartMs: dayStart, nowMs: now });
  assert.deepEqual(result, { total: 1, done: 0, remaining: 1 });
});

// ---- Caso real (Jennyfer, 25/09): painel 106% x bloqueio "51 de 60" ----

test("meta do dia conta convertidos trabalhados hoje: 24 ativas + 21 encerradas + 6 convertidas = 51", () => {
  const ids = (prefix, n) => Array.from({ length: n }, (_, i) => prefix + i);
  const attempted = ids("a", 24).concat(ids("e", 21), ids("c", 6)); // 51 tentativas, uma por rodada
  const left = ids("e", 21).concat(ids("x", 8), ids("c", 6), ["cx"]); // saíram hoje: 8 encerradas e 1 convertida SEM tentativa
  const result = walletDayTarget({ activeCount: 24, leftRoundIds: left, attemptRoundIds: new Set(attempted) });
  assert.deepEqual(result, { current: 24, leftWorked: 27, dayTarget: 51 });
  // 51 tentativas em 51 = 100% (antes aparecia 106% com denominador 45) e a prospecção extra libera
  const progress = dailyGoalOverallProgress({ prospectingDone: 51, prospectingTarget: result.dayTarget });
  assert.equal(progress.percent, 100);
  assert.equal(progress.required > 0 && progress.percent >= 100, true);
});

test("rodada que saiu da carteira sem tentativa do corretor não vira obrigação", () => {
  assert.equal(walletDayTarget({ activeCount: 10, leftRoundIds: ["a", "b"], attemptRoundIds: new Set() }).dayTarget, 10);
  assert.equal(walletDayTarget().dayTarget, 0);
});
