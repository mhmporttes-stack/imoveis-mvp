import test from "node:test";
import assert from "node:assert/strict";
import {
  ALERT_HOURS,
  ALERT_LOOKBACK_MS,
  HENRY_ALERT_NEW,
  HENRY_ALERT_PHRASES,
  HENRY_ALERT_SUMMARY,
  HENRY_ALERT_TRANSFER,
  HENRY_ALERT_VOCATIVES,
  HENRY_ALERT_WAITING,
  addAlertSeen,
  alertWindowStart,
  buildClientAlertEvent,
  classifyAlertAnswer,
  clientVoice,
  composeHenryClientAlert,
  formatWaiting,
  henryClientAlertsFromSetting,
  isAlertDevice,
  isAlertHour,
  isHenryAlertPhrase,
  mergeAlertPending,
  pickAlertPhrase,
  responsibleSteps,
  shouldReleaseAlert
} from "../lib/henry-voice-client-alerts-core.mjs";
import { isSafeToSpeak } from "../lib/alexa-v2/sanitize.mjs";

const NOW = Date.parse("2026-10-23T15:00:00.000Z");
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60000).toISOString();
const users = new Map([
  ["gabriel", { id: "gabriel", name: "Gabriel Souza", gender: "male" }],
  ["bruna", { id: "bruna", name: "Bruna Lima", gender: "female" }],
  ["dienifer", { id: "dienifer", name: "Dienifer Alves", gender: "female" }],
  ["owner", { id: "owner", name: "Matheus Machado", gender: "male" }]
]);
const seq = (...values) => {
  let index = 0;
  return () => values[index++ % values.length];
};

test("bancos: pelo menos 5 modelos por tipo e vocativos em tom de pergunta", () => {
  assert.ok(HENRY_ALERT_NEW.length >= 5);
  assert.ok(HENRY_ALERT_TRANSFER.length >= 5);
  assert.ok(HENRY_ALERT_SUMMARY.length >= 5);
  assert.ok(HENRY_ALERT_WAITING.length >= 5);
  assert.ok(HENRY_ALERT_VOCATIVES.length >= 5);
  for (const vocative of HENRY_ALERT_VOCATIVES) assert.match(vocative, /\?$/);
  for (const bank of Object.values(HENRY_ALERT_PHRASES)) assert.ok(bank.length >= 5);
  assert.ok(HENRY_ALERT_VOCATIVES.some((item) => /chefe/i.test(item)) && HENRY_ALERT_VOCATIVES.some((item) => /patr[aã]o/i.test(item)) && HENRY_ALERT_VOCATIVES.some((item) => /mestre/i.test(item)));
});

test("vocativo e frases curtas nunca repetem seguido", () => {
  let recent = [];
  let previous = "";
  for (let index = 0; index < 40; index += 1) {
    const picked = pickAlertPhrase("vocative", recent, Math.random);
    assert.notEqual(picked.text, previous);
    previous = picked.text;
    recent = picked.recent;
  }
  assert.ok(isHenryAlertPhrase("Chefe?"));
  assert.ok(isHenryAlertPhrase(HENRY_ALERT_PHRASES.later[0]));
  assert.equal(isHenryAlertPhrase("Fala qualquer coisa"), false);
});

test("modelo da informação não repete seguido (recent guardado entre avisos)", () => {
  const event = { clientId: "c1", clientName: "Maria Silva", receiverId: "gabriel", kind: "new", path: ["gabriel"], waitingMinutes: null };
  let recent;
  let previous = "";
  for (let index = 0; index < 30; index += 1) {
    const result = composeHenryClientAlert([event], { users, recent, random: Math.random });
    assert.ok(result.text);
    assert.notEqual(result.text, previous);
    previous = result.text;
    recent = result.recent;
  }
});

test("gênero pelo primeiro nome; na dúvida, neutro", () => {
  assert.equal(clientVoice("Maria Aparecida").novo, "uma nova cliente");
  assert.equal(clientVoice("Pedro Henrique").novo, "um novo cliente");
  assert.equal(clientVoice("Ariel Costa").gender, null);
  assert.equal(clientVoice("Ariel Costa").novo, "um novo lead");
  const female = composeHenryClientAlert([{ clientId: "c", clientName: "Maria", receiverId: "gabriel", kind: "new", path: ["gabriel"] }], { users, random: () => 0 });
  assert.equal(female.text, "O Gabriel acabou de receber uma nova cliente: Maria.");
  const male = composeHenryClientAlert([{ clientId: "c", clientName: "Pedro", receiverId: "bruna", kind: "new", path: ["bruna"] }], { users, random: () => 0 });
  assert.equal(male.text, "A Bruna acabou de receber um novo cliente: Pedro.");
  const neutral = composeHenryClientAlert([{ clientId: "c", clientName: "Ariel", receiverId: "bruna", kind: "transfer", path: ["gabriel", "bruna"] }], { users, random: () => 0 });
  assert.doesNotMatch(neutral.text, /\(a\)/);
  assert.ok(isSafeToSpeak(neutral.text));
});

