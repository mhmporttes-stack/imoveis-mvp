import test from "node:test";
import assert from "node:assert/strict";
import { handleSkillRequestV2 } from "../lib/alexa-v2/router.mjs";
import { PERIOD_IDS, periodFromText, resolvePeriod } from "../lib/alexa-v2/periods.mjs";
import { agendaRange } from "../lib/alexa-v2/providers/agenda-core.mjs";
import { activityLabel, activitiesSentence, buildActivityItems } from "../lib/alexa-v2/providers/activities-core.mjs";
import { auditModel, buildInteractionModel } from "../lib/alexa-v2/model-core.mjs";

const TODAY = "2026-10-07"; // quarta-feira
const SKILL = "amzn1.ask.skill.test";

const slot = (value, id) => ({ value, ...(id ? { resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { id, name: value } }] }] } } : {}) });
const envelope = (intent, slots = {}, attributes = {}) => ({
  session: { new: false, application: { applicationId: SKILL }, user: { userId: "u" }, attributes },
  request: { type: "IntentRequest", intent: { name: intent, slots } }
});

// 08/10 12:00Z = 09:00 em Brasília.
const TOMORROW = [
  { at: "2026-10-08T12:00:00Z", type: "reuniao", title: "Reunião com João", clientName: "João Alves", clientId: "1" },
  { at: "2026-10-08T17:00:00Z", type: "follow_up", title: "Follow-up", clientName: "maria souza", clientId: "2" },
  { at: "2026-10-08T19:00:00Z", type: "documentacao", title: "Carlos Dias", clientName: "Carlos Dias", clientId: "3" },
  // duplicada (mesmo cliente, mesmo minuto, mesmo tipo)
  { at: "2026-10-08T19:00:00Z", type: "documentacao", title: "Atividade do cliente", clientName: "Carlos Dias", clientId: "3" }
];
const MANY = Array.from({ length: 7 }, (_, index) => ({ at: `2026-10-08T${String(11 + index).padStart(2, "0")}:00:00Z`, type: "ligacao", title: "Ligar", clientName: `Cliente${"abcdefg"[index]}`, clientId: `c${index}` }));

function conversation(rowsByPeriod) {
  let attributes = {};
  const deps = {
    today: () => TODAY,
    brokers: { match: () => null, byId: () => null },
    legacyDeps: {},
    providers: { agenda: async (q) => ({ items: buildActivityItems(rowsByPeriod[q.periodo] || [], { today: TODAY }), multiDay: q.periodo === "esta_semana" }) }
  };
  return async (intent, slots) => {
    const result = await handleSkillRequestV2(envelope(intent, slots, attributes), deps);
    attributes = result.sessionAttributes;
    return result.response.outputSpeech.text;
  };
}

test("períodos: depois de amanhã e horário de Brasília", () => {
  assert.ok(PERIOD_IDS.includes("depois_amanha"));
  assert.equal(resolvePeriod("depois_amanha", TODAY).startDate, "2026-10-09");
  assert.equal(resolvePeriod("depois_amanha", TODAY).spoken, "depois de amanhã");
  assert.equal(periodFromText("depois de amanhã"), "depois_amanha");
  assert.equal(periodFromText("amanhã"), "amanha");
  assert.deepEqual(agendaRange("depois_amanha", TODAY), { startDate: "2026-10-09", endDate: "2026-10-09" });
  const items = buildActivityItems(TOMORROW, { today: TODAY });
  assert.equal(items[0].hours, 9);
  assert.equal(items[0].dayOffset, 1);
  assert.equal(items.length, 3, "remove a atividade duplicada do mesmo cliente");
});

