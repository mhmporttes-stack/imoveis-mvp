import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientDoNotContactPatch, contactDoNotContactPatch } from "../lib/do-not-contact-core.mjs";

// "Não contactar" bloqueia prospecção/automação mas mantém a atribuição
// (regra do dono, 2026-10-02).
const NOW = "2026-10-02T12:00:00.000Z";
const ASSIGNMENT_FIELDS = ["responsible_user_id", "assigned_user_id", "last_broker_id", "owner_user_id"];

test("patch do cliente marca Não contactar e nunca mexe no responsável", () => {
  const patch = clientDoNotContactPatch(NOW);
  assert.deepEqual(patch, { status: "do_not_contact", last_status_change_at: NOW });
  for (const field of ASSIGNMENT_FIELDS) assert.equal(field in patch, false, field);
});

test("patch do contato da fila bloqueia (sem data de retorno) e nunca mexe na atribuição", () => {
  const patch = contactDoNotContactPatch(NOW, "u1");
  assert.equal(patch.status, "do_not_contact");
  assert.equal(patch.available_after, null);
  assert.equal(patch.do_not_contact_by, "u1");
  for (const field of ASSIGNMENT_FIELDS) assert.equal(field in patch, false, field);
  assert.equal("do_not_contact_by" in contactDoNotContactPatch(NOW), false, "automático não inventa autor");
});

// Trava contra regressão: nenhum fluxo de "Não contactar" volta a zerar a
// atribuição escrevendo o update na mão.
test("fluxos de Não contactar usam a fonte única (sem zerar responsável)", () => {
  for (const file of ["lib/prospecting.js", "lib/prospecting-reply.js"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /responsible_user_id:\s*null,\s*status:\s*CLIENT_STATUS\.DO_NOT_CONTACT/, file);
    assert.doesNotMatch(source, /status:\s*"do_not_contact",\s*assigned_user_id:\s*null/, file);
    assert.match(source, /contactDoNotContactPatch\(/, file);
  }
});
