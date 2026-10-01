import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeComparablePhone, pickRegistrationByPhone } from '../lib/registration-match.mjs';

// Mesmo comportamento que findMatchingRegistration tinha antes da extração
// (lib/simulation-registrations.js) — só por telefone, nunca por nome.
const reg = (id, phone, extra = {}) => ({ id, fullName: 'Maria Souza', phoneNormalized: phone, ...extra });

test('homônimo com telefone diferente nunca casa', () => {
  assert.equal(pickRegistrationByPhone([reg('a', '+5514991110001')], { fullName: 'Maria Souza', phoneNormalized: '+5514991110002' }), null);
});

test('mesmo telefone em formatos diferentes casa', () => {
  const list = [reg('a', '+5514991110001')];
  assert.equal(pickRegistrationByPhone(list, { phoneNormalized: '14991110001' })?.id, 'a');
  assert.equal(pickRegistrationByPhone(list, { phone: '(14) 99111-0001' })?.id, 'a');
  assert.equal(pickRegistrationByPhone(list, { phoneNormalized: '+551491110001' })?.id, 'a');
});

test('sem telefone no rascunho não casa nada', () => {
  assert.equal(pickRegistrationByPhone([reg('a', '+5514991110001')], { phoneNormalized: '' }), null);
});

test('preferências de link pessoal e card aberto do Chat continuam valendo', () => {
  const list = [
    reg('recente', '+5514991110001', { responsibleUserId: 'b1' }),
    reg('chat', '+5514991110001', { responsibleUserId: 'b2', acquisitionKind: 'whatsapp_organic' })
  ];
  assert.equal(pickRegistrationByPhone(list, { phoneNormalized: '+5514991110001' })?.id, 'recente');
  assert.equal(pickRegistrationByPhone(list, { phoneNormalized: '+5514991110001' }, { preferResponsibleUserId: 'b2' })?.id, 'chat');
  assert.equal(pickRegistrationByPhone(list, { phoneNormalized: '+5514991110001' }, { preferOpenChatCard: true, hasSimulationData: () => false })?.id, 'chat');
});

test('normalizeComparablePhone remove 00 e 55', () => {
  assert.equal(normalizeComparablePhone('+55 (14) 99111-0001'), '14991110001');
  assert.equal(normalizeComparablePhone('005514991110001'), '14991110001');
});
