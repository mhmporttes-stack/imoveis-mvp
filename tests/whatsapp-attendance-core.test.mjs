import assert from "node:assert/strict";
import test from "node:test";
import { pickProtectedClientIds } from "../lib/whatsapp-attendance-core.mjs";

const client = (id, changedAt) => ({ id, responsible_changed_at: changedAt, created_at: "2026-09-25T10:00:00Z" });

test("assumir o atendimento protege o cliente da redistribuição, mesmo sem ter respondido", () => {
  const rows = [{ client_id: "a", last_human_reply_at: null, assumed_at: "2026-09-25T12:03:00Z" }];
  const result = pickProtectedClientIds(rows, [client("a", "2026-09-25T12:00:00Z")]);
  assert.ok(result.has("a"));
});

test("responder pelo Chat continua protegendo (regra anterior)", () => {
  const rows = [{ client_id: "a", last_human_reply_at: "2026-09-25T12:03:00Z", assumed_at: null }];
  assert.ok(pickProtectedClientIds(rows, [client("a", "2026-09-25T12:00:00Z")]).has("a"));
});

test("assunção/resposta de um corretor ANTERIOR não protege quem recebeu depois", () => {
  const rows = [{ client_id: "a", last_human_reply_at: "2026-09-25T11:00:00Z", assumed_at: "2026-09-25T11:01:00Z" }];
  assert.equal(pickProtectedClientIds(rows, [client("a", "2026-09-25T12:00:00Z")]).size, 0);
});

test("sem sinal nenhum (conversa liberada ou nunca assumida) o cliente segue elegível à redistribuição", () => {
  assert.equal(pickProtectedClientIds([{ client_id: "a", last_human_reply_at: null, assumed_at: null }], [client("a", "2026-09-25T12:00:00Z")]).size, 0);
  assert.equal(pickProtectedClientIds([], [client("a", "2026-09-25T12:00:00Z")]).size, 0);
});

test("vale o sinal mais recente entre várias conversas do mesmo cliente", () => {
  const rows = [
    { client_id: "a", last_human_reply_at: "2026-09-25T09:00:00Z", assumed_at: null },
    { client_id: "a", last_human_reply_at: null, assumed_at: "2026-09-25T12:10:00Z" }
  ];
  assert.ok(pickProtectedClientIds(rows, [client("a", "2026-09-25T12:00:00Z")]).has("a"));
});
