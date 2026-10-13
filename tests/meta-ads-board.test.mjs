import test from "node:test";
import assert from "node:assert/strict";
import {
  adKindFor,
  aggregateAdInsights,
  computeBenchmarks,
  deriveMetrics,
  evaluateAd,
  periodRange,
  shortCampaignName,
  statusLabelFor,
  FALLBACK_BENCHMARKS
} from "../lib/meta-ads-board-core.mjs";

const conv = (value) => [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: String(value) }];

test("tipo do anúncio vem do objetivo (e o destino WhatsApp confirma)", () => {
  assert.equal(adKindFor({ objective: "OUTCOME_ENGAGEMENT" }), "whatsapp");
  assert.equal(adKindFor({ objective: "MESSAGES" }), "whatsapp");
  assert.equal(adKindFor({ objective: "OUTCOME_LEADS" }), "cadastro");
  assert.equal(adKindFor({ objective: "OUTCOME_TRAFFIC" }), "outro");
  assert.equal(adKindFor({ objective: "OUTCOME_TRAFFIC", destinationType: "WHATSAPP" }), "whatsapp");
});

test("períodos: hoje, 7 e 30 dias terminam hoje", () => {
  assert.deepEqual(periodRange("today", "2026-10-13"), { since: "2026-10-13", until: "2026-10-13", days: 1 });
  assert.deepEqual(periodRange("7d", "2026-10-13"), { since: "2026-10-07", until: "2026-10-13", days: 7 });
  assert.equal(periodRange("30d", "2026-10-13").since, "2026-09-14");
});

test("soma os dias do período e conta conversas do actions_raw", () => {
  const rows = [
    { entity_id: "1", date: "2026-10-06", spend: 50, impressions: 1000, clicks: 10, leads: 0, frequency: 1.1, actions_raw: conv(9) },
    { entity_id: "1", date: "2026-10-07", spend: 10, impressions: 1000, clicks: 20, leads: 0, frequency: 1.4, actions_raw: conv(2) },
    { entity_id: "1", date: "2026-10-08", spend: 5, impressions: 500, clicks: 5, leads: 1, frequency: 1.2, actions_raw: conv(1) }
  ];
  const totals = aggregateAdInsights(rows, { since: "2026-10-07", until: "2026-10-13" }).get("1");
  assert.equal(totals.spend, 15);
  assert.equal(totals.conversations, 3);
  assert.equal(totals.leads, 1);
  assert.equal(totals.maxFrequency, 1.4);
  assert.equal(totals.daysWithSpend, 2);
  const metrics = deriveMetrics("whatsapp", totals, { crmLeads: 2 });
  assert.equal(metrics.results, 3);
  assert.equal(metrics.costPerResult, 5);
  assert.equal(metrics.crmCostPerLead, 7.5);
  assert.equal(metrics.frequency, 1.4, "sem frequência do período usa a maior diária");
  assert.equal(deriveMetrics("whatsapp", totals, { frequency: 1.25 }).frequency, 1.25);
  assert.equal(deriveMetrics("outro", totals).costPerResult, null);
});

test("medianas da conta por tipo; poucos dados usa a reserva", () => {
  const kinds = new Map([["a", "cadastro"], ["b", "cadastro"], ["c", "cadastro"], ["w", "whatsapp"]]);
  const rows = [
    { entity_id: "a", date: "2026-10-01", spend: 20, impressions: 1000, clicks: 20, leads: 10 },
    { entity_id: "b", date: "2026-10-01", spend: 40, impressions: 1000, clicks: 20, leads: 10 },
    { entity_id: "c", date: "2026-10-01", spend: 90, impressions: 1000, clicks: 20, leads: 10 },
    { entity_id: "w", date: "2026-10-01", spend: 30, impressions: 1000, clicks: 20, leads: 0, actions_raw: conv(3) }
  ];
  const bench = computeBenchmarks(rows, kinds);
  assert.equal(bench.costPerResult.cadastro, 4);
  assert.equal(bench.costPerResult.whatsapp, FALLBACK_BENCHMARKS.costPerResult.whatsapp);
});

const bench = { costPerResult: { cadastro: 6.55, whatsapp: 5.54 }, ctrP25: 0.84, cpmMedian: 10.66 };
const base = { spend: 100, results: 20, costPerResult: 5, crmLeads: 0, frequency: 1.2, impressions: 5000, ctr: 2, cpm: 10, daysWithSpend: 5 };

test("bom: custo na média; vencedor com cliente no CRM", () => {
  assert.equal(evaluateAd({ kind: "cadastro", metrics: base }, bench).recommendations[0].title, "Manter");
  const winner = evaluateAd({ kind: "cadastro", metrics: { ...base, crmLeads: 4 } }, bench);
  assert.equal(winner.tone, "good");
  assert.equal(winner.recommendations[0].title, "Vencedor");
});

test("ruim: gastou sem resultado, custo alto ou frequência acima de 2", () => {
  assert.equal(evaluateAd({ kind: "cadastro", metrics: { ...base, spend: 20, results: 0, costPerResult: null } }, bench).tone, "bad");
  assert.equal(evaluateAd({ kind: "whatsapp", metrics: { ...base, costPerResult: 9 } }, bench).recommendations[0].title, "Custo alto");
  const tired = evaluateAd({ kind: "whatsapp", metrics: { ...base, frequency: 2.25, ctr: 0.38 } }, bench);
  assert.equal(tired.tone, "bad");
  assert.deepEqual(tired.recommendations.map((rec) => rec.title), ["Mesmas pessoas vendo demais", "Pouca gente clicando"]);
});

test("atenção: custo entre 1x e 1,5x a média, público cansando, CPM caro", () => {
  assert.equal(evaluateAd({ kind: "whatsapp", metrics: { ...base, costPerResult: 8.17 } }, bench).tone, "warn");
  assert.equal(evaluateAd({ kind: "cadastro", metrics: { ...base, frequency: 1.55 } }, bench).recommendations[0].title, "Público começando a cansar");
  assert.equal(evaluateAd({ kind: "cadastro", metrics: { ...base, cpm: 22 } }, bench).recommendations[0].title, "Aparecer está caro");
});

test("aprendendo: pouco gasto ou só 1 dia, sem alerta", () => {
  const learning = evaluateAd({ kind: "cadastro", metrics: { ...base, spend: 5, results: 0, costPerResult: null } }, bench);
  assert.equal(learning.tone, "neutral");
  assert.equal(learning.recommendations[0].title, "Ainda aprendendo");
  assert.equal(evaluateAd({ kind: "cadastro", metrics: { ...base, daysWithSpend: 1 } }, bench).tone, "neutral");
  assert.equal(evaluateAd({ kind: "cadastro", metrics: { ...base, spend: 0 } }, bench).recommendations[0].title, "Sem investimento no período");
});

test("rótulos curtos", () => {
  assert.equal(shortCampaignName("SITE | Marilia | PATROCINADO | Video (API 18-55)"), "Site · Video");
  assert.equal(shortCampaignName("WHATSAPP | Marilia | Ecovillage | Conversas (API 18-53)"), "WhatsApp · Conversas");
  assert.equal(statusLabelFor("CAMPAIGN_PAUSED"), "Campanha pausada");
});
