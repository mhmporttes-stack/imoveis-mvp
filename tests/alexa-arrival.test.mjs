import test from "node:test";
import assert from "node:assert/strict";
import {
  AlexaSettingsError,
  composeArrivalSummary,
  containsSensitiveContent,
  evaluateRoutineSpeak,
  getDefaultAlexaSettings,
  greetingForMinutes,
  isRoutineWindowOpen,
  MAX_SUMMARY_LENGTH,
  normalizeAlexaSettings,
  saoPauloDateKey,
  spokenTime,
  validateAlexaSettingsInput
} from "../lib/alexa-config-core.mjs";

// 2026-10-05 é segunda-feira (UTC-3).
const monday10h = new Date("2026-10-05T13:00:00Z");
const monday20h = new Date("2026-10-05T23:00:00Z");
const sunday10h = new Date("2026-10-04T13:00:00Z");

test("padrão da rotina de chegada: desligada, 3 min, seg-sex", () => {
  const routine = getDefaultAlexaSettings().routines.arrival;
  assert.equal(routine.enabled, false);
  assert.equal(routine.delayMinutes, 3);
  assert.deepEqual(routine.allowedWeekdays, [1, 2, 3, 4, 5]);
});

test("chave do dia usa a data de São Paulo (virada à meia-noite de Brasília)", () => {
  assert.equal(saoPauloDateKey(new Date("2026-10-05T02:59:00Z")), "2026-10-04");
  assert.equal(saoPauloDateKey(new Date("2026-10-05T03:00:00Z")), "2026-10-05");
  assert.equal(saoPauloDateKey(monday10h), "2026-10-05");
});

test("rotina só fala com Alexa ativa, rotina ativa e dentro das janelas", () => {
  const settings = getDefaultAlexaSettings();
  assert.equal(evaluateRoutineSpeak({ settings, routineKey: "arrival", now: monday10h }).reason, "rotina_inativa");
  settings.routines.arrival.enabled = true;
  assert.equal(evaluateRoutineSpeak({ settings, routineKey: "arrival", now: monday10h }).allow, true);
  assert.equal(evaluateRoutineSpeak({ settings, routineKey: "arrival", now: sunday10h }).reason, "dia_nao_permitido");
  assert.equal(evaluateRoutineSpeak({ settings, routineKey: "arrival", now: monday20h }).reason, "fora_do_horario");
  settings.enabled = false;
  assert.equal(evaluateRoutineSpeak({ settings, routineKey: "arrival", now: monday10h }).reason, "alexa_inativa");
  assert.equal(evaluateRoutineSpeak({ settings, routineKey: "x", now: monday10h }).reason, "rotina_desconhecida");
});

test("a janela global também restringe a rotina (vale o mais restritivo)", () => {
  const settings = getDefaultAlexaSettings();
  settings.routines.arrival.enabled = true;
  settings.allowedWeekdays = [2, 3];
  assert.equal(evaluateRoutineSpeak({ settings, routineKey: "arrival", now: monday10h }).reason, "dia_nao_permitido");
});

test("janela da rotina ao receber a chegada", () => {
  const routine = getDefaultAlexaSettings().routines.arrival;
  assert.equal(isRoutineWindowOpen(routine, monday10h), true);
  assert.equal(isRoutineWindowOpen(routine, monday20h), false);
  assert.equal(isRoutineWindowOpen(routine, sunday10h), false);
});

test("validação e normalização das rotinas", () => {
  const settings = getDefaultAlexaSettings();
  settings.routines.arrival.delayMinutes = 5;
  assert.equal(validateAlexaSettingsInput(settings).routines.arrival.delayMinutes, 5);
  for (const mutate of [
    (s) => { s.routines.arrival.delayMinutes = 61; },
    (s) => { s.routines.arrival.delayMinutes = -1; },
    (s) => { s.routines.arrival.allowedWeekdays = []; },
    (s) => { s.routines.arrival.startTime = s.routines.arrival.endTime; },
    (s) => { s.routines.arrival.startTime = "99:00"; }
  ]) {
    const copy = structuredClone(getDefaultAlexaSettings());
    mutate(copy);
    assert.throws(() => validateAlexaSettingsInput(copy), AlexaSettingsError);
  }
  // sem a coluna no banco (migration pendente) cai nos padrões
  assert.deepEqual(normalizeAlexaSettings({ enabled: true }).routines, getDefaultAlexaSettings().routines);
  assert.equal(normalizeAlexaSettings({ routines: { arrival: { enabled: true, delayMinutes: 9 } } }).routines.arrival.delayMinutes, 9);
});

test("saudação e horário falado", () => {
  assert.equal(greetingForMinutes(7 * 60), "Bom dia");
  assert.equal(greetingForMinutes(13 * 60), "Boa tarde");
  assert.equal(greetingForMinutes(19 * 60), "Boa noite");
  assert.equal(spokenTime(10, 0), "10 horas");
  assert.equal(spokenTime(1, 0), "1 hora");
  assert.equal(spokenTime(14, 30), "14 e 30");
  assert.equal(spokenTime(9, 5), "9 e 05");
});

test("resumo completo, natural e curto", () => {
  const text = composeArrivalSummary({
    name: "Matheus",
    minutesOfDay: 8 * 60 + 30,
    agenda: { count: 2, nextTime: { h: 10, m: 0 } },
    awaitingSimulation: 6,
    documentsPending: 3,
    awaitingApproval: 1,
    goalDoneNames: ["Bruna", "Eduardo"],
    salesToday: 1
  });
  assert.equal(
    text,
    "Bom dia, Matheus. Você tem 2 compromissos hoje, a próxima às 10 horas. Temos 6 clientes aguardando simulação, 3 documentações pendentes e 1 cliente aguardando aprovação. Bruna e Eduardo já concluíram a meta diária. 1 venda registrada hoje."
  );
  assert.ok(text.length <= MAX_SUMMARY_LENGTH);
  assert.equal(containsSensitiveContent(text), false);
});

test("itens zerados somem e sem nada relevante há mensagem neutra", () => {
  assert.equal(
    composeArrivalSummary({ name: "Matheus", minutesOfDay: 14 * 60, awaitingSimulation: 1 }),
    "Boa tarde, Matheus. Temos 1 cliente aguardando simulação."
  );
  assert.equal(composeArrivalSummary({ minutesOfDay: 9 * 60 }), "Bom dia. Nenhuma pendência importante no momento.");
});

test("meta: um nome, vários e muitos", () => {
  assert.match(composeArrivalSummary({ minutesOfDay: 600, goalDoneNames: ["Bruna"] }), /Bruna já concluiu a meta diária\./);
  assert.match(composeArrivalSummary({ minutesOfDay: 600, goalDoneNames: ["A", "B", "C", "D"] }), /4 corretores já concluíram a meta diária\./);
});

test("resumo muito longo corta o item menos prioritário e nunca passa do limite", () => {
  const text = composeArrivalSummary({
    name: "Matheus",
    minutesOfDay: 600,
    agenda: { count: 12, nextTime: { h: 10, m: 30 } },
    awaitingSimulation: 120,
    documentsPending: 80,
    awaitingApproval: 40,
    goalDoneNames: ["Bruna Maria", "Eduardo José", "Carolina Beatriz"],
    salesToday: 15
  });
  assert.ok(text.length <= MAX_SUMMARY_LENGTH, `tamanho ${text.length}`);
  assert.ok(text.startsWith("Bom dia, Matheus."));
});
