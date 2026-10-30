import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addDaysToPlainDate,
  getTodayInSaoPaulo,
  resolveReportRange,
  zonedPlainDateToUtcIso
} from "../lib/daily-report-range.mjs";

const HOUR = 3600 * 1000;

test("Ontem = 00:00 a 24:00 de São Paulo (03:00Z a 03:00Z), 24 h exatas", () => {
  const range = resolveReportRange({ period: "yesterday" }, new Date("2026-10-30T14:00:00Z"));
  assert.equal(range.startDate, "2026-10-29");
  assert.equal(range.endDate, "2026-10-29");
  assert.equal(range.startIso, "2026-10-29T03:00:00.000Z");
  assert.equal(range.endIso, "2026-10-30T03:00:00.000Z");
  assert.equal(new Date(range.endIso) - new Date(range.startIso), 24 * HOUR);
  assert.equal(range.primaryLabel, "Ontem");
});

test("Hoje = o dia de São Paulo até a meia-noite seguinte", () => {
  const range = resolveReportRange({ period: "today" }, new Date("2026-10-30T14:00:00Z"));
  assert.equal(range.startIso, "2026-10-30T03:00:00.000Z");
  assert.equal(range.endIso, "2026-10-31T03:00:00.000Z");
});

test("Virada de dia: 22h30 em São Paulo já é o dia seguinte em UTC, mas 'hoje' continua o dia de São Paulo", () => {
  const now = new Date("2026-10-30T01:30:00Z"); // 29/10 22:30 em São Paulo
  assert.equal(getTodayInSaoPaulo(now), "2026-10-29");
  assert.equal(resolveReportRange({ period: "today" }, now).startDate, "2026-10-29");
  assert.equal(resolveReportRange({ period: "yesterday" }, now).startDate, "2026-10-28");
  // 00:30 de São Paulo (03:30Z): já virou
  assert.equal(getTodayInSaoPaulo(new Date("2026-10-30T03:30:00Z")), "2026-10-30");
  assert.equal(getTodayInSaoPaulo(new Date("2026-10-30T02:59:59Z")), "2026-10-29");
});

test("Limites: 23:59:59 de ontem entra, 00:00:00 de hoje não (fim exclusivo)", () => {
  const range = resolveReportRange({ period: "yesterday" }, new Date("2026-10-30T14:00:00Z"));
  const inside = (iso) => iso >= range.startIso && iso < range.endIso;
  assert.equal(inside("2026-10-29T03:00:00.000Z"), true);
  assert.equal(inside("2026-10-30T02:59:59.999Z"), true);
  assert.equal(inside("2026-10-30T03:00:00.000Z"), false);
  assert.equal(inside("2026-10-29T02:59:59.999Z"), false);
});

test("7 e 30 dias terminam hoje e contam o dia de hoje (7 e 30 dias de calendário)", () => {
  const now = new Date("2026-10-30T14:00:00Z");
  const seven = resolveReportRange({ period: "last7" }, now);
  assert.equal(seven.startDate, "2026-10-24");
  assert.equal(seven.endDate, "2026-10-30");
  assert.equal((new Date(seven.endIso) - new Date(seven.startIso)) / (24 * HOUR), 7);
  const thirty = resolveReportRange({ period: "last30" }, now);
  assert.equal(thirty.startDate, "2026-10-01");
  assert.equal((new Date(thirty.endIso) - new Date(thirty.startIso)) / (24 * HOUR), 30);
});

test("Virada de mês e de ano", () => {
  assert.equal(resolveReportRange({ period: "yesterday" }, new Date("2026-11-01T12:00:00Z")).startDate, "2026-10-31");
  assert.equal(resolveReportRange({ period: "yesterday" }, new Date("2027-01-01T12:00:00Z")).startDate, "2026-12-31");
  assert.equal(addDaysToPlainDate("2028-02-28", 1), "2028-02-29");
});

test("Personalizado: fim inclusivo, datas invertidas se corrigem, inválido cai em hoje", () => {
  const now = new Date("2026-10-30T14:00:00Z");
  const custom = resolveReportRange({ period: "custom", startDate: "2026-10-28", endDate: "2026-10-29" }, now);
  assert.equal(custom.startIso, "2026-10-28T03:00:00.000Z");
  assert.equal(custom.endIso, "2026-10-30T03:00:00.000Z");
  assert.equal(custom.title, "Relatório de 28/10/2026 a 29/10/2026");

  const swapped = resolveReportRange({ period: "custom", startDate: "2026-10-29", endDate: "2026-10-28" }, now);
  assert.equal(swapped.startDate, "2026-10-28");
  assert.equal(swapped.endDate, "2026-10-29");

  const onlyStart = resolveReportRange({ period: "custom", startDate: "2026-10-27" }, now);
  assert.equal(onlyStart.endDate, "2026-10-27");

  const invalid = resolveReportRange({ period: "custom", startDate: "27/10/2026", endDate: "x" }, now);
  assert.equal(invalid.startDate, "2026-10-30");

  assert.equal(resolveReportRange({ period: "qualquer" }, now).period, "today");
});

test("Fuso: usa o deslocamento real de São Paulo (-03:00 hoje, -02:00 no horário de verão antigo)", () => {
  assert.equal(zonedPlainDateToUtcIso("2026-10-29"), "2026-10-29T03:00:00.000Z");
  assert.equal(zonedPlainDateToUtcIso("2018-11-10"), "2018-11-10T02:00:00.000Z");
});

test("daily-report.js continua exportando os mesmos nomes e usa a janela nas duas consultas", () => {
  const lib = readFileSync(new URL("../lib/daily-report.js", import.meta.url), "utf8");
  assert.match(lib, /export \{[^}]*resolveReportRange[^}]*\} from "\.\/daily-report-range\.mjs"/);
  assert.match(lib, /\.gte\("created_at", range\.startIso\)/);
  assert.match(lib, /\.lt\("created_at", range\.endIso\)/);
  assert.match(lib, /\.gte\("changed_at", range\.startIso\)/);
  assert.match(lib, /\.lt\("changed_at", range\.endIso\)/);
});
