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
  assert.match(lib, /\.from\("simulations"\)\s*\.select\("registration_id"\)/);
});
