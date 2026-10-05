// Trava "Simulação realizada" (2026-10-05): o status só vale com simulação real
// (financiamento ou subsídio > 0). Dados 100% sintéticos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SIMULATION_REQUIRED_MESSAGE, hasRealSimulationValues, isSimulationDoneOptionBlocked, statusRequiresRealSimulation } from "../lib/simulation-status-lock-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("só 'completed' exige simulação real", () => {
  assert.equal(statusRequiresRealSimulation("completed"), true);
  for (const status of ["pending", "simulation_sent", "in_service", "documentation", "archived", "do_not_contact"]) assert.equal(statusRequiresRealSimulation(status), false);
});

test("simulação vazia/autosave (tudo zero) ou só parcelas NÃO é simulação real", () => {
  assert.equal(hasRealSimulationValues([]), false);
  assert.equal(hasRealSimulationValues(null), false);
  assert.equal(hasRealSimulationValues([{ financing_value: "0.00", subsidy_value: "0.00", first_installment: "900.00" }]), false);
  assert.equal(hasRealSimulationValues([{ financing_value: null, subsidy_value: undefined }]), false);
});

test("financiamento OU subsídio maior que zero é simulação real (valores em texto do banco)", () => {
  assert.equal(hasRealSimulationValues([{ financing_value: "150000.00", subsidy_value: "0.00" }]), true);
  assert.equal(hasRealSimulationValues([{ financing_value: "0.00", subsidy_value: "20000.00" }]), true);
  assert.equal(hasRealSimulationValues([{ financing_value: 0 }, { financing_value: 1 }]), true);
});

test("tela: opção bloqueada sem simulação real, exceto quem já está nesse status", () => {
  assert.equal(isSimulationDoneOptionBlocked({ currentStatus: "pending", hasRealSimulation: false }), true);
  assert.equal(isSimulationDoneOptionBlocked({ currentStatus: "pending", hasRealSimulation: true }), false);
  assert.equal(isSimulationDoneOptionBlocked({ currentStatus: "completed", hasRealSimulation: false }), false);
  assert.match(SIMULATION_REQUIRED_MESSAGE, /simulação/i);
});

test("servidor: a trava está em updateSimulationRegistration, antes de gravar o status", () => {
  const code = read("lib/simulation-registrations.js");
  const start = code.indexOf("export async function updateSimulationRegistration(");
  const body = code.slice(start, code.indexOf("export async function", start + 10));
  const guard = body.indexOf("statusRequiresRealSimulation(nextStatus)");
  assert.ok(guard > 0, "trava ausente");
  assert.ok(guard < body.indexOf("record.status = nextStatus"), "trava depois de gravar o status");
  assert.match(body, /assertRealSimulationExists\(supabase, id\)/);
  assert.match(code, /\.or\("financing_value\.gt\.0,subsidy_value\.gt\.0"\)/);
  assert.match(code, /error instanceof SimulationRequiredError\) return current/, "marcação automática não pode estourar erro");
});

test("telas: card e ficha passam a existência de simulação real para as opções", () => {
  assert.match(read("components/clients/ClientCard.jsx"), /<StatusOptions current=\{client\.status\} hasRealSimulation=/);
  assert.match(read("components/clients/ClientSheet.jsx"), /<StatusOptions current=\{client\.status\} hasRealSimulation=/);
  assert.match(read("components/clients/StatusOptions.jsx"), /isSimulationDoneOptionBlocked/);
});
