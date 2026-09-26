import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_CLIENT_EVENT, isClientReplyMessage, nextClientStatusOnChatEvent } from '../lib/whatsapp-client-status-core.mjs';

const sent = CHAT_CLIENT_EVENT.HUMAN_MESSAGE_SENT;
const replied = CHAT_CLIENT_EVENT.CLIENT_REPLIED;

test('corretor envia mensagem: "Aguardando simulação" vira "Tentando contato"', () => {
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
  assert.equal(nextClientStatusOnChatEvent('pending', replied), null); // ainda não houve tentativa: cliente que chegou escrevendo
  for (const status of ['in_service', 'completed', 'simulation_sent', 'documentation_pending', 'approved', 'sale_contract', 'archived', 'do_not_contact']) {
    assert.equal(nextClientStatusOnChatEvent(status, replied), null, status);
  }
});

test('evento desconhecido não muda nada', () => {
  assert.equal(nextClientStatusOnChatEvent('pending', 'outro'), null);
  assert.equal(nextClientStatusOnChatEvent('awaiting_return', undefined), null);
});

test('reação a uma mensagem não conta como resposta do cliente', () => {
  assert.equal(isClientReplyMessage('reaction'), false);
  for (const type of ['text', 'audio', 'image', 'document', 'button', 'interactive', undefined, '']) {
    assert.equal(isClientReplyMessage(type), true, String(type));
  }
});
