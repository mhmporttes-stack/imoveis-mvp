import test from 'node:test';
import assert from 'node:assert/strict';
import { clientMatchesContactPhone, roundContactPhone, roundPersonName } from '../lib/contact-client-link.mjs';
import { pickRegistrationByPhone } from '../lib/registration-match.mjs';

// Reproduz o bug P-01 (14 a 29/09/2026): contatos da fila com o MESMO nome e
// telefones DIFERENTES viravam o mesmo cliente, e cada novo contato
// sobrescrevia o telefone dele. Simula a materialização da Meta Diária com as
// mesmas regras puras usadas em produção (lib/daily-goal.js,
// materializeClientOnFirstAttempt + findMatchingRegistration).
function materialize(store, contact, { legacyNameMatch = false } = {}) {
  const linked = contact.registration_id ? store.find((client) => client.id === contact.registration_id) : null;
  if (linked && clientMatchesContactPhone(linked.phoneNormalized, contact.phone_normalized)) return linked.id;

  let existing = pickRegistrationByPhone(store, { phoneNormalized: contact.phone_normalized });
  if (!existing && legacyNameMatch) existing = store.find((client) => client.fullName === contact.name) || null;
  if (existing) {
    if (legacyNameMatch) existing.phoneNormalized = contact.phone_normalized; // comportamento antigo: sobrescrevia
    contact.registration_id = existing.id;
    return existing.id;
  }
  const created = { id: `c${store.length + 1}`, fullName: contact.name, phoneNormalized: contact.phone_normalized };
  store.push(created);
  contact.registration_id = created.id;
  return created.id;
}

const homonyms = () => [
  { id: 'k1', name: 'Maria Souza', phone_normalized: '+5514991110001' },
  { id: 'k2', name: 'Maria Souza', phone_normalized: '+5514991110002' },
  { id: 'k3', name: 'Maria Souza', phone_normalized: '+5514991110003' }
];

test('bug antigo reproduzido: casando por nome, 3 homônimos viram 1 cliente com telefone sobrescrito', () => {
  const store = [];
  const ids = homonyms().map((contact) => materialize(store, contact, { legacyNameMatch: true }));
  assert.equal(new Set(ids).size, 1);
  assert.equal(store[0].phoneNormalized, '+5514991110003');
});

test('mesmo nome + telefones diferentes = clientes independentes', () => {
  const store = [];
  const contacts = homonyms();
  const ids = contacts.map((contact) => materialize(store, contact));
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(store.map((client) => client.phoneNormalized), contacts.map((contact) => contact.phone_normalized));
});

test('vínculo antigo errado (registration_id de homônimo) é ignorado e cria o cliente certo, sem mexer no compartilhado', () => {
  const shared = { id: 'c1', fullName: 'Maria Souza', phoneNormalized: '+5514991110003' };
  const store = [shared];
  const contact = { id: 'k1', name: 'Maria Souza', phone_normalized: '+5514991110001', registration_id: 'c1' };
  const id = materialize(store, contact);
  assert.notEqual(id, 'c1');
  assert.equal(contact.registration_id, id);
  assert.equal(shared.phoneNormalized, '+5514991110003');
  assert.equal(store.find((client) => client.id === id).phoneNormalized, '+5514991110001');
});

test('vínculo correto (mesmo telefone, inclusive em outro formato) continua reaproveitado', () => {
  const store = [{ id: 'c1', fullName: 'João', phoneNormalized: '+5514991110001' }];
  assert.equal(materialize(store, { name: 'João', phone_normalized: '14991110001', registration_id: 'c1' }), 'c1');
  assert.equal(materialize(store, { name: 'João', phone_normalized: '+55 14 9111-0001', registration_id: 'c1' }), 'c1'); // sem o 9º dígito
  assert.equal(store.length, 1);
});

test('cliente existente com o telefone do contato é reaproveitado (não duplica)', () => {
  const store = [{ id: 'c1', fullName: 'Ana', phoneNormalized: '+5514991110009' }];
  assert.equal(materialize(store, { name: 'Ana Paula', phone_normalized: '+5514991110009' }), 'c1');
  assert.equal(store.length, 1);
});

test('clientMatchesContactPhone exige os dois telefones', () => {
  assert.equal(clientMatchesContactPhone('', '+5514991110001'), false);
  assert.equal(clientMatchesContactPhone('+5514991110001', ''), false);
  assert.equal(clientMatchesContactPhone('+5514991110001', '+5514991110002'), false);
  assert.equal(clientMatchesContactPhone('+5514991110001', '5514991110001'), true);
});

test('1ª, 2ª e 3ª tentativa usam sempre o telefone do contato da rodada', () => {
  const wrongShared = { round: { contact: { name: 'Maria Souza', phone_normalized: '+5514991110001' }, client: { full_name: 'Maria Souza', phone_normalized: '+5514991110003' } } };
  assert.equal(roundContactPhone(wrongShared.round), '+5514991110001');
  assert.equal(roundContactPhone({ contact: { phone_normalized: '' }, client: { phone_normalized: '+5514991110003' } }), '+5514991110003');
  assert.equal(roundContactPhone({}), '');
});

test('nome: o do cliente quando é a mesma pessoa (pode ter sido corrigido), senão o do contato', () => {
  assert.equal(roundPersonName({ contact: { name: 'maria', phone_normalized: '+5514991110001' }, client: { full_name: 'Maria Souza', phone_normalized: '+5514991110001' } }), 'Maria Souza');
  assert.equal(roundPersonName({ contact: { name: 'Carla', phone_normalized: '+5514991110001' }, client: { full_name: 'Maria Souza', phone_normalized: '+5514991110003' } }), 'Carla');
  assert.equal(roundPersonName({ contact: { name: 'Carla', phone_normalized: '+5514991110001' } }), 'Carla');
  assert.equal(roundPersonName({}), 'Cliente');
});
