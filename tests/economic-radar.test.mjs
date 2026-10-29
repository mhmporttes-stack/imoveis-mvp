import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BRAND_SIGNATURE,
  CAIXA_CNPJ8,
  RADAR_BANK_MODALITY_PATTERN,
  buildInstallmentMessage,
  indicatorByCode,
  monthlyPoints,
  normalizeMcmvSettings,
  parseOlindaRates,
  parseSgs,
  pickLaborCode,
  radarBankTile,
  radarMcmvTile,
  radarTile,
  releasedToday,
  sourceShort
} from "../lib/economic-indicators-core.mjs";

// Tira do Radar Econômico (dono, 2026-10-29 — ECON-2). Respostas reais gravadas em tests/fixtures/economic/.
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/economic/${name}`, import.meta.url), "utf8"));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ipca = indicatorByCode("ipca");
const selic = indicatorByCode("selic");
const at = (day, hour = "21:40") => `${day}T${hour}:00Z`; // 18:40 em São Paulo

test("fonte curta: IBGE, FGV e BCB a partir do catálogo", () => {
  assert.equal(sourceShort(ipca), "IBGE");
  assert.equal(sourceShort(indicatorByCode("incc")), "FGV");
  assert.equal(sourceShort(selic), "BCB");
  assert.equal(sourceShort(indicatorByCode("renda")), "IBGE");
});

test("minigráfico: IPCA real em 12 pontos mensais; seis últimos no spark", () => {
  const rows = parseSgs(fixture("sgs-433-ipca.json"));
  const tile = radarTile(ipca, rows, { today: "2026-10-29" });
  assert.equal(tile.history.length, 12);
  assert.equal(tile.history.at(-1).date, "2026-09-01");
  assert.equal(tile.spark.length, 6);
  assert.deepEqual(tile.spark, rows.slice(-6).map((r) => r.value));
  assert.equal(tile.source, "IBGE");
  assert.ok(tile.twelveMonthsLabel.endsWith("%"));
  assert.equal(tile.tone, ({ up: "bad", down: "good", stable: "neutral" })[tile.direction]);
});

test("série diária (Selic): um ponto por mês, o último valor do mês", () => {
  const rows = [
    { reference_date: "2026-08-30", value: 15 },
    { reference_date: "2026-08-31", value: 14.75 },
    { reference_date: "2026-09-15", value: 14.5 }
  ];
  assert.deepEqual(monthlyPoints(selic, rows).map((p) => [p.date, p.value]), [["2026-08-31", 14.75], ["2026-09-15", 14.5]]);
});

test("mudou hoje: só quando a divulgação nova entrou hoje e a anterior em outro dia", () => {
  const rows = [
    { reference_date: "2026-08-01", value: 0.2, fetched_at: at("2026-09-10") },
    { reference_date: "2026-09-01", value: 0.4, fetched_at: at("2026-10-29") }
  ];
  assert.equal(releasedToday(ipca, rows, "2026-10-29"), true);
  assert.equal(releasedToday(ipca, rows, "2026-10-30"), false);
  // 1ª coleta (backfill): tudo no mesmo dia -> sem selo, como os alertas.
  const backfill = rows.map((r) => ({ ...r, fetched_at: at("2026-10-29") }));
  assert.equal(releasedToday(ipca, backfill, "2026-10-29"), false);
  // Fuso: 01:30 UTC de 30/10 ainda é 29/10 em São Paulo.
  assert.equal(releasedToday(ipca, [rows[0], { ...rows[1], fetched_at: "2026-10-30T01:30:00Z" }], "2026-10-29"), true);
});

test("mudou hoje na Selic: só quando o VALOR muda (linha diária igual não conta)", () => {
  const same = [
    { reference_date: "2026-10-27", value: 15, fetched_at: at("2026-10-27") },
    { reference_date: "2026-10-28", value: 15, fetched_at: at("2026-10-28") },
    { reference_date: "2026-10-29", value: 15, fetched_at: at("2026-10-29") }
  ];
  assert.equal(releasedToday(selic, same, "2026-10-29"), false);
  const changed = [...same.slice(0, 2), { reference_date: "2026-10-29", value: 14.75, fetched_at: at("2026-10-29") }];
  assert.equal(releasedToday(selic, changed, "2026-10-29"), true);
});

test("renda ou desemprego: o de referência mais recente; empate = renda", () => {
  const r = [{ reference_date: "2026-08-01" }];
  const d = [{ reference_date: "2026-09-01" }];
  assert.equal(pickLaborCode(r, d), "desemprego");
  assert.equal(pickLaborCode(d, d), "renda");
  assert.equal(pickLaborCode([], []), null);
});

test("financiamento: Caixa + média simples dos bancos na modalidade do comparativo (resposta real do BCB)", () => {
  const all = parseOlindaRates(fixture("olinda-taxajuros-imob-2026-09.json"));
  const rows = all.filter((row) => RADAR_BANK_MODALITY_PATTERN.test(row.modality)).map((row) => ({ ...row, fetched_at: at("2026-10-05") }));
  const tile = radarBankTile(rows, { today: "2026-10-29" });
  const caixa = rows.find((row) => row.cnpj8 === CAIXA_CNPJ8);
  assert.equal(tile.caixa.value, caixa.rate_year);
  const avg = Math.round((rows.reduce((s, r) => s + r.rate_year, 0) / rows.length) * 100) / 100;
  assert.equal(tile.average.value, avg);
  assert.equal(tile.average.count, rows.length);
  assert.equal(tile.reference, "set/2026");
  assert.equal(tile.source, "BCB");
  assert.match(tile.description, /não é a taxa oferecida/);
  assert.equal(tile.releasedToday, false);
  assert.equal(radarBankTile([], {}), null);
});

test("MCMV: valida, aceita número digitado do jeito brasileiro e só aparece com portaria e data", () => {
  const ok = normalizeMcmvSettings({ portaria: "Portaria MCID nº 1/2026", portariaData: "2026-07-01", faixas: [{ nome: "Faixa 1", rendaAte: "2.850", tetoImovel: "R$ 264.000,00" }, { nome: "", rendaAte: "", tetoImovel: "" }] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value.faixas, [{ nome: "Faixa 1", rendaAte: 2850, tetoImovel: 264000 }]);
  assert.equal(normalizeMcmvSettings({ faixas: [] }).value, null); // apagar
  assert.equal(normalizeMcmvSettings({ portaria: "Portaria X", portariaData: "2026-02-30", faixas: [{ nome: "F1", tetoImovel: 1 }] }).ok, false);
  assert.equal(normalizeMcmvSettings({ portariaData: "2026-07-01", faixas: [{ nome: "F1", tetoImovel: 1 }] }).ok, false);
  assert.equal(normalizeMcmvSettings({ portaria: "Portaria X", portariaData: "2026-07-01", faixas: [{ nome: "F1" }] }).ok, false);
  assert.equal(normalizeMcmvSettings({ portaria: "Portaria X", portariaData: "2026-07-01", faixas: [{ nome: "F1", tetoImovel: "abc" }] }).ok, false);
  const tile = radarMcmvTile(ok.value);
  assert.equal(tile.reference, "portaria 01/07/2026");
  assert.match(tile.label, /^R\$\s?264\.000$/);
  assert.equal(tile.name, "MCMV · teto");
  assert.match(buildInstallmentMessage([tile]), /Minha Casa Minha Vida, teto: R\$\s?264\.000 \(Portaria MCID nº 1\/2026, de 01\/07\/2026\)/);
  assert.equal(radarMcmvTile(null), null);
  assert.equal(radarMcmvTile({ faixas: [] }), null);
});

test("texto da parcela: só números mostrados, sem promessa, assinatura com o nome oficial", () => {
  const rows = parseSgs(fixture("sgs-433-ipca.json"));
  const tiles = [radarTile(ipca, rows, { today: "2026-10-29" }), { code: "selic", label: "15,00% a.a.", reference: "28/10/2026" }, { code: "tr", label: "—" }];
  const text = buildInstallmentMessage(tiles);
  assert.match(text, /IPCA \(inflação oficial\) em set\/2026/);
  assert.match(text, /Selic .*15,00% a\.a\./);
  assert.doesNotMatch(text, /TR de/); // sem dado não entra
  assert.match(text, /dependem da análise de crédito/);
  assert.doesNotMatch(text, /aprovad|garant|com certeza/i);
  assert.ok(text.endsWith(BRAND_SIGNATURE));
  assert.equal(BRAND_SIGNATURE, "Matheus Machado Corretor de Imóveis");
  assert.ok(!buildInstallmentMessage(tiles, { sign: false }).includes(BRAND_SIGNATURE));
  assert.equal(buildInstallmentMessage([]), "");
});

test("radar no servidor: cache em memória curto, invalidado pela coleta e pelo cadastro do MCMV", () => {
  const source = read("lib/economic-indicators.js");
  assert.match(source, /serverCache\.memo\(CACHE_TAGS\.ECON_RADAR, "radar", 30_000, loadEconomicRadar\)/);
  assert.equal((source.match(/serverCache\.invalidate\(CACHE_TAGS\.ECON_RADAR\)/g) || []).length, 2);
  assert.match(source, /assertGeneralAdmin\(auth\)/);
  const route = read("app/api/admin/economic-indicators/mcmv/route.js");
  assert.equal((route.match(/requireGeneralAdminApi\(request\)/g) || []).length, 2);
});

test("card: fundo só por transform, parado com movimento reduzido e aba oculta", () => {
  const css = read("app/globals.css");
  const keyframes = css.slice(css.indexOf("@keyframes mm-radar-drift"), css.indexOf(".mm-radar-backdrop {"));
  assert.match(keyframes, /transform/);
  assert.doesNotMatch(keyframes, /left|width|opacity/);
  assert.match(css, /\.mm-radar-paused \.mm-radar-backdrop/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\n  \.mm-scan,\n  \.mm-radar-backdrop,/);
  const card = read("components/economic/EconomicRadarCard.jsx");
  assert.match(card, /mm-radar-paused/);
  assert.match(card, /\/api\/admin\/economic-indicators\/radar/);
  assert.match(card, /href="\/admin\/indicadores-economicos"/); // o atalho para a aba continua
});
