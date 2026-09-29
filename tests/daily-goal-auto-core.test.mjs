import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDailyAutoCap,
  warmupDayNumber,
  spreadScheduleMinutes,
  isWithinWindow,
  isBusinessDay,
  isOptOutMessage,
  pickMessageVariant,
  renderAutoMessage
} from "../lib/daily-goal-auto-core.mjs";

test("teto do dia nunca passa de 20, mesmo com cota de Gestão maior", () => {
  assert.equal(computeDailyAutoCap({ quota: 30, warmupDayNumber: null }), 20);
});

test("teto do dia respeita a rampa de aquecimento nos primeiros dias", () => {
  assert.equal(computeDailyAutoCap({ quota: 30, warmupSchedule: [5, 10, 15, 20], warmupDayNumber: 1 }), 5);
  assert.equal(computeDailyAutoCap({ quota: 30, warmupSchedule: [5, 10, 15, 20], warmupDayNumber: 2 }), 10);
  assert.equal(computeDailyAutoCap({ quota: 30, warmupSchedule: [5, 10, 15, 20], warmupDayNumber: 4 }), 20);
});

test("depois do fim da rampa, volta a valer o teto de 20 (rampa não limita mais)", () => {
  assert.equal(computeDailyAutoCap({ quota: 30, warmupSchedule: [5, 10, 15, 20], warmupDayNumber: 5 }), 20);
});

test("cota de Gestão menor que 20 prevalece (teto é o MENOR dos candidatos)", () => {
  assert.equal(computeDailyAutoCap({ quota: 12, warmupDayNumber: null }), 12);
});

test("warmupDayNumber conta a partir do dia de início (dia 1 = o próprio dia)", () => {
  assert.equal(warmupDayNumber("2026-09-29", "2026-09-29"), 1);
  assert.equal(warmupDayNumber("2026-09-29", "2026-09-30"), 2);
  assert.equal(warmupDayNumber("2026-09-29", "2026-10-02"), 4);
});

test("warmupDayNumber sem data de início não limita (null)", () => {
  assert.equal(warmupDayNumber(null, "2026-09-29"), null);
});

test("spreadScheduleMinutes espalha dentro da janela, respeitando o mínimo/máximo intervalo", () => {
  let seed = 0;
  const random = () => { seed = (seed + 0.37) % 1; return seed; };
  const times = spreadScheduleMinutes({ count: 5, windowStartMinutes: 480, windowEndMinutes: 1080, minGapMinutes: 20, maxGapMinutes: 40, random });
  assert.ok(times.length <= 5);
  for (const t of times) assert.ok(t >= 480 && t <= 1080);
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i] - times[i - 1];
    assert.ok(gap >= 20 && gap <= 40, `gap=${gap}`);
  }
});

test("spreadScheduleMinutes ativado tarde: começa de nowMinutes, nunca antes", () => {
  const times = spreadScheduleMinutes({ count: 3, windowStartMinutes: 480, windowEndMinutes: 1080, minGapMinutes: 20, maxGapMinutes: 20, nowMinutes: 900, random: () => 0 });
  assert.equal(times[0], 900);
});

test("spreadScheduleMinutes corta quando não cabe mais nenhum horário na janela", () => {
  const times = spreadScheduleMinutes({ count: 20, windowStartMinutes: 480, windowEndMinutes: 540, minGapMinutes: 20, maxGapMinutes: 20, random: () => 0 });
  assert.ok(times.length < 20);
  for (const t of times) assert.ok(t <= 540);
});

test("isWithinWindow", () => {
  assert.equal(isWithinWindow(480, 480, 1080), true);
  assert.equal(isWithinWindow(1080, 480, 1080), true);
  assert.equal(isWithinWindow(479, 480, 1080), false);
  assert.equal(isWithinWindow(1081, 480, 1080), false);
});

test("isBusinessDay: segunda a sexta são dias úteis, sábado e domingo não", () => {
  assert.equal(isBusinessDay(0), false); // domingo
  assert.equal(isBusinessDay(1), true);
  assert.equal(isBusinessDay(5), true);
  assert.equal(isBusinessDay(6), false); // sábado
});

test("isOptOutMessage reconhece PARAR/SAIR/CANCELAR ignorando maiúsculas e acentos", () => {
  assert.equal(isOptOutMessage("PARAR"), true);
  assert.equal(isOptOutMessage("parar"), true);
  assert.equal(isOptOutMessage("Sair"), true);
  assert.equal(isOptOutMessage("cancelar"), true);
  assert.equal(isOptOutMessage("  Não Quero Mais  "), true);
});

test("isOptOutMessage NÃO dispara em frase longa que só menciona a palavra (evita falso positivo)", () => {
  assert.equal(isOptOutMessage("vou cancelar minha viagem amanhã"), false);
  assert.equal(isOptOutMessage("oi, tudo bem?"), false);
  assert.equal(isOptOutMessage(""), false);
});

test("pickMessageVariant nunca repete a última variação usada (com mais de 1 opção)", () => {
  const variants = ["a", "b"];
  const { text, index } = pickMessageVariant(variants, 0, () => 0); // sortearia índice 0 de novo
  assert.equal(index, 1);
  assert.equal(text, "b");
});

test("pickMessageVariant com 1 única variação sempre repete (nada a evitar)", () => {
  assert.deepEqual(pickMessageVariant(["único"], 0), { text: "único", index: 0 });
});

test("renderAutoMessage substitui {primeiro_nome}", () => {
  assert.equal(renderAutoMessage("Oi, {primeiro_nome}!", { primeiroNome: "Carol" }), "Oi, Carol!");
});
