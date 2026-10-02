import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decideReport, decideValidation, decideAutoEnd, decideResolve, validationOriginFor, canValidateRestriction,
  resolveWhatsappBadge, normalizeDisconnectCode, WHATSAPP_BADGES, WHATSAPP_BADGE_LEGEND
} from "../lib/whatsapp-restriction-core.mjs";
import { decideProspectingGate } from "../lib/prospecting-eligibility-core.mjs";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const informed = { id: "r1", user_id: "b1", ended_at: null, validation_status: "informed" };
const validated = { ...informed, validation_status: "validated" };
const admin = { actorId: "a1", actorRole: "admin", isGeneralAdmin: true, targetUserId: "b1", managedUserIds: [] };
const manager = { actorId: "m1", actorRole: "manager", isGeneralAdmin: false, targetUserId: "b1", managedUserIds: ["m1", "b1"] };

test("informar cria restrição informada e NÃO dá benefício algum (Prospecção segue bloqueada)", () => {
  assert.deepEqual(decideReport({ confirmed: true, sessionStatus: "disconnected" }), { action: "create" });
  assert.equal(resolveWhatsappBadge({ sessionStatus: "disconnected", openRestriction: informed }), WHATSAPP_BADGES.informed);
  assert.equal(decideProspectingGate({ kind: "participate", role: "broker", sessionStatus: "disconnected" }).allowed, false);
  // ao informar não grava nenhum campo de validação
  assert.match(src("lib/whatsapp-restriction.js"), /insert\(\{ user_id: targetUserId, reported_by: actorId \}\)/);
});

test("admin geral valida qualquer corretor; gestora só da própria equipe", () => {
  assert.equal(validationOriginFor(admin), "admin");
  assert.equal(validationOriginFor(manager), "gestora");
  assert.equal(decideValidation({ verdict: "validate", origin: "admin", openRestriction: informed, sessionStatus: "disconnected" }).action, "validate");
  assert.equal(decideValidation({ verdict: "validate", origin: "gestora", openRestriction: informed, sessionStatus: "disconnected" }).action, "validate");
});

