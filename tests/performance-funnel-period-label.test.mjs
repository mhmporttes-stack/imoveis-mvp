import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Pedido do dono (2026-10-11): período do funil ao lado do calendário.
test("funil mostra o período aplicado", () => {
  const ui = readFileSync(new URL("../components/PerformanceOverviewDashboard.jsx", import.meta.url), "utf8");
  assert.match(ui, /\{formatRangeLabel\(overview\?\.range\)\}/);
  assert.match(ui, /return `\$\{fmt\(start, crossYear\)\} a \$\{fmt\(end, crossYear\)\}`;/);
});
