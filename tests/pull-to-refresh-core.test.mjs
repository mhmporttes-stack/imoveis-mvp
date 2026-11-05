import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyMove, isPullBlocked, phaseFor, pullDistance, pullLabel, PULL_HOLD_MS, PULL_MAX_PX, PULL_THRESHOLD_PX } from "../components/pull-to-refresh-core.mjs";

// "Puxar para atualizar" (dono, 2026-11-04): arrastar para baixo, segurar um instante e soltar.
test("distância: metade do dedo, nunca negativa nem acima do máximo", () => {
  assert.equal(pullDistance(-20), 0);
  assert.equal(pullDistance(0), 0);
  assert.equal(pullDistance(100), 50);
  assert.equal(pullDistance(1000), PULL_MAX_PX);
  assert.equal(pullDistance("x"), 0);
});

test("1º movimento: para cima ou mais lateral = ignora; curto = espera; para baixo = puxada", () => {
  assert.equal(classifyMove({ dx: 0, dy: -10 }), "ignore");
  assert.equal(classifyMove({ dx: 40, dy: 12 }), "ignore");
  assert.equal(classifyMove({ dx: 2, dy: 4 }), "wait");
  assert.equal(classifyMove({ dx: 3, dy: 30 }), "pull");
});

test("fases: curto = puxando; passou da distância = segure; segurou o tempo = pode soltar", () => {
  assert.equal(phaseFor({ distance: 0 }), "idle");
  assert.equal(phaseFor({ distance: 20 }), "pulling");
  assert.equal(phaseFor({ distance: PULL_THRESHOLD_PX, heldMs: 0 }), "ready");
  assert.equal(phaseFor({ distance: PULL_THRESHOLD_PX + 10, heldMs: PULL_HOLD_MS - 1 }), "ready");
  assert.equal(phaseFor({ distance: PULL_THRESHOLD_PX + 10, heldMs: PULL_HOLD_MS }), "armed");
  assert.equal(pullLabel("armed"), "Solte para atualizar");
  assert.equal(pullLabel("refreshing"), "Atualizando…");
});

test("bloqueios: digitando, camada aberta, lista interna rolada ou página fora do topo", () => {
  assert.equal(isPullBlocked({}), false);
  for (const key of ["insideField", "insideDialog", "overlayOpen", "scrollerOffTop", "pageOffTop"]) assert.equal(isPullBlocked({ [key]: true }), true, key);
});

test("painel: montado no layout do admin e só recarrega depois de armado", () => {
  const layout = readFileSync(new URL("../app/admin/layout.jsx", import.meta.url), "utf8");
  assert.match(layout, /auth\.ok \? <PullToRefresh \/> : null/);
  const component = readFileSync(new URL("../components/PullToRefresh.jsx", import.meta.url), "utf8");
  assert.match(component, /const armed = s\.pulling && uiRef\.current\.phase === "armed"/);
  assert.match(component, /window\.location\.reload\(\)/);
});
