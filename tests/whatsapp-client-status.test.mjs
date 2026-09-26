import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_CLIENT_EVENT, isClientReplyMessage, nextClientStatusOnChatEvent, shouldStartServiceOnManualAdd } from '../lib/whatsapp-client-status-core.mjs';
import { ACTIVE_CLIENT_STATUS_VALUES, CLIENT_STATUS, CLIENT_STATUS_FILTER_GROUPS, CLIENT_STATUS_META, CLIENT_STATUS_OPTIONS, clientStatusLabel, normalizeClientStatus } from '../lib/client-status.js';

const sent = CHAT_CLIENT_EVENT.HUMAN_MESSAGE_SENT;
const replied = CHAT_CLIENT_EVENT.CLIENT_REPLIED;

test('novo status "Atendimento automático" existe e é reconhecido pelo sistema', () => {
  assert.equal(CLIENT_STATUS.AUTOMATED_SERVICE, 'automated_service');
  assert.equal(normalizeClientStatus('automated_service'), 'automated_service'); // nunca vira "Aguardando simulação"
  assert.equal(clientStatusLabel('automated_service'), 'Atendimento automático');
  assert.ok(CLIENT_STATUS_META.automated_service.badgeClass);
  assert.ok(CLIENT_STATUS_OPTIONS.some((option) => option.value === 'automated_service'));
  assert.ok(ACTIVE_CLIENT_STATUS_VALUES.has('automated_service')); // é lead ativo (entra nos pendentes se parar +3 dias)
  // aparece na aba "Atendimento" da lista de clientes
  assert.ok(CLIENT_STATUS_FILTER_GROUPS.find((group) => group.key === 'service').statuses.includes('automated_service'));
});

test('corretor responde ao cliente que só falou com as automações: vira "Em atendimento"', () => {
  assert.equal(nextClientStatusOnChatEvent('automated_service', sent), 'in_service');
});

test('corretor envia mensagem: "Aguardando simulação" (formulário preenchido) vira "Tentando contato"', () => {
  assert.equal(nextClientStatusOnChatEvent('pending', sent), 'awaiting_return');
});

test('cliente responde: "Tentando contato" vira "Em atendimento"', () => {
  assert.equal(nextClientStatusOnChatEvent('awaiting_return', replied), 'in_service');
});

test('mensagem do corretor não mexe em quem já está em outra etapa', () => {
  for (const status of ['awaiting_return', 'in_service', 'completed', 'simulation_sent', 'documentation_pending', 'approved', 'sale_contract', 'rejected', 'archived', 'do_not_contact']) {
    assert.equal(nextClientStatusOnChatEvent(status, sent), null, status);
  }
});

test('resposta do cliente só promove quem estava em "Tentando contato" (nunca rebaixa nem reabre)', () => {
  // cliente do "Atendimento automático" que escreve de novo continua no automático: só corretor muda
  for (const status of ['automated_service', 'pending', 'in_service', 'completed', 'simulation_sent', 'documentation_pending', 'approved', 'sale_contract', 'archived', 'do_not_contact']) {
    assert.equal(nextClientStatusOnChatEvent(status, replied), null, status);
  }
});

test('evento desconhecido não muda nada', () => {
  assert.equal(nextClientStatusOnChatEvent('pending', 'outro'), null);
  assert.equal(nextClientStatusOnChatEvent('automated_service', undefined), null);
});

test('reação a uma mensagem não conta como resposta do cliente', () => {
  assert.equal(isClientReplyMessage('reaction'), false);
  for (const type of ['text', 'audio', 'image', 'document', 'button', 'interactive', undefined, '']) {
    assert.equal(isClientReplyMessage(type), true, String(type));
  }
});

test('corretor adiciona a conversa ao CRM: sem formulário preenchido vai direto para "Em atendimento"', () => {
  assert.equal(shouldStartServiceOnManualAdd('pending', false), true);
  assert.equal(shouldStartServiceOnManualAdd('pending', true), false); // já preencheu: continua aguardando simulação
  for (const status of ['automated_service', 'awaiting_return', 'in_service', 'completed', 'archived', 'do_not_contact']) {
    assert.equal(shouldStartServiceOnManualAdd(status, false), false, status);
  }
});
