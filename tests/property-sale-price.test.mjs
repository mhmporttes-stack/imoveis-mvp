import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertPropertySalePrice, PROPERTY_PRICE_REQUIRED_MESSAGE, hasSalePrice } from "../lib/property-price-core.mjs";
import { buildDraftFromProperty, MarketplaceInputError } from "../lib/marketplace-core.mjs";

// Valor de venda obrigatório (dono, 2026-11-25). Dados fictícios.
test("imóvel comum sem preço, vazio, 0 ou R$ 0,00 falha", () => {
  for (const price of [undefined, "", "   ", "0", "R$ 0,00", "Consulte"]) {
    assert.throws(() => assertPropertySalePrice({ isDevelopment: false, price }), { message: PROPERTY_PRICE_REQUIRED_MESSAGE });
  }
});

test("imóvel comum com preço passa, mesmo com hidePrice", () => {
  assert.doesNotThrow(() => assertPropertySalePrice({ price: "R$ 389.000", hidePrice: true }));
  assert.equal(hasSalePrice("R$ 1.250.000,00"), true);
});

test("empreendimento sem preço passa (interpretação a confirmar)", () => {
  assert.doesNotThrow(() => assertPropertySalePrice({ isDevelopment: true, price: "" }));
});

test("rascunho do Marketplace recusa sem preço e leva o preço com preço", () => {
  assert.throws(() => buildDraftFromProperty({ id: "x", name: "Casa Teste Fictícia", price: "", hidePrice: true }), MarketplaceInputError);
  const draft = buildDraftFromProperty({ id: "x", name: "Casa Teste Fictícia", price: "R$ 389.000", hidePrice: true, photos: [] });
  assert.equal(draft.price, 389000);
});

test("hide_price continua zerando a camada pública; servidor valida ao salvar", () => {
  const pub = readFileSync(new URL("../lib/public-properties.js", import.meta.url), "utf8");
  assert.match(pub, /if \(publicSafe\.hidePrice\) return \{ \.\.\.publicSafe, price: "", installmentEntry: "" \};/);
  const props = readFileSync(new URL("../lib/properties.js", import.meta.url), "utf8");
  assert.match(props, /assertPropertySalePrice\(property\);/);
  assert.match(props, /assertPropertySalePrice\(\{ \.\.\.existing, \.\.\.property \}\)/);
});
