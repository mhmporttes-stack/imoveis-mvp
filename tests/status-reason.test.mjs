import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STATUS_REASON_MIN_LENGTH,
  assertStatusReason,
  isValidStatusReason,
  normalizeStatusReason,
  statusRequiresReason
} from "../lib/status-reason-core.mjs";

// FUN-14 (dono, 2026-10-14): arquivar / Não contactar por uma pessoa exige motivo escrito.

test("só Arquivado e Não contactar exigem motivo", () => {
  assert.equal(statusRequiresReason("archived"), true);
  assert.equal(statusRequiresReason("do_not_contact"), true);
  for (const status of ["in_service", "pending", "sale_completed", "", null, undefined]) assert.equal(statusRequiresReason(status), false);
});

test("motivo vazio, curto ou só pontuação é recusado", () => {
  for (const text of ["", "   ", "ok", ".....", "!!! ???", "a b c"]) assert.equal(isValidStatusReason(text), false, text);
  assert.throws(() => assertStatusReason("  "), /Escreva o motivo/);
});

test("motivo de verdade passa e é normalizado", () => {
  assert.equal(isValidStatusReason("Comprou com outra imobiliária"), true);
  assert.equal(assertStatusReason("  Sem   renda \n agora "), "Sem renda agora");
  assert.equal("x".repeat(STATUS_REASON_MIN_LENGTH).length, STATUS_REASON_MIN_LENGTH);
  assert.equal(isValidStatusReason("x".repeat(STATUS_REASON_MIN_LENGTH)), true);
  assert.equal(normalizeStatusReason("y".repeat(500)).length, 300);
});

test("servidor trava antes de gravar: updateSimulationRegistration valida o motivo dentro do bloco de quem é pessoa", () => {
  const source = readFileSync(new URL("../lib/simulation-registrations.js", import.meta.url), "utf8");
  const lockIndex = source.indexOf("statusReason = assertStatusReason(updates.statusReason)");
  const writeIndex = source.indexOf('.from("simulation_registrations")\n    .update(record)');
  assert.ok(lockIndex > 0, "trava presente");
  assert.ok(writeIndex > lockIndex, "trava antes do UPDATE");
  assert.match(source, /eventType: "status_reason"/);
});

test("Não contactar pela Prospecção exige texto em qualquer opção (não só em Outro)", () => {
  const source = readFileSync(new URL("../lib/daily-goal-wallet.js", import.meta.url), "utf8");
  assert.match(source, /reasonText: assertStatusReason\(reasonText\)/);
  const normalizeAt = source.indexOf("const normalized = normalizeDoNotContactReason(reasonKey, reasonText);");
  const abuseAt = source.indexOf("await checkDoNotContactAbuse(executedBy);", source.indexOf("export async function recordDoNotContactAudit"));
  assert.ok(normalizeAt > 0 && abuseAt > normalizeAt, "valida o motivo antes da trava anti-abuso");
});

test("telas abrem a janela de motivo em vez de gravar direto", () => {
  const hook = readFileSync(new URL("../components/clients/useClientList.js", import.meta.url), "utf8");
  assert.match(hook, /statusRequiresReason\(nextStatus\)/);
  const chat = readFileSync(new URL("../components/WhatsappChat.jsx", import.meta.url), "utf8");
  assert.match(chat, /JSON\.stringify\(\{ status: "archived", statusReason \}\)/);
  assert.doesNotMatch(chat, /window\.confirm\(`Arquivar/);
  const replies = readFileSync(new URL("../components/clients/ProspectingRepliesPanel.jsx", import.meta.url), "utf8");
  assert.match(replies, /reasonText: reasonText\.trim\(\)/);
});
