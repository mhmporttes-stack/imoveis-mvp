// Regra do dono (2026-10-07): depois de uma transferência MANUAL, a roleta (redistribuição automática) não toma o cliente.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("redistribuição automática pula cliente com transferência manual", () => {
  const lib = fs.readFileSync(path.resolve(import.meta.dirname, "../lib/crm-automations.js"), "utf8");
  assert.match(lib, /if \(manuallyTransferred\.has\(client\.id\)\) continue;/);
  assert.match(lib, /\.eq\("event_type", "responsible_transferred"\)\s*\n\s*\.eq\("details->>transferType", "manual"\)/);
});
