// Mensagens que chegam como "append" depois de uma reconexão não podem mais ser descartadas (2026-10-09).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { upsertRoute } from "../whatsapp-individual-service/src/message-extract.js";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

test("notify segue em tempo real", () => {
  assert.equal(upsertRoute({ type: "notify", now: NOW, timestampMs: NOW }), "live");
});

test("append do cliente depois da queda entra em tempo real; antigo vira histórico; muito antigo é ignorado", () => {
  assert.equal(upsertRoute({ type: "append", fromMe: false, timestampMs: NOW - 20 * MIN, now: NOW }), "live");
  assert.equal(upsertRoute({ type: "append", fromMe: false, timestampMs: NOW - 5 * HOUR, now: NOW }), "live");
  assert.equal(upsertRoute({ type: "append", fromMe: false, timestampMs: NOW - 30 * HOUR, now: NOW }), "history");
  assert.equal(upsertRoute({ type: "append", fromMe: false, timestampMs: NOW - 8 * 24 * HOUR, now: NOW }), "skip");
});

test("envio feito pelo CRM (volta como append na hora) é ignorado; do celular durante a queda entra", () => {
  assert.equal(upsertRoute({ type: "append", fromMe: true, timestampMs: NOW - 5 * 1000, now: NOW }), "skip");
  assert.equal(upsertRoute({ type: "append", fromMe: true, timestampMs: NOW - 10 * MIN, now: NOW }), "live");
});

test("o serviço usa a rota (não descarta mais o append)", () => {
  const sessions = readFileSync(new URL("../whatsapp-individual-service/src/sessions.js", import.meta.url), "utf8");
  assert.doesNotMatch(sessions, /if \(type !== "notify"\) return;/);
  assert.match(sessions, /upsertRoute\(\{ type, fromMe: Boolean\(msg\?\.key\?\.fromMe\), timestampMs: messageTimestampMs\(msg\), now \}\)/);
  assert.match(sessions, /if \(historyItems\.length\) await onHistorySync\(userId, historyItems\);/);
});
