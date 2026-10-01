// Vínculo contato da fila (prospecting_contacts) → cliente
// (simulation_registrations). Regras puras, testadas em
// tests/contact-client-link.test.mjs.
//
// Bug real (P-01, 14/09 a 29/09/2026): contatos DIFERENTES com o mesmo nome
// foram ligados ao MESMO cliente (o casamento por nome já foi removido de
// findMatchingRegistration em 83bdf1a), e cada novo contato sobrescrevia o
// telefone desse cliente. 15 clientes ficaram compartilhados por 144 rodadas.
// Para isso nunca mais se propagar (inclusive pelos vínculos antigos que
// ficaram gravados em prospecting_contacts.registration_id), o cliente
// vinculado só vale para o contato quando o TELEFONE bate.
import { isSamePhone } from "./phone-utils.js";

export function clientMatchesContactPhone(clientPhone, contactPhone) {
  return Boolean(clientPhone && contactPhone && isSamePhone(clientPhone, contactPhone));
}

// Telefone de quem é tentado numa rodada da Meta Diária: SEMPRE o do contato
// daquela rodada (a pessoa que entrou na fila). O do cliente só serve de
// reserva se o contato não tiver telefone.
export function roundContactPhone(round) {
  return round?.contact?.phone_normalized || round?.client?.phone_normalized || "";
}

// Nome exibido/usado em {primeiro_nome}: o do cliente (pode ter sido
// corrigido pelo corretor) quando o cliente é mesmo dessa pessoa; senão o
// do contato.
export function roundPersonName(round) {
  const client = round?.client;
  const contact = round?.contact;
  const clientIsThisPerson = client?.full_name && (!contact?.phone_normalized || clientMatchesContactPhone(client.phone_normalized, contact.phone_normalized));
  if (clientIsThisPerson) return client.full_name;
  return contact?.name || client?.full_name || "Cliente";
}
