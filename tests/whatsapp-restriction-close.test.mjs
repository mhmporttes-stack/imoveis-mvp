import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decideResolve, decideAdminClose, closeOriginFor, decideAutoEnd, resolveWhatsappBadge, AUTO_END_REASON, WHATSAPP_BADGES
} from "../lib/whatsapp-restriction-core.mjs";
import { decideProspectingGate } from "../lib/prospecting-eligibility-core.mjs";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const informed = { id: "r1", user_id: "b1", ended_at: null, validation_status: "informed" };
const validated = { ...informed, validation_status: "validated" };
const admin = { actorId: "a1", actorRole: "admin", isGeneralAdmin: true, targetUserId: "b1", managedUserIds: [] };
const manager = { actorId: "m1", actorRole: "manager", isGeneralAdmin: false, targetUserId: "b1", managedUserIds: ["m1", "b1"] };

test("informada: o próprio corretor encerra (manual)", () => {
  assert.deepEqual(decideResolve({ openRestriction: informed }), { action: "close", end_reason: "manual" });
});

test("validada: o corretor NÃO encerra sozinho (recusa), na lib vira 403 com mensagem clara", () => {
  assert.deepEqual(decideResolve({ openRestriction: validated }), { action: "refuse", reason: "validated_requires_management" });
  const lib = src("lib/whatsapp-restriction.js");
  assert.match(lib, /if \(decision\.action === "refuse"\) return \{ ok: false, status: 403, error: VALIDATED_BLOCK_MESSAGE \}/);
  assert.match(lib, /só o administrador ou a gestora da equipe encerram/);
  // corrida validada entre leitura e UPDATE: o UPDATE exige validation_status = informed
  assert.match(lib, /onlyValidation: "informed"/);
});

test("sem restrição aberta: resolver é idempotente (noop)", () => {
  assert.equal(decideResolve({ openRestriction: null }).action, "noop");
  assert.equal(decideResolve({ openRestriction: { ...validated, ended_at: "2026-10-02" } }).action, "noop");
});

test("admin encerra a validada de qualquer corretor", () => {
  assert.equal(closeOriginFor(admin), "admin");
  assert.deepEqual(decideAdminClose({ origin: "admin", openRestriction: validated }), { action: "close", origin: "admin", end_reason: "manual" });
});

test("gestora da equipe encerra; gestora de outra equipe, corretor e associado recebem 403", () => {
  assert.equal(closeOriginFor(manager), "gestora");
  assert.equal(decideAdminClose({ origin: "gestora", openRestriction: validated }).action, "close");
  assert.equal(closeOriginFor({ ...manager, managedUserIds: ["m2", "b9"] }), null);
  assert.equal(closeOriginFor({ actorId: "b1", actorRole: "broker", targetUserId: "b1" }), null);
  assert.equal(closeOriginFor({ actorId: "b2", actorRole: "broker", targetUserId: "b1", managedUserIds: ["b1"] }), null);
  assert.equal(closeOriginFor({ actorId: "s1", actorRole: "associate", targetUserId: "b1" }), null);
  assert.equal(closeOriginFor({ ...manager, actorId: "b1" }), null);
  assert.deepEqual(decideAdminClose({ origin: null, openRestriction: validated }), { action: "refuse", reason: "forbidden" });
  assert.match(src("lib/whatsapp-restriction.js"), /forbidden: \[403/);
});

test("encerrar é idempotente e só vale para validada (informada usa 'Não validar')", () => {
  assert.equal(decideAdminClose({ origin: "admin", openRestriction: null }).action, "noop");
  assert.equal(decideAdminClose({ origin: "admin", openRestriction: { ...validated, ended_at: "x" } }).action, "noop");
  assert.deepEqual(decideAdminClose({ origin: "admin", openRestriction: informed }), { action: "refuse", reason: "not_validated" });
});

test("encerramento automático ao conectar (inclusive validada) registra o motivo 'automatico_conectado'", () => {
  assert.deepEqual(decideAutoEnd({ sessionStatus: "connected", openRestriction: validated }), { action: "close", end_reason: "automatic_connected" });
  assert.equal(decideAutoEnd({ sessionStatus: "disconnected", openRestriction: validated }).action, "noop");
  assert.equal(AUTO_END_REASON, "automatico_conectado");
  assert.match(src("lib/whatsapp-restriction.js"), /eventType: "auto_ended", origin: "sistema", reason: AUTO_END_REASON/);
});

test("histórico append-only: encerramentos gravam evento (quem, papel/origem, motivo) e nunca apagam/alteram eventos", () => {
  const lib = src("lib/whatsapp-restriction.js");
  assert.match(lib, /eventType: "resolved", origin, reason: note, onlyValidation: "validated"/);
  assert.match(lib, /closedById: ?|closeRestriction\(open, decision\.end_reason, closedById/);
  assert.doesNotMatch(lib, /whatsapp_restriction_events"\)\s*\.(update|delete)/);
  assert.doesNotMatch(lib, /from\("whatsapp_restriction_events"\)\.(update|delete)/);
  const route = src("app/api/admin/whatsapp-individual/restriction/close/route.js");
  assert.match(route, /requireBrokerManagementApi/);
  assert.match(route, /auth\.realProfile\?\.id \|\| auth\.profile\?\.id/); // admin REAL, mesmo em "Alterar conta"
});

test("UI: validada esconde 'Restrição resolvida' do corretor e explica; gestão vê 'Encerrar restrição' e histórico", () => {
  const status = src("components/WhatsappIndividualStatus.jsx");
  assert.match(status, /validationStatus === "validated"\s*\? <p[^>]*>Restrição validada — só o administrador ou a gestora da equipe encerram/);
  const chip = src("components/WhatsappStateChip.jsx");
  assert.match(chip, /Encerrar restrição/);
  assert.match(chip, /Ver histórico/);
  assert.match(chip, /restriction\/history\?userId=/);
});

test("PRO-11 e T-25 não regridem: restrição (informada ou validada, encerrada ou não) nunca libera Prospecção", () => {
  for (const r of [informed, validated, null]) {
    assert.equal(decideProspectingGate({ kind: "participate", role: "broker", sessionStatus: "disconnected" }).allowed, false);
    assert.notEqual(resolveWhatsappBadge({ sessionStatus: "connected", openRestriction: r }), WHATSAPP_BADGES.validated);
  }
});
