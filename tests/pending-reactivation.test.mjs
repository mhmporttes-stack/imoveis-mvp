import test from 'node:test';
import assert from 'node:assert/strict';
import { isClientAwaitingAction, isAwaitingFutureActivityClient, pendingReferenceAt, hasFutureScheduledActivity } from '../lib/client-status.js';
import { evaluateDailyGoalPending, isDailyGoalPendingCandidate } from '../lib/daily-goal-progress.mjs';

// Regra do dono (2026-10-02): devolver MANUALMENTE a "Tentando contato" reativa o
// cliente e encerra a pendência "sem atividade futura", sem atividade fictícia.

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-10-02T15:00:00Z');
const dayStart = Date.parse('2026-10-02T03:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const base = { scheduledActivityAt: null, scheduledActivityCompletedAt: null, lastWhatsappContactAt: iso(now - 10 * DAY), createdAt: iso(now - 30 * DAY) };

test('cliente avançado parado e sem atividade segue pendente (comportamento mantido)', () => {
  const client = { ...base, status: 'documentation' };
  assert.equal(isClientAwaitingAction(client, now), true);
  assert.equal(isAwaitingFutureActivityClient(client, now), true);
});

test('avançado -> Tentando contato remove a pendência e reinicia o relógio de 3 dias', () => {
  const client = { ...base, status: 'awaiting_return', lastStatusChangeAt: iso(now - 1000) };
  assert.equal(isAwaitingFutureActivityClient(client, now), false);
  assert.equal(isClientAwaitingAction(client, now), false);
  // 3 dias depois, sem contato: volta a ser pendente pelas regras da etapa
  assert.equal(isClientAwaitingAction(client, now + 3 * DAY + 1000), true);
});

test('não cria atividade fictícia: nada de agenda é preenchido', () => {
  const client = { ...base, status: 'awaiting_return', lastStatusChangeAt: iso(now) };
  assert.equal(hasFutureScheduledActivity(client, now), false);
  assert.equal(client.scheduledActivityAt, null);
});

test('mudança de etapa não encurta nem apaga o último contato; só reinicia o relógio', () => {
  const recent = { ...base, status: 'awaiting_return', lastWhatsappContactAt: iso(now - 1000), lastStatusChangeAt: iso(now - 5 * DAY) };
  assert.equal(pendingReferenceAt(recent), now - 1000);
  assert.equal(pendingReferenceAt({ ...base, status: 'documentation', lastStatusChangeAt: iso(now) }), now - 10 * DAY);
});

test('Tentando contato antigo (sem reativação recente) continua pendente pelo contato', () => {
  const client = { ...base, status: 'awaiting_return', lastStatusChangeAt: iso(now - 9 * DAY) };
  assert.equal(isClientAwaitingAction(client, now), true);
});

test('Não contactar nunca é pendente nem reativado', () => {
  const client = { ...base, status: 'do_not_contact', lastStatusChangeAt: iso(now) };
  assert.equal(isClientAwaitingAction(client, now), false);
  assert.equal(isAwaitingFutureActivityClient(client, now), false);
});

test('Meta Diária: reativação no dia resolve a pendência congelada uma única vez', () => {
  const brokerId = 'b1';
  const mk = (patch) => ({ id: 'c1', responsibleUserId: brokerId, status: 'documentation', lastWhatsappContactAt: iso(now - 10 * DAY), latestActivityAt: null, ...patch });
  const run = (client, extra = {}) => evaluateDailyGoalPending({ brokerId, frozenIds: ['c1'], clientsById: new Map([['c1', client]]), dayStartMs: dayStart, nowMs: now, ...extra });

  assert.deepEqual(run(mk({})), { total: 1, done: 0, remaining: 1, remainingIds: ['c1'] });
  const reactivated = mk({ status: 'awaiting_return', lastStatusChangeAt: iso(now - 3600 * 1000) });
  assert.equal(run(reactivated).done, 1);
  assert.equal(run(reactivated).total, 1); // idempotente: reavaliar não soma de novo
  assert.equal(run(reactivated).done, 1);
  // Tentando contato por troca ANTERIOR ao dia não resolve
  assert.equal(run(mk({ status: 'awaiting_return', lastStatusChangeAt: iso(dayStart - DAY) })).done, 0);
  // tentativa da Meta Diária no dia já vale como prospecção: sai da conta (sem dupla contagem)
  const out = run(reactivated, { attemptClientIds: new Set(['c1']) });
  assert.equal(out.total, 0);
  assert.equal(out.done, 0);
});

test('Meta Diária: próximo ciclo não recria a pendência de quem foi reativado', () => {
  const tomorrow = now + DAY;
  const reactivated = { id: 'c1', status: 'awaiting_return', lastWhatsappContactAt: iso(now - 10 * DAY), lastStatusChangeAt: iso(now - 3600 * 1000), latestActivityAt: null, createdAt: iso(now - 30 * DAY) };
  assert.equal(isDailyGoalPendingCandidate(reactivated, tomorrow), false);
  assert.equal(isDailyGoalPendingCandidate(reactivated, now + 4 * DAY), true); // sem resposta por 3+ dias: regras da etapa
  assert.equal(isDailyGoalPendingCandidate({ ...reactivated, status: 'do_not_contact' }, tomorrow), false);
});
