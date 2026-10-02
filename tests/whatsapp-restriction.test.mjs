import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canChangeRestriction, canViewRestriction, decideReport, decideResolve, decideAutoEnd,
  resolveWhatsappBadge, RESTRICTION_END_MANUAL, RESTRICTION_END_AUTOMATIC, WHATSAPP_BADGES
} from "../lib/whatsapp-restriction-core.mjs";
import { decideProspectingGate, isSessionOperational } from "../lib/prospecting-eligibility-core.mjs";

const open = { id: "r1", user_id: "b1", reported_at: "2026-10-03T10:00:00Z", ended_at: null };
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("marcar exige confirmação explícita", () => {
  assert.equal(decideReport({ confirmed: false, sessionStatus: "disconnected" }).action, "reject");
  assert.equal(decideReport({ confirmed: "true", sessionStatus: "disconnected" }).action, "reject");
  assert.equal(decideReport({ confirmed: true, sessionStatus: "disconnected" }).action, "create");
  assert.equal(decideReport({ confirmed: true, sessionStatus: null }).action, "create");
});

test("não faz sentido marcar com a sessão conectada", () => {
  assert.deepEqual(decideReport({ confirmed: true, sessionStatus: "connected" }), { action: "reject", reason: "already_connected" });
});

test("idempotência: marcar de novo com restrição aberta não duplica; resolver sem restrição é noop", () => {
  assert.equal(decideReport({ confirmed: true, sessionStatus: "disconnected", openRestriction: open }).action, "noop");
  assert.equal(decideResolve({ openRestriction: null }).action, "noop");
  assert.equal(decideResolve({ openRestriction: { ...open, ended_at: "2026-10-03T11:00:00Z" } }).action, "noop");
  assert.equal(decideAutoEnd({ sessionStatus: "connected", openRestriction: null }).action, "noop");
});

test("resolver manual encerra com motivo manual", () => {
  assert.deepEqual(decideResolve({ openRestriction: open }), { action: "close", end_reason: RESTRICTION_END_MANUAL });
});

test("voltou a connected encerra sozinha (motivo automático); outros status não encerram", () => {
  assert.deepEqual(decideAutoEnd({ sessionStatus: "connected", openRestriction: open }), { action: "close", end_reason: RESTRICTION_END_AUTOMATIC });
  for (const s of ["disconnected", "reconnecting", "qr_required", "error", null]) {
    assert.equal(decideAutoEnd({ sessionStatus: s, openRestriction: open }).action, "noop", String(s));
  }
});

test("escopo de alteração: só o próprio usuário (gestor e admin só visualizam)", () => {
  assert.equal(canChangeRestriction({ actorId: "b1", targetUserId: "b1" }), true);
  assert.equal(canChangeRestriction({ actorId: "b2", targetUserId: "b1" }), false);
  assert.equal(canChangeRestriction({ actorId: "m1", targetUserId: "b1" }), false);
  assert.equal(canChangeRestriction({ actorId: "", targetUserId: "b1" }), false);
});

test("escopo de visualização: próprio, gestor da equipe, admin geral; outra equipe e corretor alheio não", () => {
  assert.equal(canViewRestriction({ viewerId: "b1", targetUserId: "b1" }), true);
  assert.equal(canViewRestriction({ viewerId: "b2", viewerRole: "broker", targetUserId: "b1" }), false);
  assert.equal(canViewRestriction({ viewerId: "m1", viewerRole: "manager", targetUserId: "b1", managedUserIds: ["m1", "b1"] }), true);
  assert.equal(canViewRestriction({ viewerId: "m2", viewerRole: "manager", targetUserId: "b1", managedUserIds: ["m2", "b9"] }), false);
  assert.equal(canViewRestriction({ viewerId: "a1", viewerRole: "admin", isGeneralAdmin: true, targetUserId: "b1" }), true);
});

test("selos: Aguardando × Restringido × Desconectado × Conectado são distintos, com ícone e texto", () => {
  assert.equal(resolveWhatsappBadge({ sessionStatus: "nunca_conectou" }), WHATSAPP_BADGES.waiting);
  assert.equal(resolveWhatsappBadge({ sessionStatus: null }), WHATSAPP_BADGES.waiting);
  assert.equal(resolveWhatsappBadge({ sessionStatus: "disconnected" }), WHATSAPP_BADGES.disconnected);
  assert.equal(resolveWhatsappBadge({ sessionStatus: "nunca_conectou", openRestriction: open }), WHATSAPP_BADGES.informed);
  assert.equal(resolveWhatsappBadge({ sessionStatus: "disconnected", openRestriction: open }), WHATSAPP_BADGES.informed);
  assert.equal(resolveWhatsappBadge({ sessionStatus: "connected", openRestriction: open }), WHATSAPP_BADGES.connected);
  const labels = new Set(Object.values(WHATSAPP_BADGES).map((b) => b.label));
  const icons = new Set(Object.values(WHATSAPP_BADGES).map((b) => b.icon));
  assert.equal(labels.size, 5);
  assert.equal(icons.size, 5);
});

test("REGRA CRÍTICA: restringido sem conexão continua BLOQUEADO na Prospecção; admin geral segue isento", () => {
  // O portão só olha o status da sessão — a restrição não entra na decisão.
  for (const kind of ["participate", "access"]) {
    const gate = decideProspectingGate({ kind, role: "broker", sessionStatus: "disconnected" });
    assert.equal(gate.allowed, false, kind);
    assert.equal(isSessionOperational("disconnected"), false);
  }
  assert.equal(decideProspectingGate({ kind: "participate", role: "broker", sessionStatus: "connected" }).allowed, true);
  assert.equal(decideProspectingGate({ kind: "participate", role: "admin", isGeneralAdmin: true, sessionStatus: null }).allowed, true);
  // Elegibilidade e o gate de servidor não conhecem a restrição.
  for (const file of ["lib/prospecting-eligibility-core.mjs", "lib/prospecting-eligibility.js", "lib/prospecting-extra-dispatch.js", "lib/whatsapp-individual-routing.mjs"]) {
    assert.doesNotMatch(src(file), /restrict/i, file);
  }
  // A automação só dispara com sessão connected; restrição não aparece no despacho.
  const auto = src("lib/daily-goal-auto.js");
  assert.match(auto, /pickSendChannel\(\{ assignedUserId: brokerId, individualSessionStatus: sessionStatus \}\) !== "individual"/);
});

test("rota: guard antes de tocar em dado e só atua sobre o próprio usuário logado", () => {
  const route = src("app/api/admin/whatsapp-individual/restriction/route.js");
  assert.match(route, /requireAdminApi/);
  assert.doesNotMatch(route, /body\.(userId|targetUserId|brokerId)/);
  assert.match(route, /actorId: who\.userId, targetUserId: who\.userId/);
});

test("migration aditiva: só cria, nunca apaga/altera existente; nome com 14 dígitos", () => {
  const sql = src("supabase/migrations/20261003140000_whatsapp_restrictions.sql");
  assert.doesNotMatch(sql, /\bdrop\b|\btruncate\b|(?<!on )\bdelete\b|alter table public\.(?!whatsapp_restrictions)/i);
  assert.match(sql, /create table if not exists public\.whatsapp_restrictions/);
  assert.match(sql, /create unique index if not exists whatsapp_restrictions_one_open_per_user/);
});
