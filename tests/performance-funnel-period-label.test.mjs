import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Pedido do dono (2026-10-11): período do funil ao lado do calendário.
test("funil mostra o período aplicado", () => {
  const ui = readFileSync(new URL("../components/PerformanceOverviewDashboard.jsx", import.meta.url), "utf8");
  assert.match(ui, /\{formatRangeLabel\(overview\?\.range\)\}/);
  assert.match(ui, /return `\$\{fmt\(start, crossYear\)\} a \$\{fmt\(end, crossYear\)\}`;/);
});

// Pedido do dono (2026-10-16): segunda coluna "Desde <etapa base>", base lembrada no aparelho,
// gargalo continua etapa a etapa e aviso de período curto (< 30 dias).
test("funil tem coluna desde a base, sem mexer no gargalo", () => {
  const ui = readFileSync(new URL("../components/PerformanceOverviewDashboard.jsx", import.meta.url), "utf8");
  assert.match(ui, /const sinceRatio = index > baseIndex && baseValue > 0 \? value \/ baseValue : null;/);
  assert.match(ui, /stage\.conversion < worst\.conversion/);
  assert.match(ui, /FUNNEL_SHORT_PERIOD_DAYS = 30/);
  assert.match(ui, /try \{\s*window\.localStorage\.setItem\(FUNNEL_BASE_STORAGE_KEY, key\);/);
  assert.match(ui, /Período curto: clientes recentes ainda não tiveram tempo de chegar às últimas etapas\./);
});
