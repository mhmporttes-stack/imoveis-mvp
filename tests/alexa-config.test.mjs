import test from "node:test";
import assert from "node:assert/strict";
import {
  AlexaSettingsError,
  containsSensitiveContent,
  evaluateSpeak,
  firstName,
  getDefaultAlexaSettings,
  intervalCutoffIso,
  isWithinSchedule,
  normalizeAlexaSettings,
  renderAlexaPhrase,
  saoPauloNow,
  validateAlexaSettingsInput
} from "../lib/alexa-config-core.mjs";

// 2026-10-05 é segunda-feira. Horário de Brasília = UTC-3.
const monday10h = new Date("2026-10-05T13:00:00Z");
const monday23h30 = new Date("2026-10-06T02:30:00Z");
const sunday10h = new Date("2026-10-04T13:00:00Z");

test("saoPauloNow converte para dia da semana e minutos de Brasília", () => {
  assert.deepEqual(saoPauloNow(monday10h), { weekday: 1, minutes: 600 });
  assert.deepEqual(saoPauloNow(sunday10h), { weekday: 0, minutes: 600 });
});

test("padrão preserva o comportamento atual: só Novo cliente liga, 24h", () => {
  const defaults = getDefaultAlexaSettings();
  assert.equal(defaults.events.new_client.enabled, true);
  assert.equal(defaults.events.new_client.phrase, "Novo cliente aguardando atendimento.");
  for (const key of ["approved_client", "sale_made", "daily_goal", "upcoming_meeting", "queue"]) {
    assert.equal(defaults.events[key].enabled, false);
  }
  assert.equal(evaluateSpeak({ settings: defaults, eventKey: "new_client", now: sunday10h }).allow, true);
  assert.equal(evaluateSpeak({ settings: defaults, eventKey: "sale_made", now: monday10h }).reason, "evento_inativo");
});

test("Alexa desativada e evento desconhecido nunca falam", () => {
  const settings = { ...getDefaultAlexaSettings(), enabled: false };
  assert.equal(evaluateSpeak({ settings, eventKey: "new_client", now: monday10h }).reason, "alexa_inativa");
  assert.equal(evaluateSpeak({ settings: getDefaultAlexaSettings(), eventKey: "x", now: monday10h }).reason, "evento_desconhecido");
});

test("dia da semana e horário permitidos", () => {
  const settings = { ...getDefaultAlexaSettings(), allowedWeekdays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "19:00" };
  assert.equal(isWithinSchedule(settings, monday10h).allowed, true);
  assert.equal(isWithinSchedule(settings, sunday10h).reason, "dia_nao_permitido");
  assert.equal(isWithinSchedule(settings, monday23h30).reason, "fora_do_horario");
});

test("janela que cruza a meia-noite", () => {
  const settings = { ...getDefaultAlexaSettings(), startTime: "22:00", endTime: "06:00" };
  assert.equal(isWithinSchedule(settings, monday23h30).allowed, true);
  assert.equal(isWithinSchedule(settings, monday10h).allowed, false);
});

test("corte do intervalo mínimo", () => {
  const settings = { ...getDefaultAlexaSettings(), minIntervalSeconds: 60 };
  assert.equal(intervalCutoffIso(settings, monday10h), "2026-10-05T12:59:00.000Z");
});

test("validação da entrada do painel", () => {
  const valid = getDefaultAlexaSettings();
  assert.deepEqual(validateAlexaSettingsInput(valid).allowedWeekdays, [0, 1, 2, 3, 4, 5, 6]);

  const bad = (mutate) => {
    const copy = structuredClone(valid);
    mutate(copy);
    assert.throws(() => validateAlexaSettingsInput(copy), AlexaSettingsError);
  };
  bad((s) => { s.allowedWeekdays = []; });
  bad((s) => { s.startTime = "25:00"; });
  bad((s) => { s.endTime = s.startTime; });
  bad((s) => { s.minIntervalSeconds = -1; });
  bad((s) => { s.events.new_client.phrase = ""; });
  bad((s) => { s.events.new_client.phrase = "Cliente com renda alta"; });
  bad((s) => { s.events.new_client.phrase = "CPF 123.456.789-09"; });
  bad((s) => { s.events.new_client.phrase = "Financiamento de R$ 300 mil"; });
  bad((s) => { s.events.new_client.phrase = "Olá {inexistente}"; });
  bad((s) => { s.events.upcoming_meeting.leadMinutes = 0; });
  bad((s) => { s.events.queue.minClients = 1000; });
});

test("variáveis só valem para o evento certo", () => {
  const settings = getDefaultAlexaSettings();
  settings.events.sale_made.phrase = "Venda de {corretor} para {cliente}.";
  assert.doesNotThrow(() => validateAlexaSettingsInput(settings));
  settings.events.daily_goal.phrase = "{cliente} bateu a meta.";
  assert.throws(() => validateAlexaSettingsInput(settings), AlexaSettingsError);
});

test("renderização usa primeiro nome e remove variável sem valor", () => {
  assert.equal(firstName("Maria da Silva"), "Maria");
  assert.equal(renderAlexaPhrase("sale_made", "Nova venda registrada por {corretor}.", { corretor: "Eduardo" }), "Nova venda registrada por Eduardo.");
  assert.equal(renderAlexaPhrase("new_client", "Novo cliente {cliente} , chegou.", {}), "Novo cliente, chegou.");
  assert.equal(
    renderAlexaPhrase("queue", "Existem {quantidade} clientes há mais de {minutos} minutos.", { quantidade: 5, minutos: 10 }),
    "Existem 5 clientes há mais de 10 minutos."
  );
});

test("texto final com dado sensível é barrado", () => {
  assert.equal(renderAlexaPhrase("new_client", "Novo {cliente}", { cliente: "12345678901" }), "");
  assert.equal(containsSensitiveContent("Reunião em 15 minutos."), false);
  assert.equal(containsSensitiveContent("Renda de cinco mil"), true);
});

test("normalização do banco é tolerante e completa com defaults", () => {
  const normalized = normalizeAlexaSettings({ enabled: false, allowed_weekdays: [1, 9, "x"], events: { queue: { enabled: true, minClients: 5, phrase: "  " } } });
  assert.equal(normalized.enabled, false);
  assert.deepEqual(normalized.allowedWeekdays, [1]);
  assert.equal(normalized.events.queue.enabled, true);
  assert.equal(normalized.events.queue.minClients, 5);
  assert.equal(normalized.events.queue.minWaitMinutes, 10);
  assert.ok(normalized.events.queue.phrase.includes("{quantidade}"));
  assert.deepEqual(normalizeAlexaSettings(null), getDefaultAlexaSettings());
});