test("todos os modelos funcionam nos três gêneros, sem 'undefined' e sem dado sensível", () => {
  for (const name of ["Maria", "Pedro", "Ariel", ""]) {
    for (const kind of ["new", "transfer"]) {
      for (let index = 0; index < 12; index += 1) {
        const { text } = composeHenryClientAlert([{ clientId: "c", clientName: name, receiverId: index % 2 ? "owner" : "dienifer", kind, path: ["bruna", "gabriel", index % 2 ? "owner" : "dienifer"], waitingMinutes: 30 }], { users, ownerId: "owner", random: () => (index % 6) / 6 });
        assert.ok(text, `${name}/${kind}`);
        assert.doesNotMatch(text, /undefined|null|\{|\}/);
        assert.ok(isSafeToSpeak(text));
      }
    }
  }
});

test("tempo aguardando: só sem atendimento, a partir de 2 min, nunca acima de 24 h", () => {
  assert.equal(formatWaiting(30), "30 minutos");
  assert.equal(formatWaiting(1), "1 minuto");
  assert.equal(formatWaiting(70), "1 hora e 10 minutos");
  assert.equal(formatWaiting(120), "2 horas");
  const registration = { id: "c1", full_name: "Maria", created_at: iso(30), responsible_user_id: "gabriel", direct_broker_link: true };
  const fromIso = iso(5);
  const waiting = buildClientAlertEvent({ registration: { ...registration, created_at: iso(3) }, fromIso, now: NOW });
  assert.equal(waiting.waitingMinutes, 3);
  const attended = buildClientAlertEvent({ registration: { ...registration, created_at: iso(3) }, fromIso, attended: true, now: NOW });
  assert.equal(attended.waitingMinutes, null);
  const steps = [{ userId: "bruna", at: iso(40 * 60) }, { userId: "gabriel", at: iso(1) }];
  const old = buildClientAlertEvent({ registration: { ...registration, created_at: iso(48 * 60), direct_broker_link: false }, steps, fromIso, now: NOW });
  assert.equal(old.waitingMinutes, null);
  const text = composeHenryClientAlert([{ clientId: "c1", clientName: "Maria", receiverId: "gabriel", kind: "new", path: ["gabriel"], waitingMinutes: 30 }], { users, random: () => 0 }).text;
  assert.match(text, /30 minutos/);
  const fresh = composeHenryClientAlert([{ clientId: "c1", clientName: "Maria", receiverId: "gabriel", kind: "new", path: ["gabriel"], waitingMinutes: 1 }], { users, random: () => 0 }).text;
  assert.doesNotMatch(fresh, /minuto/);
});

test("caminho da transferência: passos em ordem, sem fila do dono, no máximo 3", () => {
  const distribution = [
    { from_user_id: null, to_user_id: "bruna", created_at: iso(30), details: {} },
    { from_user_id: "bruna", to_user_id: "owner", created_at: iso(20), details: { toWaitingQueue: true } },
    { from_user_id: null, to_user_id: "dienifer", created_at: iso(10), details: { fromWaitingQueue: true } }
  ];
  const journey = [{ occurred_at: iso(2), details: { transferType: "manual", fromId: "dienifer", toId: "gabriel" } }, { occurred_at: iso(1), details: { transferType: "roulette", fromId: "x", toId: "y" } }];
  const steps = responsibleSteps({ distribution, journey });
  assert.deepEqual(steps.map((step) => step.userId), ["bruna", "dienifer", "gabriel"]);
  const event = buildClientAlertEvent({ registration: { id: "c", full_name: "Maria", created_at: iso(30), responsible_user_id: "gabriel" }, steps, fromIso: iso(5), now: NOW });
  assert.equal(event.kind, "transfer");
  assert.deepEqual(event.path, ["bruna", "dienifer", "gabriel"]);
  const text = composeHenryClientAlert([event], { users, random: () => 0 }).text;
  assert.match(text, /pra Bruna, depois pra Dienifer e por fim transferida pro Gabriel/);
  const many = responsibleSteps({ distribution: ["a", "b", "c", "d", "e"].map((to, index) => ({ to_user_id: to, created_at: iso(50 - index), details: {} })) });
  const longEvent = buildClientAlertEvent({ registration: { id: "c", full_name: "Maria", created_at: iso(60), responsible_user_id: "e" }, steps: many, fromIso: iso(47), now: NOW });
  assert.deepEqual(longEvent.path, ["c", "d", "e"]);
});

