// CLI-7b (REGRA OFICIAL — dono, 2026-10-23): cliente transferido entra no card "Novos atendimentos" de quem recebeu,
// sai de quem perdeu, sai quando atendido e muda de dono se for transferido de novo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isTransferredCandidate, TRANSFERRED_AWAITING_EXCLUDED_STATUSES } from "../lib/transferred-awaiting-core.mjs";
import { pickProtectedClientIds } from "../lib/whatsapp-attendance-core.mjs";

// Mesma composição de getUnattendedClientIds (lib/simulation-list-query.js) para os transferidos: escopo do perfil
// (aqui: corretor = responsible_user_id), candidato, atendido desde o recebimento.
function cardFor(viewerId, clients, conversations) {
  const scoped = clients.filter((client) => client.responsible_user_id === viewerId).filter(isTransferredCandidate);
  const attended = pickProtectedClientIds(conversations, scoped);
  return scoped.map((client) => client.id).filter((id) => !attended.has(id));
}

const transferred = (overrides = {}) => ({
  id: "c1",
  status: "in_service",
  responsible_user_id: "jennyfer",
  previous_responsible_user_id: "bruna",
  responsible_changed_at: "2026-10-23T12:00:00Z",
  pending_distribution_at: null,
  private_contact_at: null,
  created_at: "2026-10-01T10:00:00Z",
  ...overrides
});

test("transferido entra no card do novo responsável, mesmo com o corretor anterior tendo atendido antes", () => {
  const conversations = [{ client_id: "c1", last_human_reply_at: "2026-10-20T09:00:00Z", assumed_at: "2026-10-19T09:00:00Z" }];
  assert.deepEqual(cardFor("jennyfer", [transferred()], conversations), ["c1"]);
});

test("some do card de quem perdeu o cliente", () => {
  assert.deepEqual(cardFor("bruna", [transferred()], []), []);
});

test("some quando quem recebeu responde no Chat ou assume o atendimento", () => {
  assert.deepEqual(cardFor("jennyfer", [transferred()], [{ client_id: "c1", last_human_reply_at: "2026-10-23T12:05:00Z", assumed_at: null }]), []);
  assert.deepEqual(cardFor("jennyfer", [transferred()], [{ client_id: "c1", last_human_reply_at: null, assumed_at: "2026-10-23T12:01:00Z" }]), []);
});

test("transferido de novo: sai de quem perdeu e entra para quem recebeu, mesmo que o anterior tenha respondido", () => {
  const conversations = [{ client_id: "c1", last_human_reply_at: "2026-10-23T12:05:00Z", assumed_at: null }];
  const again = transferred({ responsible_user_id: "eduardo", previous_responsible_user_id: "jennyfer", responsible_changed_at: "2026-10-23T15:00:00Z" });
  assert.deepEqual(cardFor("jennyfer", [again], conversations), []);
  assert.deepEqual(cardFor("eduardo", [again], conversations), ["c1"]);
});

test("removido (devolvido à fila de espera da roleta) não aparece para ninguém", () => {
  const queued = transferred({ responsible_user_id: "dono", previous_responsible_user_id: "jennyfer", pending_distribution_at: "2026-10-23T12:05:00Z" });
  assert.equal(isTransferredCandidate(queued), false);
});

test("sem troca real de responsável não é transferido", () => {
  assert.equal(isTransferredCandidate(transferred({ previous_responsible_user_id: null })), false);
  assert.equal(isTransferredCandidate(transferred({ previous_responsible_user_id: "jennyfer" })), false);
  assert.equal(isTransferredCandidate(transferred({ responsible_changed_at: null })), false);
});

test("negativos, pago, particular e aguardando simulação ficam fora (aguardando simulação tem item próprio)", () => {
  for (const status of ["archived", "do_not_contact", "restriction", "rejected", "income_commitment", "sale_paid", "pending"]) {
    assert.ok(TRANSFERRED_AWAITING_EXCLUDED_STATUSES.includes(status), status);
    assert.equal(isTransferredCandidate(transferred({ status })), false, status);
  }
  assert.equal(isTransferredCandidate(transferred({ private_contact_at: "2026-10-23T12:00:00Z" })), false);
  // Simulação automática = Simulação realizada (REGRA OFICIAL — dono, 2026-10-24): não é "aguardando simulação", entra no card.
  for (const status of ["in_service", "awaiting_return", "automated_service", "auto_simulation", "completed", "simulation_sent", "documentation_pending", "approved"]) {
    assert.equal(isTransferredCandidate(transferred({ status })), true, status);
  }
});

test("o card do servidor usa a mesma regra (candidato + atendido desde o recebimento, no escopo do perfil)", () => {
  const source = readFileSync(new URL("../lib/simulation-list-query.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export const getUnattendedClientIds"), source.indexOf("function sanitizeFilterTerm"));
  assert.match(body, /\.filter\(isTransferredCandidate\)/);
  assert.match(body, /TRANSFERRED_AWAITING_EXCLUDED_STATUSES/);
  assert.match(body, /listClientIdsWithHumanAttendance\(chunk\)/);
  assert.match(body, /applyResponsibleUserScope\(query, auth\)/);
});
