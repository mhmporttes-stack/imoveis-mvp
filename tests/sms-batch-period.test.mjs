import test from "node:test";
import assert from "node:assert/strict";
import { buildSmsMetrics, inSmsPeriod, resolveSmsPeriod } from "../lib/sms-batch-core.mjs";

// Período dos resultados do Lote de SMS (dono, 2026-11-02): Hoje, Ontem, 7 dias, 30 dias e Personalizado, dias de São Paulo.
// 2026-11-02 12:00 em São Paulo = 15:00 UTC.
const NOW = new Date("2026-11-02T15:00:00Z");

test("atalhos são calculados no servidor pela data de hoje em São Paulo", () => {
  assert.deepEqual(resolveSmsPeriod({ preset: "today" }, NOW), { preset: "today", from: "2026-11-02", to: "2026-11-02", label: "Hoje", includesToday: true });
  const yesterday = resolveSmsPeriod({ preset: "yesterday" }, NOW);
  assert.equal(yesterday.from, "2026-11-01");
  assert.equal(yesterday.to, "2026-11-01");
  assert.equal(yesterday.includesToday, false);
  assert.equal(resolveSmsPeriod({ preset: "last7" }, NOW).from, "2026-10-27");
  assert.equal(resolveSmsPeriod({ preset: "last30" }, NOW).from, "2026-10-04");
  assert.equal(resolveSmsPeriod({ preset: "last30" }, NOW).to, "2026-11-02");
});

test("de madrugada em UTC ainda é o dia anterior em São Paulo", () => {
  const lateNight = new Date("2026-11-02T01:30:00Z"); // 22:30 de 01/11 em São Paulo
  assert.equal(resolveSmsPeriod({ preset: "today" }, lateNight).from, "2026-11-01");
});

test("sem período (ou 'all') = comportamento de sempre, sem datas", () => {
  for (const input of [{}, { preset: "" }, { preset: "all" }, undefined]) {
    const period = resolveSmsPeriod(input, NOW);
    assert.equal(period.preset, "all");
    assert.equal(period.from, "");
    assert.equal(period.includesToday, true);
  }
});

test("atalho ignora from/to enviados pelo cliente", () => {
  const period = resolveSmsPeriod({ preset: "today", from: "2020-01-01", to: "2020-12-31" }, NOW);
  assert.equal(period.from, "2026-11-02");
});

test("personalizado valida datas reais, ordem e o limite de 366 dias", () => {
  const ok = resolveSmsPeriod({ preset: "custom", from: "2026-10-01", to: "2026-10-15" }, NOW);
  assert.equal(ok.error, undefined);
  assert.equal(ok.label, "01/10/2026 a 15/10/2026");
  assert.equal(resolveSmsPeriod({ preset: "custom", from: "2026-10-05", to: "2026-10-05" }, NOW).label, "05/10/2026");
  assert.ok(resolveSmsPeriod({ preset: "custom", from: "", to: "2026-10-15" }, NOW).error);
  assert.ok(resolveSmsPeriod({ preset: "custom", from: "2026-10-15", to: "" }, NOW).error);
  assert.ok(resolveSmsPeriod({ preset: "custom", from: "2026-02-30", to: "2026-03-01" }, NOW).error);
  assert.ok(resolveSmsPeriod({ preset: "custom", from: "01/10/2026", to: "15/10/2026" }, NOW).error);
  assert.ok(resolveSmsPeriod({ preset: "custom", from: "2026-10-15", to: "2026-10-01" }, NOW).error);
  // 366 dias cabem (2025-11-02 a 2026-11-02); 367 não.
  assert.equal(resolveSmsPeriod({ preset: "custom", from: "2025-11-02", to: "2026-11-02" }, NOW).error, undefined);
  assert.ok(resolveSmsPeriod({ preset: "custom", from: "2025-11-01", to: "2026-11-02" }, NOW).error);
  assert.ok(resolveSmsPeriod({ preset: "invalido" }, NOW).error);
});

test("inSmsPeriod usa o dia de São Paulo, inclusive nas bordas", () => {
  const period = resolveSmsPeriod({ preset: "custom", from: "2026-11-01", to: "2026-11-01" }, NOW);
  assert.equal(inSmsPeriod({ created_at: "2026-11-01T03:00:00Z" }, period), true); // 00:00 SP
  assert.equal(inSmsPeriod({ created_at: "2026-11-02T02:59:59Z" }, period), true); // 23:59 SP
  assert.equal(inSmsPeriod({ created_at: "2026-11-01T02:59:59Z" }, period), false); // 23:59 de 31/10 SP
  assert.equal(inSmsPeriod({ created_at: "2026-11-02T03:00:00Z" }, period), false);
  assert.equal(inSmsPeriod({ created_at: "2026-11-02T03:00:00Z" }, null), true);
});

test("métricas obedecem ao período: totais, por dia e taxa; sem período, últimos 14 dias como antes", () => {
  const rows = {
    sends: [{ created_at: "2026-11-01T15:00:00Z" }, { created_at: "2026-11-01T16:00:00Z" }, { created_at: "2026-11-02T15:00:00Z" }, { created_at: "2026-10-20T15:00:00Z" }],
    sends2: [{ created_at: "2026-11-01T18:00:00Z" }, { created_at: "2026-11-02T18:00:00Z" }],
    views: [{ created_at: "2026-11-01T17:00:00Z" }, { created_at: "2026-11-02T17:00:00Z" }],
    signups: [{ created_at: "2026-11-01T19:00:00Z" }]
  };
  const all = buildSmsMetrics(rows, { now: NOW });
  assert.equal(all.byDay.length, 14);
  assert.equal(all.total.sent, 4);

  const yesterday = buildSmsMetrics(rows, { now: NOW, period: resolveSmsPeriod({ preset: "yesterday" }, NOW) });
  assert.deepEqual(yesterday.total, { sent: 2, sent2: 1, clicks: 1, signups: 1, rate: 0.5 });
  assert.equal(yesterday.byDay.length, 1);
  assert.equal(yesterday.byDay[0].day, "2026-11-01");

  const week = buildSmsMetrics(rows, { now: NOW, period: resolveSmsPeriod({ preset: "last7" }, NOW) });
  assert.equal(week.byDay.length, 7);
  assert.equal(week.byDay[0].day, "2026-11-02");
  assert.equal(week.total.sent, 3);
  assert.equal(week.total.sent2, 2);

  const empty = buildSmsMetrics(rows, { now: NOW, period: resolveSmsPeriod({ preset: "custom", from: "2026-09-01", to: "2026-09-03" }, NOW) });
  assert.equal(empty.total.sent, 0);
  assert.equal(empty.total.rate, null);
  assert.equal(empty.byDay.length, 3);
});
