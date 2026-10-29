import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ECON_INDICATORS,
  accumulatedStats,
  buildEconomicAlert,
  buildWhatChanged,
  computeCorrection,
  detectNewReference,
  economicAlertDedupeKey,
  freshness,
  indicatorByCode,
  parseOlindaRates,
  parseSgs,
  parseSidra,
  recipientsForIndicator,
  referenceLabel,
  toValueRows
} from "../lib/economic-indicators-core.mjs";

// Respostas REAIS gravadas em 2026-10-29 (BCB SGS, IBGE SIDRA, BCB Olinda) em tests/fixtures/economic/.
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/economic/${name}`, import.meta.url), "utf8"));
const ipca = indicatorByCode("ipca");

test("SGS: lê a resposta real do IPCA (série 433) em ordem e com número", () => {
  const rows = parseSgs(fixture("sgs-433-ipca.json"));
  assert.equal(rows[0].reference_date, "2025-01-01");
  assert.equal(rows[0].value, 0.16);
  assert.equal(rows.at(-1).reference_date, "2026-09-01");
  assert.equal(rows.at(-1).value, 0.82);
  assert.ok(rows.every((row, i) => i === 0 || row.reference_date > rows[i - 1].reference_date));
});

test("SGS: resposta fora do formato (HTML de erro) vira erro, não dado vazio", () => {
  assert.throws(() => parseSgs("<html>"), /formato/);
});

test("SGS diário (Selic 432) mantém cada dia", () => {
  const rows = parseSgs(fixture("sgs-432-selic.json"));
  assert.equal(rows.length, 10);
  assert.ok(rows.every((row) => typeof row.value === "number"));
});

test("SIDRA: trimestre móvel vira o último mês; trimestre vira o último mês do trimestre", () => {
  const unemployment = parseSidra(fixture("sidra-6381-desocupacao.json"), "moving_quarter");
  assert.equal(unemployment.at(-1).reference_date, "2026-08-01");
  assert.equal(unemployment.at(-1).value, 5.3);
  const gdp = parseSidra(fixture("sidra-5932-pib.json"), "quarterly");
  assert.equal(gdp.at(-1).reference_date, "2026-06-01");
  assert.equal(referenceLabel(indicatorByCode("pib"), gdp.at(-1).reference_date), "2º tri/2026");
  assert.equal(referenceLabel(indicatorByCode("desemprego"), "2026-08-01"), "jun–ago/2026");
});

test("SIDRA: '-' e '..' são ausência de dado, nunca zero", () => {
  const rows = parseSidra([{}, { D3C: "202601", V: "-" }, { D3C: "202602", V: ".." }, { D3C: "202603", V: "1.5" }], "monthly");
  assert.deepEqual(rows.map((r) => r.value), [1.5]);
});

test("Olinda: taxas por instituição do financiamento imobiliário (resposta real)", () => {
  const rows = parseOlindaRates(fixture("olinda-taxajuros-imob-2026-09.json"));
  assert.ok(rows.length > 10);
  assert.ok(rows.every((row) => row.reference_month === "2026-09-01" && /^Financiamento imobili/.test(row.modality)));
  const caixa = rows.find((row) => row.cnpj8 === "00360305" && row.modality.endsWith("mercado - Prefixado"));
  assert.equal(caixa.rate_year, 10.94);
});

test("dedupe (indicador, referência): a última ocorrência vence", () => {
  const rows = toValueRows("ipca", [{ reference_date: "2026-01-01", value: 1 }, { reference_date: "2026-01-01", value: 2 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, 2);
});

test("período novo só depois da 1ª coleta", () => {
  const rows = [{ reference_date: "2026-08-01" }, { reference_date: "2026-09-01" }];
  assert.equal(detectNewReference(null, rows), null);
  assert.equal(detectNewReference("2026-08-01", rows), "2026-09-01");
  assert.equal(detectNewReference("2026-09-01", rows), null);
});

test("acumulado no ano e em 12 meses (juros compostos), com a série real", () => {
  const rows = parseSgs(fixture("sgs-433-ipca.json"));
  const stats = accumulatedStats(rows);
  const ytdRates = rows.filter((r) => r.reference_date >= "2026-01-01").map((r) => r.value);
  const expectedYtd = (ytdRates.reduce((f, r) => f * (1 + r / 100), 1) - 1) * 100;
  assert.ok(Math.abs(stats.ytd - expectedYtd) < 1e-3);
  const twelve = rows.slice(-12).map((r) => r.value);
  assert.ok(Math.abs(stats.twelveMonths - (twelve.reduce((f, r) => f * (1 + r / 100), 1) - 1) * 100) < 1e-3);
});

test("acumulado é null quando falta mês", () => {
  const stats = accumulatedStats([{ reference_date: "2026-01-01", value: 1 }, { reference_date: "2026-03-01", value: 1 }]);
  assert.equal(stats.ytd, null);
  assert.equal(stats.twelveMonths, null);
});

const series = [
  { reference_date: "2026-01-01", value: 1 },
  { reference_date: "2026-02-01", value: 2 },
  { reference_date: "2026-03-01", value: -0.5 }
];

test("correção monetária: fator, correção e meses usados", () => {
  const r = computeCorrection({ amount: 1000, indicator: "ipca", startMonth: "2026-01", endMonth: "2026-03", rows: series });
  assert.equal(r.ok, true);
  assert.equal(r.factor, Number((1.01 * 1.02 * 0.995).toFixed(6)));
  assert.equal(r.updated, 1025.05);
  assert.equal(r.correction, 25.05);
  assert.equal(r.months.length, 3);
});

test("correção: fim depois do último mês divulgado corrige até ele e avisa", () => {
  const r = computeCorrection({ amount: 1000, indicator: "ipca", startMonth: "2026-02", endMonth: "2026-06", rows: series });
  assert.equal(r.ok, true);
  assert.equal(r.endMonth, "2026-03");
  assert.match(r.warnings[0], /Período incompleto/);
});

test("correção: mês faltando no meio recusa (não interpola)", () => {
  const r = computeCorrection({ amount: 1000, indicator: "ipca", startMonth: "2026-01", endMonth: "2026-03", rows: [series[0], series[2]] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["2026-02"]);
});

test("correção: antes do início da série, índice inválido e valor zero", () => {
  assert.equal(computeCorrection({ amount: 1000, indicator: "ipca", startMonth: "2025-01", endMonth: "2026-03", rows: series }).ok, false);
  assert.equal(computeCorrection({ amount: 1000, indicator: "selic", startMonth: "2026-01", endMonth: "2026-03", rows: series }).ok, false);
  assert.equal(computeCorrection({ amount: 0, indicator: "ipca", startMonth: "2026-01", endMonth: "2026-03", rows: series }).ok, false);
});

test("o que mudou: alta/queda/estável com texto só dos números", () => {
  const out = buildWhatChanged({
    ipca: [{ reference_date: "2026-08-01", value: -0.32 }, { reference_date: "2026-09-01", value: 0.82 }],
    incc: [{ reference_date: "2026-08-01", value: 0.5 }, { reference_date: "2026-09-01", value: 0.4 }],
    selic: [{ reference_date: "2026-10-01", value: 13.75 }, { reference_date: "2026-10-02", value: 13.75 }]
  });
  assert.equal(out.up[0].code, "ipca");
  assert.equal(out.up[0].relevant, true);
  assert.match(out.up[0].text, /IPCA: 0,82% \(set\/2026\), acima de -0,32% \(ago\/2026\) \(\+1,14 p\.p\.\)/);
  assert.equal(out.down[0].code, "incc");
  assert.equal(out.down[0].relevant, false);
  assert.equal(out.stable[0].code, "selic");
  assert.ok(!/porque|devido|causa/i.test(JSON.stringify(out)));
});

test("alerta: um por indicador+referência; Selic só quando muda", () => {
  const rows = [{ reference_date: "2026-08-01", value: 0.3 }, { reference_date: "2026-09-01", value: 0.82 }];
  const alert = buildEconomicAlert(ipca, rows, "2026-09-01");
  assert.equal(alert.dedupe_key, economicAlertDedupeKey("ipca", "2026-09-01"));
  assert.match(alert.title, /Variação relevante: IPCA/);
  const selic = indicatorByCode("selic");
  assert.equal(buildEconomicAlert(selic, [{ reference_date: "2026-10-01", value: 13.75 }, { reference_date: "2026-10-02", value: 13.75 }], "2026-10-02"), null);
  const changed = buildEconomicAlert(selic, [{ reference_date: "2026-10-01", value: 13.75 }, { reference_date: "2026-10-02", value: 13.5 }, { reference_date: "2026-10-03", value: 13.5 }], "2026-10-03");
  assert.equal(changed.dedupe_key, "econ:selic:2026-10-02", "mesma chave do dia em que o valor novo apareceu: a Central não duplica");
  const first = buildEconomicAlert(selic, [{ reference_date: "2026-10-01", value: 13.75 }, { reference_date: "2026-10-02", value: 13.5 }], "2026-10-02");
  assert.equal(first.dedupe_key, "econ:selic:2026-10-02");
  assert.equal(buildEconomicAlert(indicatorByCode("cdi"), rows, "2026-09-01"), null, "CDI não alerta");
});

test("preferências: desligado não recebe; inativo nunca; sem linha = recebe", () => {
  const users = [{ id: "a", role: "broker", status: "active" }, { id: "b", role: "associate", status: "active" }, { id: "c", role: "broker", status: "inactive" }];
  assert.deepEqual(recipientsForIndicator(users, [{ user_id: "b", indicator_code: "ipca", enabled: false }], "ipca"), ["a"]);
});

test("frescor: atrasado, falha e vazio", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  assert.equal(freshness(ipca, { latestReference: "2026-09-01", lastSuccessAt: "2026-10-29T00:00:00Z", now }), "ok");
  assert.equal(freshness(ipca, { latestReference: "2026-06-01", lastSuccessAt: "2026-10-29T00:00:00Z", now }), "stale");
  assert.equal(freshness(ipca, { latestReference: "2026-09-01", lastSuccessAt: "2026-10-20T00:00:00Z", lastErrorAt: "2026-10-29T00:00:00Z", now }), "error");
  assert.equal(freshness(ipca, { now }), "empty");
});

test("catálogo: códigos únicos e só fontes oficiais", () => {
  assert.equal(new Set(ECON_INDICATORS.map((i) => i.code)).size, ECON_INDICATORS.length);
  assert.ok(ECON_INDICATORS.every((i) => ["bcb_sgs", "ibge_sidra"].includes(i.source)));
});
