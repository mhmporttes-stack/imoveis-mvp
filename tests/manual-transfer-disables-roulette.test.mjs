// Regra do dono (2026-10-07): depois de uma transferência MANUAL, a roleta (redistribuição automática) não toma o cliente.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("redistribuição automática pula cliente com transferência manual", () => {
  const lib = fs.readFileSync(path.resolve(import.meta.dirname, "../lib/crm-automations.js"), "utf8");
  assert.match(lib, /if \(manuallyTransferred\.has\(client\.id\)\) continue;/);
  assert.match(lib, /\.eq\("event_type", "responsible_transferred"\)\s*\n\s*\.in\("details->>transferType", \["manual", "roulette"\]\)/);
  assert.match(lib, /if \(row\.details\?\.transferType === "manual"\) result\.add\(row\.client_id\);/, "vale a ÚLTIMA troca (devolver para a roleta religa)");
});

test("Devolver para a roleta: só admin/gestor, próximo on-line sem quem perdeu, fila de espera se ninguém on-line (2026-10-09)", () => {

  const lib = fs.readFileSync(new URL("../lib/lead-distribution.js", import.meta.url), "utf8");
  assert.match(lib, /export async function returnClientToRoulette\(clientId, auth\)/);
  assert.match(lib, /assertGeneralAdminOrManager\(auth\);/);
  assert.match(lib, /assignRoundRobinLead\(\{ excludedBrokerId: fromUserId \}\)/);
  assert.match(lib, /pending_distribution_at: waiting \? now : null/);
  assert.match(lib, /transferType: "roulette"/);
  const route = fs.readFileSync(new URL("../app/api/simulation-registrations/[id]/roleta/route.js", import.meta.url), "utf8");
  assert.match(route, /await requireBrokerManagementApi\(request\);\n\s+if \(!auth\.ok\)/);
});