test("evento só com entrega na janela ou link pessoal novo; responsável atual tem de ser o último passo", () => {
  const registration = { id: "c", full_name: "Maria", created_at: iso(60), responsible_user_id: "gabriel" };
  const oldSteps = [{ userId: "gabriel", at: iso(60) }];
  assert.equal(buildClientAlertEvent({ registration, steps: oldSteps, fromIso: iso(5), now: NOW }), null);
  assert.ok(buildClientAlertEvent({ registration, steps: oldSteps, fromIso: iso(5), requireFresh: false, now: NOW }));
  assert.equal(buildClientAlertEvent({ registration: { ...registration, responsible_user_id: "bruna" }, steps: [{ userId: "gabriel", at: iso(1) }], fromIso: iso(5), now: NOW }), null);
  const direct = buildClientAlertEvent({ registration: { ...registration, created_at: iso(1), direct_broker_link: true }, fromIso: iso(5), now: NOW });
  assert.equal(direct.kind, "new");
});

test("resumo de vários eventos: contagem, até 4 nomes e o que espera há mais tempo", () => {
  const events = ["Maria", "Pedro", "Ana", "Carla", "Joao"].map((name, index) => ({ clientId: `c${index}`, clientName: name, receiverId: index % 2 ? "bruna" : "gabriel", kind: index === 4 ? "transfer" : "new", path: ["gabriel"], waitingMinutes: index * 5 }));
  const { text } = composeHenryClientAlert(events, { users, random: () => 0 });
  assert.match(text, /4 clientes novos e uma transferência/);
  assert.match(text, /Maria com o Gabriel, Pedro com a Bruna/);
  assert.match(text, /mais 1/);
  assert.match(text, /20 minutos/);
  assert.doesNotMatch(text, /Joao com/);
  const away = composeHenryClientAlert(events.slice(0, 3), { users, away: true, random: () => 0 }).text;
  assert.match(away, /^Enquanto você estava fora, entraram 3 clientes novos\. Maria com o Gabriel/);
});

test("o dono vira 'você'", () => {
  const { text } = composeHenryClientAlert([{ clientId: "c", clientName: "Maria", receiverId: "owner", kind: "new", path: ["owner"] }], { users, ownerId: "owner", random: () => 0 });
  assert.equal(text, "Você acabou de receber uma nova cliente: Maria.");
});

test("resposta ao chamado: sim, não, ruído e outra coisa (sem IA)", () => {
  for (const yes of ["oi", "Fala", "pode falar", "sim", "diz", "manda", "o que foi?", "tô ouvindo", "opa", "Sim, pode falar", "Oi, Henry", "fala, patrão", "Chefe?", "ok", "que foi"]) {
    assert.equal(classifyAlertAnswer(yes), "yes", yes);
  }
  for (const no of ["agora não", "depois", "tô ocupado", "espera", "não", "mais tarde", "daqui a pouco", "agora não, Henry", "pera aí", "tô em reunião"]) {
    assert.equal(classifyAlertAnswer(no), "no", no);
  }
  assert.equal(classifyAlertAnswer("hmm"), "noise");
  assert.equal(classifyAlertAnswer("quantos leads entraram hoje no total"), "other");
  assert.equal(classifyAlertAnswer("qual o tempo amanhã"), "yes"); // curta e não negativa: na dúvida, pode falar
});

test("liberação da rajada, janela, horário, aparelho e liga/desliga", () => {
  assert.equal(shouldReleaseAlert({ oldestAt: iso(0.1), newestAt: iso(0.1), now: NOW }), false);
  assert.equal(shouldReleaseAlert({ oldestAt: iso(0.5), newestAt: iso(0.4), now: NOW }), true);
  assert.equal(shouldReleaseAlert({ oldestAt: iso(1.1), newestAt: iso(0.05), now: NOW }), true);
  assert.equal(alertWindowStart("", NOW), new Date(NOW).toISOString());
  assert.equal(alertWindowStart(iso(120), NOW), new Date(NOW - ALERT_LOOKBACK_MS).toISOString());
  assert.equal(alertWindowStart(iso(2), NOW), iso(3));
  assert.equal(isAlertHour(ALERT_HOURS.start), true);
  assert.equal(isAlertHour(ALERT_HOURS.end), false);
  assert.equal(isAlertHour(6 * 60 + 59), false);
  assert.equal(isAlertDevice(null, "d1"), true);
  assert.equal(isAlertDevice({ deviceId: "d1", at: 0 }, "d1"), true);
  assert.equal(isAlertDevice({ deviceId: "d2", at: 0 }, "d1"), false);
  assert.equal(henryClientAlertsFromSetting({}), true);
  assert.equal(henryClientAlertsFromSetting({ clientAlerts: false }), false);
});

test("pendentes não repetem e vistos expiram em 30 min", () => {
  const pending = mergeAlertPending([{ key: "a:1", clientId: "a", at: iso(1) }], [{ key: "a:1", clientId: "a", at: iso(0) }, { key: "b:2", clientId: "b", at: iso(0) }]);
  assert.equal(pending.length, 2);
  const seen = addAlertSeen([{ key: "old", at: NOW - 31 * 60000 }, { key: "a:1", at: NOW - 60000 }], ["b:2"], NOW);
  assert.deepEqual(seen.map((item) => item.key), ["a:1", "b:2"]);
  assert.equal(seq("x")(), "x");
});
