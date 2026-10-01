import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SupervisionMessageError,
  assertCanRespond,
  buildSupervisionResponse,
  canSuperviseUser,
  normalizeSupervisionBody,
  supervisionDeliveryState,
  toSupervisionMessage
} from '../lib/supervision-messages-core.mjs';

const admin = { id: 'adm', isGeneralAdmin: true };
const manager = { id: 'mgr', isManager: true, managedUserIds: ['mgr', 'brokerA'] };
const brokerA = { id: 'brokerA' };

test('admin geral supervisiona qualquer usuário, menos ele mesmo', () => {
  assert.equal(canSuperviseUser(admin, 'brokerA'), true);
  assert.equal(canSuperviseUser(admin, 'brokerB'), true);
  assert.equal(canSuperviseUser(admin, 'adm'), false);
  assert.equal(canSuperviseUser(admin, ''), false);
});

test('gestor só supervisiona a própria equipe', () => {
  assert.equal(canSuperviseUser(manager, 'brokerA'), true);
  assert.equal(canSuperviseUser(manager, 'brokerB'), false);
  assert.equal(canSuperviseUser(manager, 'mgr'), false);
});

test('corretor não inicia conversa de supervisão com ninguém (isolamento entre corretores)', () => {
  assert.equal(canSuperviseUser(brokerA, 'brokerB'), false);
  assert.equal(canSuperviseUser(brokerA, 'adm'), false);
});

test('texto: trim, quebras preservadas, vazio e excesso recusados', () => {
  assert.equal(normalizeSupervisionBody('  oi\r\n\n\n\ntudo bem?  '), 'oi\n\ntudo bem?');
  assert.throws(() => normalizeSupervisionBody('   '), SupervisionMessageError);
  assert.throws(() => normalizeSupervisionBody('x'.repeat(2001)), /2000/);
  assert.equal(normalizeSupervisionBody('x'.repeat(2000)).length, 2000);
});

test('OK vira resposta "OK" e marca a original como confirmada', () => {
  assert.deepEqual(buildSupervisionResponse({ action: 'ack', body: 'ignorado' }), { kind: 'ack', body: 'OK', ackStatus: 'acknowledged' });
});

test('resposta personalizada exige texto e marca a original como respondida', () => {
  assert.deepEqual(buildSupervisionResponse({ action: 'reply', body: ' Já liguei ' }), { kind: 'reply', body: 'Já liguei', ackStatus: 'replied' });
  assert.throws(() => buildSupervisionResponse({ action: 'reply', body: '' }), SupervisionMessageError);
  assert.throws(() => buildSupervisionResponse({ action: 'outra' }), SupervisionMessageError);
});

test('só o destinatário responde, e uma vez só', () => {
  const pending = { recipient_id: 'brokerA', ack_status: 'pending' };
  assert.doesNotThrow(() => assertCanRespond(pending, 'brokerA'));
  assert.throws(() => assertCanRespond(pending, 'brokerB'), (error) => error.status === 404);
  assert.throws(() => assertCanRespond({ ...pending, ack_status: 'acknowledged' }, 'brokerA'), (error) => error.status === 409);
  assert.throws(() => assertCanRespond(null, 'brokerA'), (error) => error.status === 404);
});

test('estado de entrega: o mais avançado vence', () => {
  assert.equal(supervisionDeliveryState({}), 'sent');
  assert.equal(supervisionDeliveryState({ delivered_at: 'x' }), 'delivered');
  assert.equal(supervisionDeliveryState({ delivered_at: 'x', seen_at: 'y' }), 'seen');
  assert.equal(supervisionDeliveryState({ seen_at: 'y', ack_status: 'acknowledged' }), 'acknowledged');
  assert.equal(supervisionDeliveryState({ ack_status: 'replied' }), 'replied');
});

test('formato da API não vaza o e-mail de auditoria e marca "mine"', () => {
  const row = { id: '1', sender_id: 'adm', recipient_id: 'brokerA', body: 'oi', kind: 'message', requires_ack: true, ack_status: 'pending', sent_by_email: 'x@y', created_at: 't' };
  const message = toSupervisionMessage(row, 'adm');
  assert.equal(message.mine, true);
  assert.equal(message.requiresAck, true);
  assert.equal('sentByEmail' in message || 'sent_by_email' in message, false);
  assert.equal(toSupervisionMessage(row, 'brokerA').mine, false);
});
