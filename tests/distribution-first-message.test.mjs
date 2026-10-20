import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDistributionFirstMessageAllowed } from "../lib/distribution-first-message-core.mjs";

// [REGRA OFICIAL — dono, 2026-10-19] Cliente recebido pela distribuição automática: a 1ª mensagem é obrigatoriamente pelo
// Chat (exceção ao "Chat só responde" só para ele e enquanto o corretor for o responsável).
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const GAB = "gab";
const at = "2026-10-19T15:06:31Z";
const client = { responsible_user_id: GAB, responsible_changed_at: "2026-10-19T15:06:31Z", pending_distribution_at: null };
const delivered = { event_type: "assigned", to_user_id: GAB, created_at: "2026-10-19T15:06:32Z" };

test("recebido pela distribuição e ainda dele: libera a 1ª mensagem", () => {
  assert.equal(isDistributionFirstMessageAllowed({ client, latestDistribution: delivered, sessionOwnerId: GAB }), true);
  assert.equal(isDistributionFirstMessageAllowed({ client, latestDistribution: { ...delivered, event_type: "auto_transferred" }, sessionOwnerId: GAB }), true);
  // Lead novo da roleta (responsável gravado na criação, sem troca).
  assert.equal(isDistributionFirstMessageAllowed({ client: { ...client, responsible_changed_at: null }, latestDistribution: delivered, sessionOwnerId: GAB }), true);
});

test("demais casos continuam só respondendo", () => {
  // Número de outra pessoa / cliente de outro.
  assert.equal(isDistributionFirstMessageAllowed({ client, latestDistribution: delivered, sessionOwnerId: "jen" }), false);
  // Devolvido para a fila (com o dono, aguardando): ninguém recebeu.
  assert.equal(isDistributionFirstMessageAllowed({ client: { ...client, responsible_user_id: "owner", pending_distribution_at: at }, latestDistribution: { ...delivered, event_type: "auto_transferred", to_user_id: "owner" }, sessionOwnerId: "owner" }), false);
  // Transferência manual depois da distribuição.
  assert.equal(isDistributionFirstMessageAllowed({ client: { ...client, responsible_changed_at: "2026-10-19T17:00:00Z" }, latestDistribution: delivered, sessionOwnerId: GAB }), false);
  // Última distribuição foi para outro (ele recebeu por outro caminho).
  assert.equal(isDistributionFirstMessageAllowed({ client, latestDistribution: { ...delivered, to_user_id: "jen" }, sessionOwnerId: GAB }), false);
  // Sem histórico de distribuição (link pessoal, cadastro manual, contato frio).
  assert.equal(isDistributionFirstMessageAllowed({ client, latestDistribution: null, sessionOwnerId: GAB }), false);
});

test("a exceção entra na trava do envio e no estado da tela (sem o 'enviar pelo celular')", () => {
  const chat = read("lib/whatsapp-chat.js");
  assert.match(chat, /if \(!inbound\?\.length && !\(await distributionFirstMessageAllowed\(conversation, sessionUserId\)\)\)/);
  assert.match(chat, /state\.awaitingCustomer = !\(anyInbound \|\| \[\]\)\.length && !\(await distributionFirstMessageAllowed\(conversation, awaitingOwner\)\);/);
  // Proteção mantida para o resto.
  assert.match(chat, /code: "CHAT_REPLY_ONLY"/);
  assert.match(chat, /code: "CHAT_HOURLY_CAP"/);
});
