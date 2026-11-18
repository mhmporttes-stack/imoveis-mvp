import test from "node:test";
import assert from "node:assert/strict";
import { buildUnattendedEntries, isRecentNewClientCandidate, NEW_CLIENT_WINDOW_MS } from "../lib/new-clients-core.mjs";

const NOW = Date.parse("2026-11-18T15:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const H = 3600 * 1000;
const base = (id, status, extra = {}) => ({ id, status, responsible_user_id: "u1", created_at: ago(H), list_order_at: ago(H), private_contact_at: null, ...extra });
const run = (input) => buildUnattendedEntries({ now: NOW, ...input });

test("cadastro novo em simulação automática sem atendimento entra", () => {
  assert.deepEqual(run({ recentClients: [base("a", "auto_simulation")] }).map((e) => e.id), ["a"]);
});
test("cadastro em Aguardando simulação (pending) sem atendimento entra", () => {
  assert.deepEqual(run({ recentClients: [base("p", "pending")] }).map((e) => e.id), ["p"]);
});
test("com atendimento humano sai", () => {
  assert.deepEqual(run({ recentClients: [base("a", "auto_simulation")], attendedEver: new Set(["a"]) }), []);
});
test("arquivado, negativo e em atendimento não entram como cadastro novo", () => {
  for (const status of ["archived", "do_not_contact", "restriction", "in_service", "simulation_sent"]) {
    assert.equal(isRecentNewClientCandidate(base("x", status), NOW), false, status);
  }
});
test("fora da janela de 7 dias ou com contato particular não entra", () => {
  assert.equal(isRecentNewClientCandidate(base("x", "auto_simulation", { created_at: ago(NEW_CLIENT_WINDOW_MS + H) }), NOW), false);
  assert.equal(isRecentNewClientCandidate(base("x", "auto_simulation", { private_contact_at: ago(H) }), NOW), false);
});
test("trocou de responsável deixa de ser cadastro novo (segue CLI-7b)", () => {
  const moved = base("t", "auto_simulation", { previous_responsible_user_id: "u0", responsible_changed_at: ago(H) });
  assert.equal(isRecentNewClientCandidate(moved, NOW), false);
});
test("Atendimento automático nunca atendido continua entrando; atendido sai", () => {
  const auto = base("s", "automated_service", { created_at: ago(30 * 24 * H), list_order_at: ago(30 * 24 * H) });
  assert.deepEqual(run({ automatedClients: [auto] }).map((e) => e.id), ["s"]);
  assert.deepEqual(run({ automatedClients: [auto], attendedEver: new Set(["s"]) }), []);
});
test("transferido continua como antes (atendido desde o recebimento sai) e ordena pela troca", () => {
  const t = base("t", "in_service", { created_at: ago(40 * 24 * H), list_order_at: ago(40 * 24 * H), previous_responsible_user_id: "u0", responsible_changed_at: ago(2 * H) });
  assert.deepEqual(run({ transferredClients: [t] }).map((e) => e.id), ["t"]);
  assert.deepEqual(run({ transferredClients: [t], attendedSinceReceipt: new Set(["t"]) }), []);
  // atendido por outro antes não conta (attendedEver não afeta transferido)
  assert.deepEqual(run({ transferredClients: [t], attendedEver: new Set(["t"]) }).map((e) => e.id), ["t"]);
});
test("ordem: mais recente no topo (cadastro novo e transferido misturados)", () => {
  const old = base("old", "auto_simulation", { created_at: ago(5 * H), list_order_at: ago(5 * H) });
  const fresh = base("fresh", "pending", { created_at: ago(1 * H), list_order_at: ago(1 * H) });
  const t = base("t", "in_service", { previous_responsible_user_id: "u0", responsible_changed_at: ago(3 * H) });
  assert.deepEqual(run({ recentClients: [old, fresh], transferredClients: [t] }).map((e) => e.id), ["fresh", "t", "old"]);
});
test("sem duplicar quem está em mais de uma origem", () => {
  const t = base("t", "automated_service", { previous_responsible_user_id: "u0", responsible_changed_at: ago(H) });
  assert.equal(run({ automatedClients: [t], transferredClients: [t] }).length, 1);
});
