// Transferência manual não pode ser desfeita pela fila de espera da roleta (2026-10-06).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pendingRouletteRowsToDeliver } from "../lib/pending-roulette-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const OWNER = "dono";

test("a roleta só entrega cliente sem responsável ou segurado pelo dono; transferido a corretor sai da fila", () => {
  const rows = [
    { id: "1", responsible_user_id: null },
    { id: "2", responsible_user_id: OWNER },
    { id: "3", responsible_user_id: "izabela" }
  ];
  const { deliver, release } = pendingRouletteRowsToDeliver(rows, OWNER);
  assert.deepEqual(deliver.map((row) => row.id), ["1", "2"]);
  assert.deepEqual(release.map((row) => row.id), ["3"]);
  assert.deepEqual(pendingRouletteRowsToDeliver([], OWNER), { deliver: [], release: [] });
});

test("sem dono identificado, quem tem responsável nunca é tomado pela roleta", () => {
  const { deliver, release } = pendingRouletteRowsToDeliver([{ id: "1", responsible_user_id: "x" }, { id: "2", responsible_user_id: "" }], "");
  assert.deepEqual(deliver.map((row) => row.id), ["2"]);
  assert.deepEqual(release.map((row) => row.id), ["1"]);
});

test("transferência explícita encerra a fila de espera e a roleta usa o filtro", () => {
  const registrations = read("lib/simulation-registrations.js");
  assert.ok(registrations.includes("if (nextResponsibleUserId) record.pending_distribution_at = null;"));
  const lead = read("lib/lead-distribution.js");
  assert.ok(lead.includes("pendingRouletteRowsToDeliver(candidates, ownerId)"));
  assert.ok(lead.includes("responsible_user_id\")") || lead.includes("prospecting_contact_id, responsible_user_id"));
});

test("fila de espera: no máximo 1 cliente por corretor on-line por rodada (regra do dono 2026-10-08)", async () => {
  const { waitingQueueBatchSize, WAITING_QUEUE_INTERVAL_MINUTES } = await import("../lib/pending-roulette-core.mjs");
  assert.equal(waitingQueueBatchSize(4, 1), 1, "1 corretor on-line + 4 aguardando = recebe só 1 nesta rodada");
  assert.equal(waitingQueueBatchSize(4, 3), 3);
  assert.equal(waitingQueueBatchSize(2, 5), 2);
  assert.equal(waitingQueueBatchSize(4, 0), 0);
  assert.equal(WAITING_QUEUE_INTERVAL_MINUTES, 2);
  const fs = await import("node:fs");
  const lib = fs.readFileSync(new URL("../lib/lead-distribution.js", import.meta.url), "utf8");
  assert.match(lib, /const maxDeliveries = waitingQueueBatchSize\(pending\.length, onlineBrokers\)/);
  assert.match(lib, /if \(servedThisRound\.size >= maxDeliveries\) break;/);
  assert.match(lib, /if \(servedThisRound\.has\(roulette\.brokerId\)\) continue;/);
});

test("prazo de 5 min sem atender e ninguém mais on-line: cliente vai para a espera do dono e nunca volta a quem o perdeu (2026-10-08)", () => {
  const automations = read("lib/crm-automations.js");
  assert.match(automations, /const moved = await moveClientToRouletteWaitingQueue\(client, \{ rule \}\);/);
  assert.match(automations, /if \(client\.pending_distribution_at\) return;/, "cliente na fila de espera é entregue só pela fila (1 por corretor a cada 2 min)");
  const lib = read("lib/lead-distribution.js");
  assert.match(lib, /responsible_user_id: ownerId, previous_responsible_user_id: fromUserId, responsible_changed_at: now, pending_distribution_at: now/);
  assert.match(lib, /toWaitingQueue: true/);
  assert.match(lib, /assignRoundRobinLead\(\{ excludedBrokerId \}\)/, "fila exclui quem perdeu o cliente");
  // o prazo de 5 min conta da ENTREGA pela fila
  assert.match(lib, /pending_distribution_at: null,\n\s+responsible_changed_at: new Date\(\)\.toISOString\(\)/);
});
