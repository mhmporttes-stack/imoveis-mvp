import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LID_RECONCILE_FULL_INTERVAL_MS,
  LID_RECONCILE_OVERLAP_MS,
  planLidReconcile
} from "../lib/whatsapp-lid-reconcile-core.mjs";

// Desempenho (2026-10-20): "Número não identificado" só reprocessa conversa "lid:" com novidade; varredura completa a cada 30 min.
const now = new Date("2026-10-20T15:00:00.000Z");
const minutesAgo = (m) => new Date(now.getTime() - m * 60000).toISOString();

test("sem marca anterior faz a varredura completa e grava a marca", () => {
  const plan = planLidReconcile({ now, state: null });
  assert.equal(plan.full, true);
  assert.equal(plan.since, null);
  assert.deepEqual(plan.nextState, { lastCheckedAt: now.toISOString(), lastFullAt: now.toISOString() });
});

test("rodada comum só olha novidade desde a última checagem (com folga)", () => {
  const plan = planLidReconcile({ now, state: { lastCheckedAt: minutesAgo(2), lastFullAt: minutesAgo(10) } });
  assert.equal(plan.full, false);
  assert.equal(plan.since, new Date(now.getTime() - 2 * 60000 - LID_RECONCILE_OVERLAP_MS).toISOString());
  assert.equal(plan.nextState.lastCheckedAt, now.toISOString());
  assert.equal(plan.nextState.lastFullAt, minutesAgo(10));
});

test("varredura completa volta depois de 30 min", () => {
  assert.equal(LID_RECONCILE_FULL_INTERVAL_MS, 30 * 60000);
  assert.equal(planLidReconcile({ now, state: { lastCheckedAt: minutesAgo(2), lastFullAt: minutesAgo(29) } }).full, false);
  assert.equal(planLidReconcile({ now, state: { lastCheckedAt: minutesAgo(2), lastFullAt: minutesAgo(30) } }).full, true);
});

test("marca inválida, ausente ou no futuro nunca trava a rotina: varre tudo", () => {
  assert.equal(planLidReconcile({ now, state: { lastCheckedAt: "lixo", lastFullAt: minutesAgo(1) } }).full, true);
  assert.equal(planLidReconcile({ now, state: { lastCheckedAt: minutesAgo(1) } }).full, true);
  assert.equal(planLidReconcile({ now, state: { lastCheckedAt: minutesAgo(1), lastFullAt: "2026-10-21T00:00:00.000Z" } }).full, true);
});

test("reconcileLidPlaceholders usa o plano, filtra por novidade e grava a marca", () => {
  const inbound = readFileSync(new URL("../lib/whatsapp-individual-inbound.js", import.meta.url), "utf8");
  assert.match(inbound, /planLidReconcile\(\{ now, state: setting\?\.setting_value \|\| null \}\)/);
  assert.match(inbound, /if \(!plan\.full\) query = query\.or\(`last_message_at\.gte\.\$\{plan\.since\},updated_at\.gte\.\$\{plan\.since\}`\)/);
  assert.match(inbound, /setting_value: plan\.nextState/);
});

test("migration do índice parcial de remote_jid existe e é concorrente", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261020120000_whatsapp_messages_remote_jid_index.sql", import.meta.url), "utf8");
  assert.match(sql, /create index concurrently if not exists whatsapp_messages_session_remote_jid_idx/);
  assert.match(sql, /\(session_user_id, session_slot, \(metadata->>'remote_jid'\)\)/);
  assert.match(sql, /where metadata \? 'remote_jid'/);
});
