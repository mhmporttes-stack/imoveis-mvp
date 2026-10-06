import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ROULETTE_INELIGIBLE_STATUSES,
  isRouletteEligibleClient,
  decideOrphanAssignment,
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
test("8: devolvido pelo retorno automático (B) fica sem responsável por instantes e a rede de segurança o devolve", () => {
  const client = { id: "c1", status: CLIENT_STATUS.AWAITING_RETURN, responsible_user_id: "corretor-1", pending_distribution_at: null };
  const returned = afterReturn(client, returnedToQueueClientPatch(NOW));
  assert.equal(returned.responsible_user_id, null);
  assert.equal(shouldRescueOrphanToOwner(returned), true, "2026-10-06: nenhum cliente fica sem responsável — a rede de segurança o pega");
  const source = read("lib/prospecting-auto-return.js");
  assert.match(source, /autoReturnStaleProspectingContacts/);
  assert.equal((source.match(/returnedToQueueClientPatch\(/g) || []).length, 2, "B e C usam o mesmo patch");
});

// 9) hibernado (C)
test("9: hibernado (3ª tentativa + 24 h) também passa pela rede de segurança", () => {
  const client = { id: "c2", status: CLIENT_STATUS.AWAITING_RETURN, responsible_user_id: "corretor-1" };
  const hibernated = afterReturn(client, returnedToQueueClientPatch(NOW));
  assert.equal(hibernated.responsible_user_id, null);
  assert.equal(shouldRescueOrphanToOwner(hibernated), true, "2026-10-06: nenhum cliente fica sem responsável — a rede de segurança o pega");
  assert.match(read("lib/prospecting-auto-return.js"), /hibernatedRegistrationIds/);
});

// 10) devolução manual (D2) e "Devolver à fila" do administrador (D3)
test("10: D2 (Devolver) e D3 (Devolver à fila) também passam pela rede de segurança", () => {
  for (const status of [CLIENT_STATUS.IN_SERVICE, CLIENT_STATUS.AWAITING_RETURN, CLIENT_STATUS.PENDING]) {
    const client = { id: "c3", status, responsible_user_id: "corretor-1" };
    const returned = afterReturn(client, returnedToQueueClientPatch(NOW, { setStatus: true }));
    assert.equal(returned.responsible_user_id, null);
    assert.equal(returned.status, CLIENT_STATUS.AWAITING_RETURN);
    assert.equal(shouldRescueOrphanToOwner(returned), true, "2026-10-06: nenhum cliente fica sem responsável — a rede de segurança o pega");
  }
  const source = read("lib/prospecting.js");
  assert.equal((source.match(/returnedToQueueClientPatch\(/g) || []).length, 2, "D2 e D3 usam o mesmo patch");
});

test("8-10: nenhum cliente fica sem responsável — nem devolvido à fila, nem fila de espera (regra do dono, 2026-10-06)", () => {
  assert.equal(shouldRescueOrphanToOwner({ status: CLIENT_STATUS.IN_SERVICE, responsible_user_id: null, pending_distribution_at: null }), true);
  assert.equal(shouldRescueOrphanToOwner({ status: CLIENT_STATUS.AWAITING_RETURN, responsible_user_id: null, pending_distribution_at: null }), true);
  assert.equal(shouldRescueOrphanToOwner({ status: CLIENT_STATUS.PENDING, responsible_user_id: null, pending_distribution_at: NOW }), true);
  assert.equal(shouldRescueOrphanToOwner({ status: CLIENT_STATUS.IN_SERVICE, responsible_user_id: "corretor-1" }), false);
  const fn = read("lib/simulation-registrations.js");
  assert.ok(fn.includes("decideOrphanAssignment(client, { activeUserIds, ownerId: owner.id })"), "a rede de segurança usa a decisão pura");
  assert.ok(!fn.includes("neq(\"status\", RETURNED_TO_QUEUE_STATUS)"), "a consulta não exclui mais o devolvido à fila");
  assert.ok(read("app/api/cron/scheduled-activities/route.js").includes("reassignOrphanedClientsToOwner()"), "o cron continua chamando a rede de segurança");
});

test("órfão: devolvido volta para quem tinha (se ativo); senão o dono segura e a roleta entrega ao 1º corretor on-line", () => {
  const active = new Set(["corretor-1"]);
  const base = { responsible_user_id: null, pending_distribution_at: null };
  // devolvido à fila por um corretor ativo -> volta para ele
  assert.deepEqual(
    decideOrphanAssignment({ ...base, status: CLIENT_STATUS.AWAITING_RETURN, returned_from_user_id: "corretor-1" }, { activeUserIds: active, ownerId: "dono" }),
    { responsibleUserId: "corretor-1", markPending: false, clearPending: true, reason: "returned_to_dispatcher" }
  );
  // corretor que disparou saiu -> dono segura e entra na fila de espera
  const toOwner = decideOrphanAssignment({ ...base, status: CLIENT_STATUS.AWAITING_RETURN, returned_from_user_id: "saiu" }, { activeUserIds: active, ownerId: "dono" });
  assert.equal(toOwner.responsibleUserId, "dono");
  assert.equal(toOwner.markPending, true);
  // lead novo sem corretor on-line (já na fila de espera): dono segura e NÃO reinicia a fila
  const waiting = decideOrphanAssignment({ ...base, status: CLIENT_STATUS.PENDING, pending_distribution_at: NOW }, { activeUserIds: active, ownerId: "dono" });
  assert.equal(waiting.responsibleUserId, "dono");
  assert.equal(waiting.markPending, false);
  // etapa avançada (ex.: em atendimento) sem responsável: dono segura, sem mandar para a roleta
  const advanced = decideOrphanAssignment({ ...base, status: CLIENT_STATUS.IN_SERVICE }, { activeUserIds: active, ownerId: "dono" });
  assert.deepEqual([advanced.responsibleUserId, advanced.markPending], ["dono", false]);
  // já tem responsável / sem dono configurado -> nada a fazer
  assert.equal(decideOrphanAssignment({ ...base, responsible_user_id: "corretor-1", status: CLIENT_STATUS.PENDING }, { activeUserIds: active, ownerId: "dono" }), null);
  assert.equal(decideOrphanAssignment({ ...base, status: CLIENT_STATUS.PENDING }, { activeUserIds: active, ownerId: "" }), null);
});

test("fila de espera da roleta nasce com o dono como responsável", () => {
  const code = read("lib/simulation-registrations.js");
  assert.equal(code.split("responsibleUserId: (await findOwnerUserId()) || \"\"").length - 1, 2, "formulário completo e atendimento rápido");
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