test("gestora de outra equipe, corretor, associado e auto-validação são recusados (403)", () => {
  assert.equal(validationOriginFor({ ...manager, managedUserIds: ["m2", "b9"] }), null);
  assert.equal(validationOriginFor({ actorId: "b1", actorRole: "broker", targetUserId: "b1" }), null);
  assert.equal(validationOriginFor({ actorId: "b2", actorRole: "broker", targetUserId: "b1", managedUserIds: ["b1"] }), null);
  assert.equal(validationOriginFor({ actorId: "s1", actorRole: "associate", targetUserId: "b1" }), null);
  assert.equal(validationOriginFor({ ...admin, actorId: "b1" }), null);
  assert.equal(canValidateRestriction({ ...manager, managedUserIds: [] }), false);
  assert.deepEqual(decideValidation({ verdict: "validate", origin: null, openRestriction: informed }), { action: "refuse", reason: "forbidden" });
  assert.match(src("lib/whatsapp-restriction.js"), /forbidden: \[403/);
});

test("Não validar encerra como rejeitada; validada não pode ser rejeitada depois", () => {
  const rej = decideValidation({ verdict: "reject", origin: "gestora", openRestriction: informed, sessionStatus: "disconnected" });
  assert.equal(rej.action, "reject");
  assert.equal(rej.end_reason, "manual");
  assert.deepEqual(decideValidation({ verdict: "reject", origin: "admin", openRestriction: validated }), { action: "refuse", reason: "already_validated" });
  assert.match(src("lib/whatsapp-restriction.js"), /validation_status: VALIDATION_REJECTED[\s\S]*ended_at: now/);
});

test("idempotência: validar de novo é noop; sem restrição aberta ou já conectado é recusado", () => {
  assert.deepEqual(decideValidation({ verdict: "validate", origin: "admin", openRestriction: validated }), { action: "noop", reason: "already_validated" });
  assert.equal(decideValidation({ verdict: "validate", origin: "admin", openRestriction: null }).reason, "not_restricted");
  assert.equal(decideValidation({ verdict: "validate", origin: "admin", openRestriction: { ...informed, ended_at: "2026-10-03T00:00:00Z" } }).reason, "not_restricted");
  assert.equal(decideValidation({ verdict: "validate", origin: "admin", openRestriction: informed, sessionStatus: "connected" }).reason, "already_connected");
  assert.equal(decideValidation({ verdict: "xx", origin: "admin", openRestriction: informed }).reason, "invalid_verdict");
  assert.match(src("lib/whatsapp-restriction.js"), /\.is\("ended_at", null\)\.eq\("validation_status", "informed"\)/);
});

test("4 estados distintos (ícone + texto) e legenda", () => {
  const states = [
    resolveWhatsappBadge({ sessionStatus: "connected" }),
    resolveWhatsappBadge({ sessionStatus: "disconnected" }),
    resolveWhatsappBadge({ sessionStatus: "disconnected", openRestriction: informed }),
    resolveWhatsappBadge({ sessionStatus: "disconnected", openRestriction: validated })
  ];
  assert.equal(new Set(states.map((s) => s.label)).size, 4);
  assert.equal(new Set(states.map((s) => s.icon)).size, 4);
  assert.equal(states[2].label, "Restrição informada — aguardando validação");
  assert.equal(states[3].label, "Restrição validada");
  assert.match(WHATSAPP_BADGE_LEGEND, /informada/);
});

test("encerramento automático ao conectar vale também para a validada; histórico registra os eventos", () => {
  assert.equal(decideAutoEnd({ sessionStatus: "connected", openRestriction: validated }).action, "close");
  assert.equal(resolveWhatsappBadge({ sessionStatus: "connected", openRestriction: validated }), WHATSAPP_BADGES.connected);
  assert.equal(decideResolve({ openRestriction: informed }).action, "close");
  const lib = src("lib/whatsapp-restriction.js");
  for (const ev of ["informed", "validated", "rejected", "resolved", "auto_ended"]) assert.match(lib, new RegExp(ev));
  assert.match(lib, /from\("whatsapp_restriction_events"\)\.insert/);
});

test("evidência técnica NÃO é aplicada por nenhum código hoje", () => {
  assert.doesNotMatch(src("lib/whatsapp-restriction.js"), /ORIGIN_TECHNICAL|evidencia_tecnica/);
  assert.doesNotMatch(src("app/api/webhooks/whatsapp-individual/route.js"), /restriction/i);
});

test("código de desconexão: normaliza, registra e não muda a lógica do serviço", () => {
  assert.equal(normalizeDisconnectCode(401), 401);
  assert.equal(normalizeDisconnectCode("428"), 428);
  assert.equal(normalizeDisconnectCode(undefined), null);
  assert.equal(normalizeDisconnectCode("abc"), null);
  assert.equal(normalizeDisconnectCode(5), null);
  const lib = src("lib/whatsapp-individual.js");
  assert.match(lib, /last_disconnect_code = disconnectCode/);
  assert.match(lib, /recordSessionEvent/);
  assert.match(src("app/api/webhooks/whatsapp-individual/route.js"), /statusCode: payload\.statusCode/);
  const sess = src("whatsapp-individual-service/src/sessions.js");
  assert.match(sess, /status: "reconnecting", error: errorMessage, statusCode/);
  assert.match(sess, /statusCode === DisconnectReason\.loggedOut/);
  assert.match(sess, /statusCode === DisconnectReason\.restartRequired/);
  assert.doesNotMatch(sess, /DisconnectReason\.forbidden|statusCode === 403/);
});

test("rotas novas: guard antes de tocar em dado; validar grava o admin REAL; rota do corretor não valida", () => {
  for (const r of ["team", "validate", "history"]) {
    const route = src(`app/api/admin/whatsapp-individual/restriction/${r}/route.js`);
    assert.match(route, /requireBrokerManagementApi\(request\)/, r);
  }
  const validate = src("app/api/admin/whatsapp-individual/restriction/validate/route.js");
  assert.match(validate, /validatedById: auth\.realProfile\?\.id \|\| auth\.profile\?\.id/);
  const own = src("app/api/admin/whatsapp-individual/restriction/route.js");
  assert.doesNotMatch(own, /validateRestriction|body\.(userId|targetUserId)/);
});

// Atualizado em 2026-10-02 (REGRA OFICIAL — dono): restrição VALIDADA libera Meta Diária manual e, com
// 100%, a Prospecção manual (lib/prospecting-eligibility*); o DISPARO (fila extra e roteamento) segue sem
// conhecer restrição e exigindo sessão conectada. Cobertura do novo gate: tests/daily-goal-window-credit.test.mjs.
test("PRO-11 intacto no disparo: fila extra/roteamento não conhecem restrição; admin geral segue isento", () => {
  for (const file of ["lib/prospecting-extra-dispatch.js", "lib/whatsapp-individual-routing.mjs"]) {
    assert.doesNotMatch(src(file), /restrict/i, file);
  }
  assert.equal(decideProspectingGate({ kind: "participate", role: "admin", isGeneralAdmin: true, sessionStatus: null }).allowed, true);
  assert.equal(decideProspectingGate({ kind: "participate", role: "broker", sessionStatus: "connected" }).allowed, true);
});

test("migration 20261003150000: aditiva (sem drop/delete/truncate), histórico append-only", () => {
  const sql = src("supabase/migrations/20261003150000_whatsapp_restriction_validation.sql");
  assert.doesNotMatch(sql, /\bdrop\s+(table|column|constraint|index)|\btruncate\b|\bdelete\s+from\b|update\s+public\./i);
  assert.match(sql, /add column if not exists validation_status text not null default 'informed'/);
  assert.match(sql, /whatsapp_restriction_events_append_only[\s\S]*before update or delete/);
  assert.match(sql, /last_disconnect_code integer/);
  for (const col of ["validation_origin", "validated_by", "validated_at", "validation_reason", "technical_code"]) assert.match(sql, new RegExp(col));
});
