import test from "node:test";
import assert from "node:assert/strict";
import { ALERT_KIND, quietImportantForAdmins, replyWaitingDedupeKey } from "../lib/crm-alerts-core.mjs";
import { directionTone } from "../lib/economic-indicators-core.mjs";

const ADMIN = "admin-1";
const CAROL = "carol-1";
const row = (recipient_id, extra = {}) => ({ recipient_id, kind: ALERT_KIND.IMPORTANT, body: "x", dedupe_key: "k", ...extra });

test("supervisão: admin geral recebe Informativo, gestora continua com Importante", () => {
  const rows = [
    row(ADMIN, { context: { source: "whatsapp_session_attention" } }),
    row(CAROL, { context: { source: "whatsapp_session_attention" } }),
    row(ADMIN, { context: { source: "whatsapp_false_connection" } }),
    row(ADMIN, { dedupe_key: replyWaitingDedupeKey("c1", "2026-10-29T10:00:00Z") })
  ];
  const out = quietImportantForAdmins(rows, new Set([ADMIN]));
  assert.deepEqual(out.map((r) => r.kind), ["informative", "important", "informative", "informative"]);
});

test("falhas do sistema só do admin continuam Importantes", () => {
  const sources = ["whatsapp_service_stalled", "marketplace_extension_signal", "henry_lock", "whatsapp_disconnect_owner"];
  const out = quietImportantForAdmins(sources.map((source) => row(ADMIN, { context: { source } })), new Set([ADMIN]));
  assert.ok(out.every((r) => r.kind === "important"));
  const test = quietImportantForAdmins([row(ADMIN, { dedupe_key: "test:1" })], new Set([ADMIN]));
  assert.equal(test[0].kind, "important");
});

test("setas IPCA/INCC: queda verde, alta vermelha, estável neutra; outros neutros", () => {
  assert.equal(directionTone("ipca", "down"), "good");
  assert.equal(directionTone("incc", "up"), "bad");
  assert.equal(directionTone("ipca", "stable"), "neutral");
  assert.equal(directionTone("selic", "up"), "neutral");
  assert.equal(directionTone("igpm", "down"), "neutral");
});
