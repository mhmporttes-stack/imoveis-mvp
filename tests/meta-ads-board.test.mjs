import test from "node:test";
import assert from "node:assert/strict";
import {
  adKindFor,
  aggregateAdInsights,
  computeBenchmarks,
  deriveMetrics,
  judgeAd,
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

test("referências da conta: média ponderada; poucos dados usa a reserva", () => {
  const kinds = new Map([["a", "cadastro"], ["b", "cadastro"], ["w", "whatsapp"]]);
  const rows = [
    { entity_id: "a", date: "2026-10-01", spend: 20, impressions: 1000, clicks: 20, leads: 10 },
    { entity_id: "b", date: "2026-10-01", spend: 100, impressions: 1000, clicks: 20, leads: 10 },
    { entity_id: "w", date: "2026-10-01", spend: 30, impressions: 1000, clicks: 20, leads: 0, actions_raw: conv(3) }
  ];
  const bench = computeBenchmarks(rows, kinds, new Map([["a", 6], ["b", 4]]));
  assert.equal(bench.meta.cadastro, 6, "120 / 20 leads");
  assert.equal(bench.crm.cadastro, 12, "120 / 10 clientes");
  assert.equal(bench.meta.whatsapp, FALLBACK_BENCHMARKS.meta.whatsapp);
});

const bench = { crm: { cadastro: 12.13, whatsapp: 5.73 }, meta: { cadastro: 3.06, whatsapp: 3.47 }, ctrP25: 0.84, cpmAvg: 10.66 };
const TODAY = "2026-10-13";
function days(n, perDay, startOffset = 0) {
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.UTC(2026, 9, 13 - startOffset - i)).toISOString().slice(0, 10);
    return { entity_id: "x", date, ...perDay(i) };
  });
}

test("carrossel recente (2 dias): em aprendizado, sem julgar frequência nem CTR", () => {
  const rows = days(2, () => ({ spend: 5.54, impressions: 525, clicks: 2, leads: 0, actions_raw: conv(1) }));
  const result = judgeAd({ status: "ACTIVE", kind: "whatsapp", rows, crmDates: [], freq7: 2.25, today: TODAY }, bench);
  assert.equal(result.tone, "neutral");
  assert.equal(result.label, "Aprendendo");
  assert.match(result.recommendations[0].title, /Em aprendizado/);
});

test("vídeo aluguel (custo/cliente na média, Meta piorando): Manter com nota", () => {
  const rows = days(7, (i) => (i < 3 ? { spend: 32.94, impressions: 2400, clicks: 37, leads: 3 } : { spend: 19.5, impressions: 2500, clicks: 46, leads: 4.5 }));
  // CRM melhorando: 7 clientes nos últimos 3 dias completos, 4 nos 4 anteriores, 2 hoje.
  const crmDates = ["2026-10-12", "2026-10-12", "2026-10-12", "2026-10-11", "2026-10-11", "2026-10-10", "2026-10-10", "2026-10-09", "2026-10-08", "2026-10-07", "2026-10-07", "2026-10-13", "2026-10-13"];
  const result = judgeAd({ status: "ACTIVE", kind: "cadastro", rows, crmDates, freq7: 1.94, today: TODAY }, bench);
  assert.equal(result.tone, "good");
  assert.equal(result.recommendations[0].title, "Manter");
  assert.equal(result.recommendations[1]?.title, "A Meta mostra queda, mas o CRM segue bem");
});

test("pausado nunca é julgado; reprovado é ruim", () => {
  assert.equal(judgeAd({ status: "CAMPAIGN_PAUSED", kind: "whatsapp", rows: [], today: TODAY }, bench).recommendations[0].title, "Pausado");
  assert.equal(judgeAd({ status: "DISAPPROVED", kind: "whatsapp", rows: [], today: TODAY }, bench).tone, "bad");
});

test("frequência alta sozinha não muda a cor; com custo ruim vira alerta", () => {
  const rows = days(10, () => ({ spend: 10, impressions: 1000, clicks: 20, leads: 0, actions_raw: conv(3) }));
  const twoClients = ["2026-10-12", "2026-10-10"];
  const ok = judgeAd({ status: "ACTIVE", kind: "whatsapp", rows, crmDates: twoClients, freq7: 3.6, today: TODAY }, bench);
  assert.equal(ok.tone, "good");
  assert.equal(ok.recommendations[1]?.title, "Frequência alta");
  const expensive = days(10, () => ({ spend: 10, impressions: 1000, clicks: 20, leads: 0, actions_raw: conv(1) }));
  const saturated = judgeAd({ status: "ACTIVE", kind: "whatsapp", rows: expensive, crmDates: twoClients, freq7: 4.2, today: TODAY }, bench);
  assert.equal(saturated.tone, "bad");
  assert.match(saturated.recommendations[0].title, /Público saturado/);
});

test("gastou sem trazer cliente depois do aprendizado; vencedor com cliente barato", () => {
  const rows = days(10, () => ({ spend: 10, impressions: 1000, clicks: 20, leads: 2 }));
  const crmOld = ["2026-09-25"];
  assert.equal(judgeAd({ status: "ACTIVE", kind: "cadastro", rows, crmDates: crmOld, today: TODAY }, bench).recommendations[0].title, "Gastou sem trazer cliente");
  const cheap = Array.from({ length: 12 }, (_, i) => `2026-10-${String(7 + (i % 7)).padStart(2, "0")}`);
  assert.equal(judgeAd({ status: "ACTIVE", kind: "cadastro", rows, crmDates: cheap, freq7: 1.5, today: TODAY }, bench).recommendations[0].title, "Vencedor");
});

test("rótulos curtos", () => {
  assert.equal(shortCampaignName("SITE | Marilia | PATROCINADO | Video (API 18-55)"), "Site · Video");
  assert.equal(shortCampaignName("WHATSAPP | Marilia | Ecovillage | Conversas (API 18-53)"), "WhatsApp · Conversas");
  assert.equal(statusLabelFor("CAMPAIGN_PAUSED"), "Campanha pausada");
});
