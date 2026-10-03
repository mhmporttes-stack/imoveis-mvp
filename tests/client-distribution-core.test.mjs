import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ROULETTE_INELIGIBLE_STATUSES,
  isRouletteEligibleClient,
  returnedToQueueClientPatch,
  shouldRescueOrphanToOwner
} from "../lib/client-distribution-core.mjs";
import { CLIENT_STATUS } from "../lib/client-status.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NOW = "2026-10-03T12:00:00.000Z";

// Aplica o patch ao cliente como o banco faria e pergunta à rede de segurança do cron.
function afterReturn(client, patch) {
  return { ...client, ...patch };
}

// 8) devolvido pelo retorno automático de 7 dias (B)
test("8: devolvido pelo retorno automático (B) fica sem responsável e o cron NÃO o devolve ao dono", () => {
  const client = { id: "c1", status: CLIENT_STATUS.AWAITING_RETURN, responsible_user_id: "corretor-1", pending_distribution_at: null };
  const returned = afterReturn(client, returnedToQueueClientPatch(NOW));
  assert.equal(returned.responsible_user_id, null);
  assert.equal(shouldRescueOrphanToOwner(returned), false);
  const source = read("lib/prospecting-auto-return.js");
  assert.match(source, /autoReturnStaleProspectingContacts/);
  assert.equal((source.match(/returnedToQueueClientPatch\(/g) || []).length, 2, "B e C usam o mesmo patch");
});

// 9) hibernado (C)
test("9: hibernado (3ª tentativa + 24 h) permanece sem responsável", () => {
  const client = { id: "c2", status: CLIENT_STATUS.AWAITING_RETURN, responsible_user_id: "corretor-1" };
  const hibernated = afterReturn(client, returnedToQueueClientPatch(NOW));
  assert.equal(hibernated.responsible_user_id, null);
  assert.equal(shouldRescueOrphanToOwner(hibernated), false);
  assert.match(read("lib/prospecting-auto-return.js"), /hibernatedRegistrationIds/);
});

// 10) devolução manual (D2) e "Devolver à fila" do administrador (D3)
test("10: D2 (Devolver) e D3 (Devolver à fila) também permanecem sem responsável", () => {
  for (const status of [CLIENT_STATUS.IN_SERVICE, CLIENT_STATUS.AWAITING_RETURN, CLIENT_STATUS.PENDING]) {
    const client = { id: "c3", status, responsible_user_id: "corretor-1" };
    const returned = afterReturn(client, returnedToQueueClientPatch(NOW, { setStatus: true }));
    assert.equal(returned.responsible_user_id, null);
    assert.equal(returned.status, CLIENT_STATUS.AWAITING_RETURN);
    assert.equal(shouldRescueOrphanToOwner(returned), false);
  }
  const source = read("lib/prospecting.js");
  assert.equal((source.match(/returnedToQueueClientPatch\(/g) || []).length, 2, "D2 e D3 usam o mesmo patch");
});

test("8-10: o cron ainda resgata órfãos de OUTRA origem (ninguém fica invisível) mas não os devolvidos à fila", () => {
  assert.equal(shouldRescueOrphanToOwner({ status: CLIENT_STATUS.IN_SERVICE, responsible_user_id: null, pending_distribution_at: null }), true, "ex.: usuário removido / reatribuição manual para ninguém");
  assert.equal(shouldRescueOrphanToOwner({ status: CLIENT_STATUS.AWAITING_RETURN, responsible_user_id: null, pending_distribution_at: null }), false);
  assert.equal(shouldRescueOrphanToOwner({ status: CLIENT_STATUS.PENDING, responsible_user_id: null, pending_distribution_at: NOW }), false, "fila de espera da roleta continua sendo da roleta");
  assert.equal(shouldRescueOrphanToOwner({ status: CLIENT_STATUS.IN_SERVICE, responsible_user_id: "corretor-1" }), false);
  const fn = read("lib/simulation-registrations.js");
  assert.match(fn, /\.neq\("status", RETURNED_TO_QUEUE_STATUS\)/, "a consulta do cron exclui o devolvido à fila");
  assert.match(read("app/api/cron/scheduled-activities/route.js"), /reassignOrphanedClientsToOwner\(\)/, "o cron continua chamando a rede de segurança");
});

// 11) D1 continua
test("11: D1 (Chat 'Ninguém / liberar') continua devolvendo o cliente para a roleta por presença", () => {
  const chat = read("lib/whatsapp-chat.js");
  assert.match(chat, /whatsapp_chat_release/);
  assert.match(chat, /assignRoundRobinLead\(\{ excludedBrokerId: client\.responsible_user_id \|\| null \}\)/);
  assert.match(chat, /updateSimulationRegistration\(conversation\.client_id, \{ responsibleUserId: picked\.brokerId \}, null\)/);
  assert.doesNotMatch(chat, /returnedToQueueClientPatch/, "D1 não foi alterado pela regra do P-05");
});

// 12) Não contactar nunca volta à distribuição
test("12: Não contactar, arquivados e status negativos nunca entram na roleta", () => {
  for (const status of ROULETTE_INELIGIBLE_STATUSES) assert.equal(isRouletteEligibleClient({ status }), false, status);
  for (const status of [CLIENT_STATUS.DO_NOT_CONTACT, CLIENT_STATUS.ARCHIVED, CLIENT_STATUS.REJECTED, CLIENT_STATUS.RESTRICTION, CLIENT_STATUS.INCOME_COMMITMENT]) {
    assert.ok(ROULETTE_INELIGIBLE_STATUSES.includes(status), status);
  }
  assert.equal(isRouletteEligibleClient({ status: CLIENT_STATUS.PENDING, distribution_type: "round_robin" }), true);
});

test("12: link pessoal, canal direto e contato em bloqueio de 30 dias (available_after) não entram na roleta", () => {
  assert.equal(isRouletteEligibleClient({ status: CLIENT_STATUS.PENDING, direct_broker_link: true }), false);
  assert.equal(isRouletteEligibleClient({ status: CLIENT_STATUS.PENDING, distribution_type: "direct_channel" }), false);
  const now = new Date("2026-10-03T12:00:00Z");
  assert.equal(isRouletteEligibleClient({ status: CLIENT_STATUS.PENDING, available_after: "2026-10-20T00:00:00Z" }, now), false);
  assert.equal(isRouletteEligibleClient({ status: CLIENT_STATUS.PENDING, available_after: "2026-10-01T00:00:00Z" }, now), true);
  assert.match(read("lib/lead-distribution.js"), /isRouletteEligibleClient\(/, "a fila de espera da roleta usa a elegibilidade");
});

test("12: Não contactar mantém o responsável (CLI-9) — a devolução à fila não o atinge", () => {
  // o patch de devolução só é aplicado a quem está em 'Tentando contato'; Não contactar usa o patch próprio
  const dnc = read("lib/do-not-contact-core.mjs");
  assert.doesNotMatch(dnc, /responsible_user_id: null/);
});
