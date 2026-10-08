// Custo de patrocinado por cliente e por corretor (pedido do dono, 2026-10-08). Dados 100% sintéticos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adIdFromOrigin, buildSponsoredCostIndex, sponsoredCostOfClient, summarizeSponsoredCost } from "../lib/sponsored-cost-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("ID do anúncio: ad_id do anúncio de WhatsApp ou utm_content numérico do site; nunca texto livre", () => {
  assert.equal(adIdFromOrigin({ ad_id: "52547581247353" }), "52547581247353");
  assert.equal(adIdFromOrigin({ utm_content: "52546657202753" }), "52546657202753");
  assert.equal(adIdFromOrigin({ ad_id: "abc", utm_content: "52546657202753" }), "52546657202753");
  assert.equal(adIdFromOrigin({ utm_content: "video-promo" }), "");
  assert.equal(adIdFromOrigin(null), "");
});

const index = buildSponsoredCostIndex({
  origins: [
    { client_id: "c1", source_metadata: { ad_id: "1000000001" }, created_at: "2026-10-01T10:00:00Z" },
    { client_id: "c2", source_metadata: { ad_id: "1000000001" }, created_at: "2026-10-02T10:00:00Z" },
    { client_id: "c3", source_metadata: { utm_content: "1000000002" }, created_at: "2026-10-03T10:00:00Z" },
    { client_id: "c4", source_metadata: { utm_medium: "cpc" }, created_at: "2026-10-04T10:00:00Z" }, // paga, sem anúncio identificado
    { client_id: "c5", source_metadata: { ad_id: "1000000003" }, created_at: "2026-10-05T10:00:00Z" }, // anúncio sem gasto
    // o mesmo cliente com duas origens: vale a mais antiga com anúncio
    { client_id: "c1", source_metadata: { ad_id: "1000000002" }, created_at: "2026-10-09T10:00:00Z" }
  ],
  insights: [
    { entity_id: "1000000001", spend: "40.00" },
    { entity_id: "1000000001", spend: 20 },
    { entity_id: "1000000002", spend: 33.33 }
  ]
});

test("custo do cliente = gasto do anúncio ÷ clientes do CRM que vieram dele", () => {
  assert.deepEqual(sponsoredCostOfClient(index, "c1"), { adId: "1000000001", amount: 30, adSpend: 60, adClients: 2 });
  assert.equal(sponsoredCostOfClient(index, "c2").amount, 30);
  assert.equal(sponsoredCostOfClient(index, "c3").amount, 33.33);
});

test("sem custo: sem anúncio identificado, anúncio sem gasto, ou cliente que não é patrocinado", () => {
  assert.equal(sponsoredCostOfClient(index, "c4"), null);
  assert.equal(sponsoredCostOfClient(index, "c5"), null);
  assert.equal(sponsoredCostOfClient(index, "nao-patrocinado"), null);
  assert.equal(sponsoredCostOfClient(null, "c1"), null);
});

test("resumo da visão (ex.: filtro por corretora): total, média e quantos ficaram sem custo", () => {
  const summary = summarizeSponsoredCost(index, ["c1", "c3", "c4", "c5", "c1", ""]);
  assert.deepEqual(summary, { clients: 4, withCost: 2, withoutCost: 2, total: 63.33, average: 31.67 });
  assert.deepEqual(summarizeSponsoredCost(index, []), { clients: 0, withCost: 0, withoutCost: 0, total: 0, average: 0 });
  // a soma dos clientes de um anúncio é exatamente o gasto dele
  assert.equal(summarizeSponsoredCost(index, ["c1", "c2"]).total, 60);
});

test("card: admin recebe o custo real, equipe o valor inflado (2026-10-08); resumo da aba só admin; a tela mostra o selo e o painel", () => {
  const query = read("lib/simulation-list-query.js");
  assert.ok(query.includes("const realCost = isGeneralAdminAuth(auth);"));
  assert.ok(query.includes("filters.statusGroup === SPONSORED_TAB_KEY && isGeneralAdminAuth(auth)"));
  assert.equal(query.split("applySponsoredCostSignal(auth, await applyChatContactSignal(supabase, items))").length - 1, 2, "as duas saídas da página");
  assert.ok(query.includes("...(sponsoredCost ? { sponsoredCost } : {})"));
  assert.ok(read("components/clients/ClientCard.jsx").includes("client.sponsoredCost ?"));
  assert.ok(read("components/clients/ClientWorkspace.jsx").includes('filters.statusGroup === "sponsored" && counters.sponsoredCost'));
  const server = read("lib/sponsored-cost.js");
  assert.ok(server.includes('.eq("entity_type", "ad")') && server.includes("TTL_MS = 60 * 1000"));
});

test("equipe vê só o valor do card, inflado em 50%; admin vê o real (regra do dono 2026-10-08)", async () => {
  const { teamSponsoredCost, TEAM_SPONSORED_COST_MULTIPLIER } = await import("../lib/sponsored-cost-core.mjs");
  assert.equal(TEAM_SPONSORED_COST_MULTIPLIER, 1.5);
  assert.deepEqual(teamSponsoredCost({ adId: "1", amount: 7.68, adSpend: 76.8, adClients: 10 }), { amount: 11.52 });
  assert.equal(teamSponsoredCost(null), null);
  const { readFileSync } = await import("node:fs");
  const q = readFileSync(new URL("../lib/simulation-list-query.js", import.meta.url), "utf8");
  assert.match(q, /item\.sponsoredCost = realCost \? cost : teamSponsoredCost\(cost\)/);
  assert.match(q, /filters\.statusGroup === SPONSORED_TAB_KEY && isGeneralAdminAuth\(auth\)/, "total da aba continua só do admin");
});