test("frases: horário, tipo e primeiro nome do cliente", () => {
  assert.equal(activityLabel({ type: "reuniao", title: "Reunião com João", clientName: "João Alves" }), "reunião com João");
  assert.equal(activityLabel({ type: "follow_up", title: "Follow-up", clientName: "maria souza" }), "retorno para Maria");
  assert.equal(activityLabel({ type: "documentacao", title: "", clientName: "Carlos Dias" }), "documentação de Carlos");
  assert.equal(activityLabel({ type: "outro", title: "Enviar proposta", clientName: "" }), "Enviar proposta");
  assert.equal(activityLabel({ type: "outro", title: "", clientName: "" }), "atividade");
  const one = buildActivityItems([{ at: "2026-10-08T04:00:00Z", type: "reuniao", title: "", clientName: "Ana", clientId: "9" }], { today: TODAY });
  assert.equal(activitiesSentence(one, { periodoSpoken: "amanhã" }).text, "Amanhã você tem 1 atividade. À 1 hora, reunião com Ana.");
});

test("minha agenda de amanhã, primeira, depois, última e depois de amanhã", async () => {
  const say = conversation({ amanha: TOMORROW, depois_amanha: [] });
  assert.equal(
    await say("AgendaIntent", { periodo: slot("amanhã", "amanha") }),
    "Amanhã você tem 3 atividades. Às 9 horas, reunião com João. Às 14 horas, retorno para Maria. E às 16 horas, documentação de Carlos."
  );
  assert.equal(await say("PrimeiraIntent"), "A primeira é às 9 horas, reunião com João.");
  assert.equal(await say("MaisIntent"), "Às 14 horas, retorno para Maria. E às 16 horas, documentação de Carlos.");
  assert.equal(await say("UltimaIntent"), "A última é às 16 horas, documentação de Carlos.");
  assert.equal(await say("ContinuaIntent", { periodo: slot("depois de amanhã", "depois_amanha") }), "Você não tem nenhuma atividade agendada para depois de amanhã.");
});

test("sem atividade, sem contexto e lista longa com continuação", async () => {
  const say = conversation({ amanha: [], hoje: MANY });
  assert.equal(await say("AgendaIntent", { periodo: slot("amanhã", "amanha") }), "Você não tem nenhuma atividade agendada para amanhã.");
  const noCtx = conversation({});
  assert.match(await noCtx("PrimeiraIntent"), /De qual agenda/);
  const long = conversation({ hoje: MANY });
  const first = await long("AgendaIntent", {});
  assert.match(first, /^Hoje você tem 7 atividades\. Às 8 horas, ligação para Clientea\./);
  assert.match(first, /E há mais 2\.$/);
  const rest = await long("MaisIntent");
  assert.match(rest, /^Às 13 horas, ligação para Clientef\. E às 14 horas, ligação para Clienteg\.$/);
  assert.equal(await long("MaisIntent"), "Esses eram todos.");
});

test("esta semana mostra o dia de cada atividade", async () => {
  const say = conversation({ esta_semana: [{ at: "2026-10-09T13:00:00Z", type: "reuniao", title: "", clientName: "Ana", clientId: "1" }] });
  assert.equal(await say("AgendaIntent", { periodo: slot("esta semana", "esta_semana") }), "Esta semana você tem 1 atividade. Na sexta-feira, às 10 horas, reunião com Ana.");
});

test("modelo de voz inclui a agenda pessoal sem conflitos", () => {
  const model = buildInteractionModel({ brokers: [{ id: "i1", name: "Izabela", fullName: "Izabela Silvério" }] });
  assert.deepEqual(auditModel(model), []);
  const language = model.interactionModel.languageModel;
  const agenda = language.intents.find((intent) => intent.name === "AgendaIntent");
  assert.ok(agenda.samples.includes("quais atividades eu tenho agendadas para {periodo}"));
  assert.ok(agenda.samples.includes("o que eu tenho para {periodo}"));
  assert.ok(agenda.samples.includes("tenho alguma atividade {periodo}"));
  assert.ok(language.intents.find((intent) => intent.name === "PrimeiraIntent"));
  assert.ok(language.intents.find((intent) => intent.name === "UltimaIntent"));
  assert.ok(language.intents.find((intent) => intent.name === "MaisIntent").samples.includes("e depois"));
  const periodo = language.types.find((type) => type.name === "PERIODO").values.find((value) => value.id === "depois_amanha");
  assert.equal(periodo.name.value, "depois de amanhã");
});
