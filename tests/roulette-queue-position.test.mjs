// Posição na fila da roleta e filtro "Roleta" da lista de Clientes (dono, 2026-10-22).
// A régua é ÚNICA: planWaitingQueue (fila de espera) e reactivationQueuePositions (fila de reativação, FUN-15l), usadas
// pelos entregadores e pela lista.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareRouletteQueueEntries, planWaitingQueue, rouletteQueueLabel } from "../lib/pending-roulette-core.mjs";
import { compareReactivationQueue, reactivationQueuePositions } from "../lib/cooled-clients-reactivation-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const OWNER = "dono";
const NOW = new Date("2026-10-22T12:00:00Z");
const at = (minutes) => new Date(Date.UTC(2026, 9, 20, 0, minutes)).toISOString();
const row = (id, minutes, extra = {}) => ({ id, pending_distribution_at: at(minutes), status: "pending", responsible_user_id: OWNER, ...extra });

test("ordem real: mais antigo primeiro, empate pelo id; inelegíveis ficam fora com o motivo", () => {
  const blockedContact = new Map([["c1", "2026-11-10T00:00:00Z"]]);
  const rows = [
    row("d", 5),
    row("b", 1),
    row("a", 1),
    row("arq", 0, { status: "archived" }),
    row("link", 2, { direct_broker_link: true }),
    row("bloq", 3, { prospecting_contact_id: "c1" }),
    row("outro", 4, { responsible_user_id: "corretor" }),
    row("reac", 0)
  ];
  const { entries, deliver, release } = planWaitingQueue(rows, { ownerId: OWNER, reactivationIds: new Set(["reac"]), availableAfterByContact: blockedContact, now: NOW });
  assert.deepEqual(entries.get("a"), { position: 1 });
  assert.deepEqual(entries.get("b"), { position: 2 });
  assert.deepEqual(entries.get("d"), { position: 3 });
  assert.equal(entries.get("arq").reason, "status");
  assert.equal(entries.get("link").reason, "direct_link");
  assert.equal(entries.get("bloq").reason, "blocked_30d");
  assert.equal(entries.get("outro").reason, "has_broker");
  assert.equal(entries.has("reac"), false, "fila de reativação tem posição própria");
  assert.deepEqual(deliver.map((item) => item.id), ["a", "b", "d"], "o entregador recebe a mesma ordem");
  assert.deepEqual(release.map((item) => item.id), ["outro"]);
});

test("bloqueados de 30 dias não seguram a fila (dono, 2026-10-22): 30 na frente + elegíveis atrás → entregues", () => {
  const blocked = new Map();
  const rows = [];
  for (let index = 0; index < 30; index += 1) {
    blocked.set(`c${index}`, "2026-11-10T00:00:00Z");
    rows.push(row(`b${String(index).padStart(2, "0")}`, index, { prospecting_contact_id: `c${index}` }));
  }
  for (let index = 0; index < 7; index += 1) rows.push(row(`ok${index}`, 100 + index));
  const { entries, deliver } = planWaitingQueue(rows, { ownerId: OWNER, availableAfterByContact: blocked, now: NOW });
  assert.deepEqual(deliver.map((item) => item.id), ["ok0", "ok1", "ok2", "ok3", "ok4", "ok5", "ok6"]);
  assert.deepEqual(entries.get("ok0"), { position: 1 });
  assert.equal(entries.get("b00").reason, "blocked_30d");
  for (const [, entry] of entries) assert.notEqual(entry.reason, "stalled");
  // Bloqueio vencido: volta à fila sozinho, na ordem de entrada (na frente).
  const expired = planWaitingQueue(rows, { ownerId: OWNER, availableAfterByContact: blocked, now: new Date("2026-11-11T00:00:00Z") });
  assert.deepEqual(expired.entries.get("b00"), { position: 1 });
  assert.equal(expired.deliver.length, 25, "o lote continua de 25");
});

