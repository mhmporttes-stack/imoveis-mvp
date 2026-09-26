import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_SITE_URL, resolveSiteBaseUrl } from "../lib/site-url.mjs";
import { fillPlaceholders, findUnresolvedPlaceholders } from "../lib/attendance-guide-core.mjs";
import { buildBrokerGenderVars } from "../lib/broker-gender.js";
import { buildSeedGuides } from "../lib/attendance-guide-seed.mjs";

test("link enviado ao cliente nunca usa o host técnico da Vercel", () => {
  assert.equal(resolveSiteBaseUrl("https://imoveis-mvp.vercel.app"), CANONICAL_SITE_URL);
  assert.equal(resolveSiteBaseUrl("imoveis-mvp.vercel.app/"), CANONICAL_SITE_URL);
  assert.equal(resolveSiteBaseUrl(""), CANONICAL_SITE_URL);
  assert.equal(resolveSiteBaseUrl(undefined), CANONICAL_SITE_URL);
  assert.equal(resolveSiteBaseUrl("https://www.matheusmachadoimoveis.com.br/"), "https://www.matheusmachadoimoveis.com.br");
  assert.equal(resolveSiteBaseUrl("matheusmachadoimoveis.com.br"), "https://matheusmachadoimoveis.com.br");
});

test("apresentação do guia concorda com o gênero de quem atende", () => {
  const text = "Aqui é [o_a] [Corretor], [cargo_corretor].";
  const female = fillPlaceholders(text, { brokerName: "jennyfer zorzato", brokerVars: buildBrokerGenderVars({ gender: "female", hasCreci: false }) });
  assert.equal(female, "Aqui é a Jennyfer, associada do corretor Matheus Machado.");
  const male = fillPlaceholders(text, { brokerName: "João", brokerVars: buildBrokerGenderVars({ gender: "male", hasCreci: false }) });
  assert.equal(male, "Aqui é o João, associado do corretor Matheus Machado.");
  const brokerFemale = fillPlaceholders(text, { brokerName: "Ana", brokerVars: buildBrokerGenderVars({ gender: "female", hasCreci: true }) });
  assert.equal(brokerFemale, "Aqui é a Ana, corretora.");
  // sem gênero cadastrado: nunca assume masculino
  const unknown = fillPlaceholders(text, { brokerName: "Sam", brokerVars: buildBrokerGenderVars({ hasCreci: false }) });
  assert.equal(unknown, "Aqui é o(a) Sam, associado(a) do corretor Matheus Machado.");
});

test("marcadores sem dado são apontados para o corretor preencher", () => {
  const filled = fillPlaceholders("Oi [Nome], [Link] [o_a]", { clientName: "", brokerName: "Ana" });
  assert.deepEqual(findUnresolvedPlaceholders(filled).sort(), ["[link]", "[nome]", "[o_a]"]);
  assert.deepEqual(findUnresolvedPlaceholders("Oi Maria!"), []);
});

test("modelos iniciais usam a concordância de gênero (nenhum 'o [Corretor], associado' fixo)", () => {
  const all = JSON.stringify(buildSeedGuides().map((guide) => guide.graph));
  assert.ok(!all.includes("associado do corretor Matheus Machado"));
  assert.ok(all.includes("[cargo_corretor]"));
});
