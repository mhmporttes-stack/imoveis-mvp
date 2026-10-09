// Pixel sem detecção automática de eventos (pedido do dono, 2026-10-09): os "leads" da Meta vinham inflados.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("autoConfig desligado ANTES do init do pixel", () => {
  const src = readFileSync(new URL("../components/MetaPixel.jsx", import.meta.url), "utf8");
  const off = src.indexOf("fbq('set', 'autoConfig', false, '${META_PIXEL_ID}');");
  const init = src.indexOf("fbq('init', '${META_PIXEL_ID}');");
  assert.ok(off > 0 && init > off);
});
