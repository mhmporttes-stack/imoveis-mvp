// Fonte única dos status negativos (2026-10-24): as 4 listas que antes eram cópias locais agora derivam de
// NEGATIVE_CLIENT_STATUS_VALUES (lib/client-status.js) e continuam com EXATAMENTE os mesmos status de antes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ALL_TAB_NEGATIVE_STATUSES, NEGATIVE_CLIENT_STATUS_VALUES } from "../lib/client-status.js";
import { ROULETTE_INELIGIBLE_STATUSES } from "../lib/client-distribution-core.mjs";
import { NEGATIVE_DECISION_STATUSES } from "../lib/cooled-clients-core.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const sorted = (list) => [...list].sort();

// Conteúdo das listas ANTES da troca (copiado das versões locais de 2026-10-23).
const BEFORE = {
  allTab: ["archived", "do_not_contact", "restriction", "rejected", "income_commitment"],
  roulette: ["archived", "do_not_contact", "income_commitment", "restriction", "rejected", "sale_completed", "sale_paid"],
  cooled: ["restriction", "rejected", "income_commitment", "archived", "do_not_contact"],
  outreach: ["archived", "do_not_contact", "income_commitment", "restriction", "rejected"]
};

test("fonte única = os 5 negativos, sem Blindagem", () => {
  assert.deepEqual(sorted(NEGATIVE_CLIENT_STATUS_VALUES), sorted(BEFORE.allTab));
  assert.equal(NEGATIVE_CLIENT_STATUS_VALUES.includes("shielding"), false);
  assert.ok(Object.isFrozen(NEGATIVE_CLIENT_STATUS_VALUES));
});

test("aba Todos: idêntica à de antes (mesma ordem)", () => {
  assert.deepEqual(ALL_TAB_NEGATIVE_STATUSES, BEFORE.allTab);
});

test("roleta: mesmos status de antes (negativos + venda concluída/paga, diferença proposital)", () => {
  assert.deepEqual(sorted(ROULETTE_INELIGIBLE_STATUSES), sorted(BEFORE.roulette));
  assert.equal(ROULETTE_INELIGIBLE_STATUSES.length, BEFORE.roulette.length);
});

test("esfriados: mesmos status de antes", () => {
  assert.deepEqual(sorted(NEGATIVE_DECISION_STATUSES), sorted(BEFORE.cooled));
});

test("automações (server-only): a trava usa a fonte única, sem lista local", () => {
  const source = read("lib/crm-automations.js");
  assert.match(source, /const OUTREACH_NEGATIVE_STATUSES = new Set\(NEGATIVE_CLIENT_STATUS_VALUES\)/);
  assert.deepEqual(sorted(NEGATIVE_CLIENT_STATUS_VALUES), sorted(BEFORE.outreach));
});

test("nenhuma das 4 volta a ter lista literal de negativos", () => {
  for (const [file, name] of [
    ["lib/client-status.js", "ALL_TAB_NEGATIVE_STATUSES"],
    ["lib/client-distribution-core.mjs", "ROULETTE_INELIGIBLE_STATUSES"],
    ["lib/cooled-clients-core.mjs", "NEGATIVE_DECISION_STATUSES"],
    ["lib/crm-automations.js", "OUTREACH_NEGATIVE_STATUSES"]
  ]) {
    const source = read(file);
    const start = source.indexOf(`const ${name} =`);
    const declaration = source.slice(start, source.indexOf(";", start));
    assert.match(declaration, /NEGATIVE_CLIENT_STATUS_VALUES/, `${file}: ${name}`);
    assert.doesNotMatch(declaration, /CLIENT_STATUS\.(ARCHIVED|DO_NOT_CONTACT|RESTRICTION|REJECTED|INCOME_COMMITMENT)/, `${file}: ${name}`);
  }
});
