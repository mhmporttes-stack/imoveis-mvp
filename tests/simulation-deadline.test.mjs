// Prazo da simulação na roleta (regra do dono, 2026-10-08).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canReturnToRoulette, hasSimulationData } from "../lib/simulation-deadline-core.mjs";

const rr = { distribution_type: "round_robin" };

test("cliente com dados da simulação: só a simulação feita o segura — WhatsApp não", () => {
  const client = { ...rr, primary_monthly_income: 2500, last_whatsapp_contact_at: "2026-10-08T10:00:00Z" };
  assert.equal(hasSimulationData(client), true);
  assert.equal(canReturnToRoulette(client, { humanAttended: true }), true, "mandou WhatsApp e não simulou: volta");
  assert.equal(canReturnToRoulette(client, { hasSimulation: true }), false, "simulação gravada: fica");
});

test("cliente sem dados (atendimento rápido / WhatsApp): regra antiga — contato segura", () => {
  const client = { ...rr, primary_monthly_income: 0 };
  assert.equal(canReturnToRoulette(client), true);
  assert.equal(canReturnToRoulette({ ...client, last_whatsapp_contact_at: "2026-10-08T10:00:00Z" }), false);
  assert.equal(canReturnToRoulette(client, { humanAttended: true }), false);
});

test("fora da roleta nunca volta", () => {
  assert.equal(canReturnToRoulette({ distribution_type: "direct", primary_monthly_income: 3000 }), false);
});

test("motor de automações usa a regra do prazo da simulação", () => {
  const lib = readFileSync(new URL("../lib/crm-automations.js", import.meta.url), "utf8");
  assert.match(lib, /!canReturnToRoulette\(client, \{ hasSimulation: simulated\.has\(client\.id\), humanAttended: humanAttended\.has\(client\.id\) \}\)/);
  assert.match(lib, /primary_monthly_income/);
  assert.match(lib, /\.from\("simulations"\)\s*\.select\("\*"\)/);
});

test("cliente com dados: 'Em atendimento' sem simular não escapa; simulação vazia do cadastro do site não conta (2026-10-09)", async () => {
  const { rouletteRuleConditions, PRE_SIMULATION_RULE_SINCE } = await import("../lib/simulation-deadline-core.mjs");
  const rule = [{ type: "status_equals", value: "pending" }];
  const after = new Date(Date.parse(PRE_SIMULATION_RULE_SINCE) + 60000).toISOString();
  assert.deepEqual(rouletteRuleConditions(rule, { status: "in_service", primary_monthly_income: 4000, responsible_changed_at: "2026-10-09T02:42:08Z" }), rule, "não retroativo");
  assert.deepEqual(rouletteRuleConditions(rule, { status: "in_service", primary_monthly_income: 4000, responsible_changed_at: after }), []);
  assert.deepEqual(rouletteRuleConditions(rule, { status: "automated_service", primary_monthly_income: 4000, responsible_changed_at: after }), []);
  assert.deepEqual(rouletteRuleConditions(rule, { status: "completed", primary_monthly_income: 4000, responsible_changed_at: after }), rule, "simulação realizada: fica");
  assert.deepEqual(rouletteRuleConditions(rule, { status: "in_service", primary_monthly_income: 0 }), rule, "sem dados: regra como está");
  const lib = readFileSync(new URL("../lib/crm-automations.js", import.meta.url), "utf8");
  assert.match(lib, /if \(getSimulationListSummary\(rowToSimulation\(row\)\)\.completed\) result\.add\(row\.registration_id\);/);
  assert.match(lib, /rouletteRuleConditions\(rule\.conditions, client\)/);
});