test("link pessoal/canal direto ainda ocupam o lote: elegível atrás de 25+ deles fica travado", () => {
  const rows = [row("l0", 0, { direct_broker_link: true }), row("l1", 1, { distribution_type: "direct_channel" }), row("l2", 2, { direct_broker_link: true }), row("ok", 10)];
  const stuck = planWaitingQueue(rows, { ownerId: OWNER, now: NOW, limit: 3 });
  assert.equal(stuck.entries.get("ok").reason, "stalled");
  assert.equal(rouletteQueueLabel({ queue: "waiting", reason: "stalled" }), "Roleta · fora da fila (travado atrás de link pessoal/canal direto)");
  const free = planWaitingQueue(rows, { ownerId: OWNER, now: NOW, limit: 4 });
  assert.deepEqual(free.deliver.map((item) => item.id), ["ok"]);
});

test("entregador lê a fila inteira e monta o lote sem os bloqueados", () => {
  const lead = read("lib/lead-distribution.js");
  assert.match(lead, /\.limit\(1000\);/);
  assert.match(lead, /planWaitingQueue\(candidates, \{ ownerId, availableAfterByContact, limit \}\)/);
});

test("fila de reativação: ordem por entrada na fila; quem não espera mais fica fora", () => {
  const waiting = { responsible_user_id: OWNER, pending_distribution_at: at(0), eligible: true };
  const entries = reactivationQueuePositions([
    { caseId: "k2", clientId: "x", queuedAt: at(5), client: waiting },
    { caseId: "k1", clientId: "y", queuedAt: at(1), client: waiting },
    { caseId: "k3", clientId: "z", queuedAt: at(2), client: { ...waiting, eligible: false } }
  ], { ownerId: OWNER });
  assert.deepEqual(entries.get("y"), { position: 1 });
  assert.deepEqual(entries.get("x"), { position: 2 });
  assert.equal(entries.get("z").reason, "reactivation_out");
  assert.ok(compareReactivationQueue({ queuedAt: at(1), caseId: "b" }, { queuedAt: at(1), caseId: "a" }) > 0);
});

test("etiquetas e ordem do filtro Roleta", () => {
  assert.equal(rouletteQueueLabel({ queue: "waiting", position: 3 }), "Roleta · 3º na fila");
  assert.equal(rouletteQueueLabel({ queue: "reactivation", position: 2 }), "Fila de reativação · 2º");
  assert.equal(rouletteQueueLabel({ queue: "waiting", reason: "blocked_30d" }), "Roleta · fora da fila (bloqueio de 30 dias)");
  assert.equal(rouletteQueueLabel({ queue: "waiting", reason: "status", status: "do_not_contact" }), "Roleta · fora da fila (não contactar)");
  assert.equal(rouletteQueueLabel(null), "Roleta");
  const list = [
    { id: "fora", reason: "blocked_30d", pending_distribution_at: at(0) },
    { id: "r1", queue: "reactivation", position: 1, pending_distribution_at: at(0) },
    { id: "w2", queue: "waiting", position: 2, pending_distribution_at: at(0) },
    { id: "w1", queue: "waiting", position: 1, pending_distribution_at: at(0) }
  ].sort(compareRouletteQueueEntries);
  assert.deepEqual(list.map((item) => item.id), ["w1", "w2", "r1", "fora"]);
});

test("filtro Roleta no servidor: fila de espera, escopo de sempre e opção na tela (Sem corretor continua)", () => {
  const query = read("lib/simulation-list-query.js");
  assert.match(query, /const responsibleUserId = filters\.responsibleUserId === "all" \|\| rouletteFilter \? "" : filters\.responsibleUserId;/);
  assert.match(query, /applyResponsibleUserScope\(query, auth, "responsible_user_id", responsibleUserId/);
  assert.match(query, /if \(rouletteFilter\) query = query\.not\("pending_distribution_at", "is", null\);/);
  const lead = read("lib/lead-distribution.js");
  assert.match(lead, /planWaitingQueue\(rows, \{ ownerId, reactivationIds/);
  assert.match(lead, /reactivationQueuePositions\(reactivationCases/);
  const reactivation = read("lib/cooled-clients-reactivation.js");
  assert.match(reactivation, /queue\.sort\(\(a, b\) => compareReactivationQueue\(/);
  const ui = read("components/clients/ClientWorkspace.jsx");
  const allIdx = ui.indexOf('<option value="all">Todos os corretores</option>');
  const rouletteIdx = ui.indexOf('<option value="roulette">Roleta</option>');
  const unassignedIdx = ui.indexOf('<option value="unassigned">Sem corretor</option>');
  assert.ok(allIdx > -1 && rouletteIdx > allIdx && unassignedIdx > rouletteIdx);
});
