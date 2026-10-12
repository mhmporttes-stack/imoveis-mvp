import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESENCE_REPORT_PERIODS,
  compareReportMembers,
  computeDailyPresence,
  resolvePresencePeriodDates
} from "../lib/admin-presence-core.mjs";

const range = (today, period, extra = {}) => {
  const { startDate, endDate } = resolvePresencePeriodDates(today, { period, ...extra });
  return [startDate, endDate];
};

test("períodos aceitos: 'Esta semana' (week) não existe mais; desconhecido vira Hoje", () => {
  assert.deepEqual(PRESENCE_REPORT_PERIODS, ["today", "yesterday", "last_week", "month", "custom"]);
  assert.deepEqual(resolvePresencePeriodDates("2026-10-12", { period: "week" }), { period: "today", startDate: "2026-10-12", endDate: "2026-10-12" });
});

test("Hoje e Ontem (datas de São Paulo)", () => {
  assert.deepEqual(range("2026-10-12", "today"), ["2026-10-12", "2026-10-12"]);
  assert.deepEqual(range("2026-10-12", "yesterday"), ["2026-10-11", "2026-10-11"]);
  assert.deepEqual(range("2026-10-01", "yesterday"), ["2026-09-30", "2026-09-30"]);
  assert.deepEqual(range("2027-01-01", "yesterday"), ["2026-12-31", "2026-12-31"]);
});

test("Semana passada = última semana FECHADA, segunda a domingo (regra do dono, 2026-10-12)", () => {
  // segunda 12/10 → 05/10 a 11/10
  assert.deepEqual(range("2026-10-12", "last_week"), ["2026-10-05", "2026-10-11"]);
  // qualquer dia da semana de 12/10 a 18/10 dá a mesma semana fechada
  for (const today of ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]) {
    assert.deepEqual(range(today, "last_week"), ["2026-10-05", "2026-10-11"], today);
  }
  // domingo 11/10: a semana corrente (05–11) ainda não fechou → 28/09 a 04/10
  assert.deepEqual(range("2026-10-11", "last_week"), ["2026-09-28", "2026-10-04"]);
  // virada de mês/ano
  assert.deepEqual(range("2026-11-02", "last_week"), ["2026-10-26", "2026-11-01"]);
  assert.deepEqual(range("2027-01-01", "last_week"), ["2026-12-21", "2026-12-27"]);
});

test("Este mês: do dia 1 até hoje; Personalizado: aceita só AAAA-MM-DD e inverte se vier trocado", () => {
  assert.deepEqual(range("2026-10-12", "month"), ["2026-10-01", "2026-10-12"]);
  assert.deepEqual(range("2026-10-12", "custom", { startDate: "2026-10-09", endDate: "2026-10-11" }), ["2026-10-09", "2026-10-11"]);
  assert.deepEqual(range("2026-10-12", "custom", { startDate: "2026-10-11", endDate: "2026-10-09" }), ["2026-10-09", "2026-10-11"]);
  assert.deepEqual(range("2026-10-12", "custom", { startDate: "lixo" }), ["2026-10-12", "2026-10-12"]);
});

test("limite da semana: domingo 23:59 (São Paulo) entra, segunda 00:00 não entra", () => {
  const [start, end] = range("2026-10-12", "last_week");
  const rows = [
    { minute_at: "2026-10-05T03:00:00.000Z", kind: "interaction" }, // seg 05/10 00:00 BRT — entra
    { minute_at: "2026-10-12T02:59:00.000Z", kind: "interaction" }, // dom 11/10 23:59 BRT — entra
    { minute_at: "2026-10-12T03:00:00.000Z", kind: "interaction" }, // seg 12/10 00:00 BRT — fora
    { minute_at: "2026-10-05T02:59:00.000Z", kind: "interaction" } // dom 04/10 23:59 BRT — fora
  ];
  const days = computeDailyPresence(rows, Date.parse("2026-10-12T10:00:00.000Z"));
  const inside = days.filter((day) => day.date >= start && day.date <= end).map((day) => day.date);
  const outside = days.filter((day) => day.date < start || day.date > end).map((day) => day.date);
  assert.deepEqual(inside, ["2026-10-05", "2026-10-11"]);
  assert.deepEqual(outside, ["2026-10-04", "2026-10-12"]);
});

test("online × ausente: até 5 min online; excedente até 30 min ausente; acima disso offline", () => {
  const base = Date.parse("2026-10-09T12:00:00.000Z");
  const at = (minutes, kind = "interaction") => ({ minute_at: new Date(base + minutes * 60000).toISOString(), kind });
  // marcas a cada minuto por 10 min (0..9), lacuna de 20 min, marca, lacuna de 2 h, marca
  const rows = [...Array.from({ length: 10 }, (_, index) => at(index)), at(29), at(149)];
  const [day] = computeDailyPresence(rows, base + 24 * 3600000);
  // 9 min contínuos + 5 (lacuna de 20) + 5 (lacuna de 120) + 5 (após a última, dia passado)
  assert.equal(day.activeMinutes, 24);
  // lacuna de 20 → 15 ausente; lacuna de 120 → 25 ausente (até 30), resto offline
  assert.equal(day.awayMinutes, 40);
  assert.equal(day.date, "2026-10-09");
});

test("depois de ação de WhatsApp (grace) tolera 10 min; última marca de hoje limitada ao agora", () => {
  const base = Date.parse("2026-10-12T12:00:00.000Z");
  const rows = [{ minute_at: new Date(base).toISOString(), kind: "grace" }, { minute_at: new Date(base + 8 * 60000).toISOString(), kind: "interaction" }];
  const [day] = computeDailyPresence(rows, base + 10 * 60000);
  assert.equal(day.activeMinutes, 8 + 2);
  assert.equal(day.awayMinutes, 0);
});

test("ordenação: mais online primeiro; empate por contatos e depois por nome", () => {
  const members = [
    { name: "Izabela", activeMinutes: 0, contacts: 0 },
    { name: "Bruna", activeMinutes: 0, contacts: 0 },
    { name: "Caroline", activeMinutes: 0, contacts: 3 },
    { name: "ketlin", activeMinutes: 73, contacts: 0 }
  ];
  assert.deepEqual(members.sort(compareReportMembers).map((member) => member.name), ["ketlin", "Caroline", "Bruna", "Izabela"]);
});
