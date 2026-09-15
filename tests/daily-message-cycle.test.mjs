import test from "node:test";
import assert from "node:assert/strict";
import { computeCycleId, nextCycleLabel, getTodayInSaoPaulo, addDaysToPlainDate } from "../lib/daily-message-cycle.js";

// America/Sao_Paulo não observa horário de verão desde 2019 (offset fixo
// -03:00), então os horários abaixo em UTC-3 mapeiam de forma previsível.
function spTimeToUtc(plainDate, hh, mm) {
  const [year, month, day] = plainDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hh + 3, mm));
}

test("computeCycleId: 08:00 -> ciclo de 08:00:00 ate 07:59:59 do dia seguinte", () => {
  // 07:59 (antes do horario) pertence ao ciclo de ONTEM
  assert.equal(computeCycleId("08:00", spTimeToUtc("2026-09-15", 7, 59)), "2026-09-14");
  // exatamente 08:00 ja pertence ao ciclo de HOJE
  assert.equal(computeCycleId("08:00", spTimeToUtc("2026-09-15", 8, 0)), "2026-09-15");
  // 10:00 (bem depois) continua no ciclo de hoje
  assert.equal(computeCycleId("08:00", spTimeToUtc("2026-09-15", 10, 0)), "2026-09-15");
});

test("computeCycleId: horario configuravel (07:30) desloca a fronteira", () => {
  assert.equal(computeCycleId("07:30", spTimeToUtc("2026-09-15", 7, 29)), "2026-09-14");
  assert.equal(computeCycleId("07:30", spTimeToUtc("2026-09-15", 7, 30)), "2026-09-15");
});

test("nextCycleLabel: mostra 'hoje' antes da fronteira e 'amanha' depois", () => {
  assert.equal(nextCycleLabel("08:00", spTimeToUtc("2026-09-15", 7, 0)), "hoje às 08:00");
  assert.equal(nextCycleLabel("08:00", spTimeToUtc("2026-09-15", 9, 0)), "amanhã às 08:00");
});

test("getTodayInSaoPaulo aceita 'now' explicito (necessario para o item 18: mudar o horario no meio do dia nao deve depender de Date.now() implicito)", () => {
  assert.equal(getTodayInSaoPaulo(spTimeToUtc("2026-09-15", 12, 0)), "2026-09-15");
});

test("addDaysToPlainDate cruza virada de mes/ano corretamente", () => {
  assert.equal(addDaysToPlainDate("2026-09-15", -1), "2026-09-14");
  assert.equal(addDaysToPlainDate("2026-01-01", -1), "2025-12-31");
  assert.equal(addDaysToPlainDate("2026-09-30", 1), "2026-10-01");
});
