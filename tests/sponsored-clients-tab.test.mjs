// Aba "Patrocinado" da lista de Clientes (pedido do dono, 2026-10-08): clientes que entraram por mídia paga.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("critério de patrocinado no banco = o mesmo de hasPaidMediaEvidence (lib/lead-origin.js)", () => {
  const query = read("lib/simulation-list-query.js");
  const filter = query.slice(query.indexOf("export const SPONSORED_ORIGIN_FILTER"), query.indexOf("// O cliente tem ao menos uma origem paga?"));
  for (const part of ["source_kind.in.(paid_link,whatsapp_ad)", "source_metadata->>paid_media.eq.true", "source_metadata->>ad_id.not.is.null", "source_metadata->>utm_medium.ilike.${medium}"]) assert.ok(filter.includes(part), part);
  for (const medium of ["cpc", "ppc", "paid", "paid_social", "paid_search", "anuncio", "anúncio"]) assert.ok(query.includes(`"${medium}"`), medium);
  assert.ok(!/ilike\.%/.test(filter), "sem busca por texto livre");
  // o critério de código e o do banco falam dos mesmos tipos de evidência
  const origin = read("lib/lead-origin.js");
  for (const piece of ["paid_link", "meta.ad_id", "meta.paid_media === true", "classifyPaidMedia(meta).paid"]) assert.ok(origin.includes(piece), piece);
});

test("aba Patrocinado: junção interna com client_origins (sem lista de ids na URL), fora 'Não contactar', mesmos filtros e escopo", () => {
  const query = read("lib/simulation-list-query.js");
  assert.ok(query.includes('export const SPONSORED_TAB_KEY = "sponsored";'));
  assert.ok(query.includes("`${columns}, client_origins!inner(id)`"));
  assert.ok(query.includes('query.or(SPONSORED_ORIGIN_FILTER, { foreignTable: "client_origins" }).neq("status", CLIENT_STATUS.DO_NOT_CONTACT)'));
  // a página aplica os filtros de sempre (escopo/permissão) ANTES do filtro da aba
  const page = query.slice(query.indexOf("function buildFiltered"));
  assert.ok(page.indexOf("applyScopedFilters(query") < page.indexOf("applySponsoredOriginFilter(query)"));
  assert.ok(query.includes("const sponsoredTab = filters.statusGroup === SPONSORED_TAB_KEY;"));
  // não vira grupo de status (os agregados do funil/Alexa não mudam)
  assert.ok(!read("lib/client-status.js").includes("sponsored"));
});

test("contador da aba usa a mesma base de filtros e não derruba a tela se falhar", () => {
  const query = read("lib/simulation-list-query.js");
  assert.ok(query.includes('const byGroup = { [SPONSORED_TAB_KEY]: sponsoredCount || 0 };'));
  assert.ok(query.includes("sponsoredQuery = applyScopedFilters(sponsoredQuery"));
  assert.ok(query.includes("if (sponsoredError) {"));
});

test("tela: botão 'Patrocinado' na faixa de etapas, com contador", () => {
  const screen = read("components/clients/ClientWorkspace.jsx");
  assert.ok(screen.includes('<StageTab label="Patrocinado" count={counters.byGroup?.sponsored || 0} active={filters.statusGroup === "sponsored"} onClick={() => select("sponsored")} />'));
});
