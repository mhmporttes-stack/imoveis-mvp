import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Publicar "sem valores" (dono, 2026-10-15).
test("hide_price vai e volta pelo mapper (padrão: mostra o valor)", () => {
  const source = readFileSync(new URL("../lib/property-mapper.js", import.meta.url), "utf8");
  assert.match(source, /hidePrice: booleanValue\(row\.hide_price, false\)/);
  assert.match(source, /hide_price: property\.hidePrice === true/);
});

test("site público some com preço e entrada quando publicado sem valores", () => {
  const source = readFileSync(new URL("../lib/public-properties.js", import.meta.url), "utf8");
  assert.match(source, /if \(publicSafe\.hidePrice\) return \{ \.\.\.publicSafe, price: "", installmentEntry: "" \};/);
  assert.match(source, /hide_price, display_order/);
});
