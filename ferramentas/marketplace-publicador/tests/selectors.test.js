import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../selectors.js";

const { MP } = globalThis;

test("comparação por texto ignora acento e caixa", () => {
  assert.equal(MP.matchesAny("PREÇO", ["Preco"], true), true);
  assert.equal(MP.matchesAny("Imóveis para venda ou aluguel  ", MP.categoryCard), true);
  assert.equal(MP.matchesAny("Casa geminada", ["Casa"], true), false);
  assert.equal(MP.matchesAny("", ["x"]), false);
});

test("checkpoint por URL ou por texto", () => {
  assert.equal(MP.isCheckpoint("https://www.facebook.com/checkpoint/123", ""), true);
  assert.equal(MP.isCheckpoint("https://www.facebook.com/marketplace/create/rental", "Você atingiu o limite de publicações"), true);
  assert.equal(MP.isCheckpoint("https://www.facebook.com/marketplace/create/rental", "Preço Descrição"), false);
});

test("link do anúncio limpo", () => {
  assert.equal(MP.cleanListingUrl("/marketplace/item/987654/?ref=x"), "https://www.facebook.com/marketplace/item/987654/");
  assert.equal(MP.cleanListingUrl("https://www.facebook.com/marketplace/you/selling"), "");
});

test("todos os campos e opções usados pelo content.js existem em selectors.js", () => {
  for (const key of ["offerType", "propertyType", "bedrooms", "bathrooms", "price", "location", "description", "area", "title"]) assert.ok(MP.fields[key]?.labels?.length, key);
  for (const key of ["sale", "rent"]) assert.ok(MP.fields.offerType.options[key].length);
  for (const key of ["house", "apartment", "townhouse", "land"]) assert.ok(MP.fields.propertyType.options[key].length);
  const content = readFileSync(new URL("../content.js", import.meta.url), "utf8");
  assert.doesNotMatch(content, /querySelector(All)?\(\s*["'`][^"'`]*\.(x|_)[a-z0-9]{4,}/, "content.js não pode usar classe CSS gerada do Facebook");
});

test("manifest MV3 com permissões mínimas", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
  assert.deepEqual(manifest.host_permissions.sort(), ["https://*.supabase.co/*", "https://www.facebook.com/*", "https://www.matheusmachadoimoveis.com.br/*"]);
  assert.doesNotMatch(manifest.name, /Matheus Machado Imóveis/);
});
