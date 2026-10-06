// Aviso de cliente novo: um por cadastro/recadastro, nunca por mudança de etapa (regra do dono 2026-10-06).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isNewClientEventFresh, isNewClientNotificationRule, legacyEventKeyPrefix, newClientAnchor, newClientEventKey } from "../lib/crm-automation-new-client.mjs";

const created = "2026-10-06T14:52:32.603Z";

test("chave do aviso NÃO muda com a etapa: mesmo cadastro em qualquer status = mesma chave (um aviso só)", () => {
  const keys = ["automated_service", "in_service", "documentation", "completed"].map((status) =>
    newClientEventKey("client_form_submitted", newClientAnchor("client_form_submitted", { created_at: created, status })));
  assert.equal(new Set(keys).size, 1);
  assert.equal(keys[0], `client_form_submitted:${created}`);
});

test("recadastro (formulário preenchido de novo) gera um aviso novo; adicionado pelo corretor usa o cadastro", () => {
  const again = "2026-10-08T10:00:00.000Z";
  assert.equal(newClientAnchor("client_form_submitted", { created_at: created, last_form_submitted_at: again }).toISOString(), again);
  assert.equal(newClientAnchor("client_form_submitted", { created_at: created, last_form_submitted_at: "2026-10-01T00:00:00.000Z" }).toISOString(), created);
  assert.equal(newClientAnchor("client_added_by_broker", { created_at: created, last_form_submitted_at: again }).toISOString(), created);
});

test("sem avalanche: só cadastro/recadastro recente; chave antiga (com etapa) do mesmo cadastro bloqueia", () => {
  const anchor = new Date(created);
  assert.equal(isNewClientEventFresh(anchor, anchor.getTime() + 3600e3), true);
  assert.equal(isNewClientEventFresh(anchor, anchor.getTime() + 49 * 3600e3), false);
  assert.equal(isNewClientEventFresh(null), false);
  assert.ok(`client_form_submitted:${created}:in_service`.startsWith(legacyEventKeyPrefix("client_form_submitted", anchor)));
});

test("só a regra de AVISO muda; a redistribuição pela roleta (mesmo gatilho) segue como antes", () => {
  assert.equal(isNewClientNotificationRule({ triggerType: "client_form_submitted" }), true);
  assert.equal(isNewClientNotificationRule({ triggerType: "client_added_by_broker" }), true);
  assert.equal(isNewClientNotificationRule({ triggerType: "client_form_submitted", returnsToRoundRobin: true }), false);
  assert.equal(isNewClientNotificationRule({ triggerType: "status_changed" }), false);
  const lib = fs.readFileSync(path.resolve(import.meta.dirname, "../lib/crm-automations.js"), "utf8");
  assert.match(lib, /newClientRule \? newClientEventKey\(rule\.triggerType, anchor\)/);
  assert.match(lib, /!isNewClientEventFresh\(anchor\) \|\| await hasLegacyNewClientExecution\(rule, client, anchor\)/);
  assert.match(lib, /last_form_submitted_at/);
});
