import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTrendBuckets, normalizeTrendGranularity } from "../lib/performance-trend.mjs";

test("normalizeTrendGranularity aceita só day/week/month, senão cai pra month", () => {
  assert.equal(normalizeTrendGranularity("day"), "day");
  assert.equal(normalizeTrendGranularity("week"), "week");
  assert.equal(normalizeTrendGranularity("month"), "month");
  assert.equal(normalizeTrendGranularity("qualquer-coisa"), "month");
  assert.equal(normalizeTrendGranularity(undefined), "month");
});

test("buildTrendBuckets(day) gera N dias terminando hoje, cada um com 1 dia", () => {
  const buckets = buildTrendBuckets("day", "2026-09-29", 5);
  assert.equal(buckets.length, 5);
  assert.equal(buckets[buckets.length - 1].startDate, "2026-09-29");
  assert.equal(buckets[buckets.length - 1].endDate, "2026-09-29");
  assert.equal(buckets[0].startDate, "2026-09-25");
});

test("buildTrendBuckets(day) atravessa virada de mês corretamente", () => {
  const buckets = buildTrendBuckets("day", "2026-10-02", 5);
  assert.deepEqual(buckets.map((bucket) => bucket.startDate), [
    "2026-09-28",
    "2026-09-29",
    "2026-09-30",
    "2026-10-01",
    "2026-10-02"
  ]);
});

test("buildTrendBuckets(week) alinha à segunda-feira e cobre 7 dias por bucket", () => {
  // 2026-09-29 é uma terça-feira.
  const buckets = buildTrendBuckets("week", "2026-09-29", 3);
  assert.equal(buckets.length, 3);
  const last = buckets[buckets.length - 1];
  assert.equal(last.startDate, "2026-09-28"); // segunda daquela semana
  assert.equal(last.endDate, "2026-10-04"); // domingo
  const first = buckets[0];
  assert.equal(first.startDate, "2026-09-14");
  assert.equal(first.endDate, "2026-09-20");
});

test("buildTrendBuckets(month) usa o dia 1 até o último dia de cada mês, inclusive fevereiro", () => {
  const buckets = buildTrendBuckets("month", "2026-03-15", 3);
  assert.deepEqual(buckets.map((bucket) => [bucket.startDate, bucket.endDate]), [
    ["2026-01-01", "2026-01-31"],
    ["2026-02-01", "2026-02-28"],
    ["2026-03-01", "2026-03-31"]
  ]);
});

test("buildTrendBuckets limita a quantidade de buckets entre 1 e 60", () => {
  assert.equal(buildTrendBuckets("day", "2026-09-29", -5).length, 1);
  assert.equal(buildTrendBuckets("day", "2026-09-29", 999).length, 60);
});

test("buildTrendBuckets sem count usa o padrão da granularidade", () => {
  assert.equal(buildTrendBuckets("day", "2026-09-29").length, 14);
  assert.equal(buildTrendBuckets("week", "2026-09-29").length, 8);
  assert.equal(buildTrendBuckets("month", "2026-09-29").length, 6);
});
