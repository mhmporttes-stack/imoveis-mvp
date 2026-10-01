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
  assert.equal(activityLabel({ type: "follow_up", title: "mandar mensagem", clientName: "Mateus Dias" }), "retorno para Mateus, mandar mensagem");
  assert.equal(activityLabel({ type: "reuniao", title: "matheus", clientName: "Jeniffer Lima" }), "reunião com Jeniffer, matheus");
  assert.equal(activityLabel({ type: "outro", title: "conferir andamento", clientName: "Gustavo Reis" }), "conferir andamento, cliente Gustavo");
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
  assert.equal(await noCtx("PrimeiraIntent"), "Não entendi.");
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

// --- Datas específicas e dias da semana ---------------------------------------------
import { dateSpoken, nextWeekday, parseDateSlot } from "../lib/alexa-v2/periods.mjs";

test("datas: dia e mês, dia do mês, dia da semana e próxima ocorrência (hoje = quarta 07/10/2026)", () => {
  assert.equal(parseDateSlot("2026-10-08", TODAY), "2026-10-08");
  assert.equal(parseDateSlot("XXXX-10-20", TODAY), "2026-10-20");
  assert.equal(parseDateSlot("XXXX-XX-15", TODAY), "2026-10-15");
  assert.equal(parseDateSlot("XXXX-XX-03", TODAY), "2026-11-03", "dia do mês já passado -> próximo mês");
  assert.equal(parseDateSlot("2026-10-01", TODAY), "2027-10-01", "sem ano e já passou -> próxima ocorrência");
  assert.equal(parseDateSlot("XXXX-02-29", TODAY), "2028-02-29", "29/02 espera o ano bissexto");
  assert.equal(parseDateSlot("2026-W41-5", TODAY), "2026-10-09", "sexta");
  assert.equal(parseDateSlot("sexta-feira", TODAY), "2026-10-09");
  assert.equal(parseDateSlot("segunda", TODAY), "2026-10-12");
  assert.equal(parseDateSlot("quarta", TODAY), TODAY, "o próprio dia conta");
  assert.equal(parseDateSlot("dia 15", TODAY), "2026-10-15");
  assert.equal(parseDateSlot("20 de outubro", TODAY), "2026-10-20");
  assert.equal(parseDateSlot("2026-10", TODAY), null);
  assert.equal(parseDateSlot("2026-02-30", TODAY), null);
  assert.equal(parseDateSlot("", TODAY), null);
  assert.equal(nextWeekday(6, TODAY), "2026-10-10");
  assert.equal(dateSpoken("2026-10-09", TODAY), "na sexta-feira, dia 9 de outubro");
  assert.equal(dateSpoken("2026-10-10", TODAY), "no sábado, dia 10 de outubro");
  assert.equal(resolvePeriod("d:2026-10-08", TODAY).startDate, "2026-10-08");
  assert.deepEqual(agendaRange("d:2026-10-20", TODAY), { startDate: "2026-10-20", endDate: "2026-10-20" });
});

test("agenda por data: dia 8 de outubro, sexta-feira, dia 15, no dia seguinte e primeira", async () => {
  const say = conversation({ "d:2026-10-08": TOMORROW, "d:2026-10-09": [{ at: "2026-10-09T13:00:00Z", type: "reuniao", title: "", clientName: "Ana", clientId: "9" }], "d:2026-10-15": [], "d:2026-10-20": [] });
  assert.equal(
    await say("AgendaDataIntent", { data: { value: "2026-10-08" } }),
    "Na quinta-feira, dia 8 de outubro, você tem 3 atividades. Às 9 horas, reunião com João. Às 14 horas, retorno para Maria. E às 16 horas, documentação de Carlos."
  );
  assert.equal(await say("PrimeiraIntent"), "A primeira é às 9 horas, reunião com João.");
  assert.equal(await say("DiaSeguinteIntent"), "Na sexta-feira, dia 9 de outubro, você tem 1 atividade. Às 10 horas, reunião com Ana.");
  assert.equal(await say("DiaAnteriorIntent"), "Na quinta-feira, dia 8 de outubro, você tem 3 atividades. Às 9 horas, reunião com João. Às 14 horas, retorno para Maria. E às 16 horas, documentação de Carlos.");
  assert.equal(await say("AgendaDataIntent", { data: { value: "sexta-feira" } }), "Na sexta-feira, dia 9 de outubro, você tem 1 atividade. Às 10 horas, reunião com Ana.");
  assert.equal(await say("AgendaDataIntent", { data: { value: "XXXX-XX-15" } }), "Você não tem nenhuma atividade agendada para quinta-feira, dia 15 de outubro.");
  assert.equal(await say("AgendaDataIntent", { data: { value: "XXXX-10-20" } }), "Você não tem nenhuma atividade agendada para terça-feira, dia 20 de outubro.");
  assert.equal(await say("AgendaDataIntent", { data: { value: "2026-10" } }), "Não entendi.");
  const noCtx = conversation({});
  assert.equal(await noCtx("DiaSeguinteIntent"), "Não entendi.");
});

test("modelo: intenção de data usa AMAZON.DATE e as frases naturais do pedido", () => {
  const model = buildInteractionModel({ brokers: [{ id: "i1", name: "Izabela", fullName: "Izabela Silvério" }] });
  assert.deepEqual(auditModel(model), []);
  const intents = model.interactionModel.languageModel.intents;
  assert.ok(!intents.find((intent) => intent.name === "AgendaDataIntent"), "uma única intenção de agenda");
  const date = intents.find((intent) => intent.name === "AgendaIntent");
  assert.deepEqual(date.slots, [{ name: "periodo", type: "PERIODO" }, { name: "data", type: "AMAZON.DATE" }, { name: "dia_semana", type: "DIA_SEMANA" }]);
  for (const sample of ["o que tenho agendado dia {data}", "quais atividades tenho em {data}", "o que tenho {data}", "tenho compromisso dia {data}", "qual minha agenda para {data}", "o que tenho agendado para {data}"]) assert.ok(date.samples.includes(sample), sample);
  assert.ok(intents.find((intent) => intent.name === "DiaSeguinteIntent").samples.includes("e no dia seguinte"));
});

// --- Dia da semana (slot próprio) e variações naturais do pedido -----------------------
const weekday = (id, value) => ({ value, resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { id, name: value } }] }] } });

test("dia da semana: sexta, próxima sexta, sábado, segunda, e o próprio dia (hoje = quarta 07/10/2026)", async () => {
  const friday = [{ at: "2026-10-09T13:00:00Z", type: "reuniao", title: "", clientName: "Ana", clientId: "9" }];
  const say = conversation({ "d:2026-10-09": friday, "d:2026-10-10": [], "d:2026-10-12": [], "d:2026-10-07": [], "d:2026-10-14": [] });
  const expected = "Na sexta-feira, dia 9 de outubro, você tem 1 atividade. Às 10 horas, reunião com Ana.";
  assert.equal(await say("AgendaIntent", { dia_semana: weekday("5", "sexta-feira") }), expected);
  assert.equal(await say("PrimeiraIntent"), "A primeira é às 10 horas, reunião com Ana.");
  assert.equal(await say("AgendaIntent", { dia_semana: weekday("5_proxima", "próxima sexta") }), expected);
  assert.equal(await say("AgendaIntent", { dia_semana: { value: "sexta" } }), expected, "sem resolução: texto falado");
  assert.equal(await say("AgendaIntent", { dia_semana: weekday("6", "sábado") }), "Você não tem nenhuma atividade agendada para sábado, dia 10 de outubro.");
  assert.equal(await say("AgendaIntent", { dia_semana: weekday("1", "segunda") }), "Você não tem nenhuma atividade agendada para segunda-feira, dia 12 de outubro.");
  assert.equal(await say("AgendaIntent", { dia_semana: weekday("3", "quarta") }), "Você não tem nenhuma atividade agendada para quarta-feira, dia 7 de outubro.");
  assert.equal(await say("AgendaIntent", { dia_semana: weekday("3_proxima", "quarta que vem") }), "Você não tem nenhuma atividade agendada para quarta-feira, dia 14 de outubro.");
  assert.equal(await say("DiaSeguinteIntent"), "Você não tem nenhuma atividade agendada para quinta-feira, dia 15 de outubro.");
});

test("contexto: 'e sábado?' e 'e no dia seguinte?' mantêm a agenda; data falada vence o dia da semana", async () => {
  const say = conversation({ "d:2026-10-09": [{ at: "2026-10-09T13:00:00Z", type: "ligacao", title: "", clientName: "Bia", clientId: "1" }], "d:2026-10-10": [{ at: "2026-10-10T14:00:00Z", type: "visita", title: "", clientName: "Caio", clientId: "2" }], "d:2026-10-11": [], "d:2026-10-08": TOMORROW });
  assert.match(await say("AgendaIntent", { dia_semana: weekday("5", "sexta") }), /ligação para Bia/);
  assert.match(await say("AgendaIntent", { dia_semana: weekday("6", "sábado") }), /No sábado, dia 10 de outubro, você tem 1 atividade\. Às 11 horas, visita com Caio/);
  assert.equal(await say("DiaSeguinteIntent"), "Você não tem nenhuma atividade agendada para domingo, dia 11 de outubro.");
  assert.match(await say("AgendaIntent", { data: { value: "2026-10-08" }, dia_semana: weekday("5", "sexta") }), /Na quinta-feira, dia 8 de outubro/);
});

test("modelo: dia da semana e frases naturais do pedido existem na intenção de agenda", () => {
  const model = buildInteractionModel({ brokers: [{ id: "i1", name: "Izabela", fullName: "Izabela Silvério" }] });
  assert.deepEqual(auditModel(model), []);
  const language = model.interactionModel.languageModel;
  const agenda = language.intents.find((intent) => intent.name === "AgendaIntent");
  const wanted = [
    "quais atividades eu tenho agendadas na {dia_semana}", "quais atividades tenho {dia_semana}", "o que eu tenho agendado {dia_semana}", "o que tenho na {dia_semana}",
    "minha agenda de {dia_semana}", "minha agenda para {dia_semana}", "quais compromissos tenho {dia_semana}", "tenho alguma coisa marcada {dia_semana}",
    "tenho algo agendado para {dia_semana}", "o que está marcado para {dia_semana}", "quais reuniões tenho {dia_semana}", "como está minha agenda {dia_semana}",
    "e {dia_semana}", "e na {dia_semana}", "e dia {data}", "minha agenda dia {data}", "o que tenho agendado para {data}", "quais atividades eu tenho agendadas para {periodo}"
  ];
  for (const sample of wanted) assert.ok(agenda.samples.includes(sample), sample);
  const week = language.types.find((type) => type.name === "DIA_SEMANA").values;
  assert.equal(week.length, 14);
  const sexta = week.find((value) => value.id === "5");
  assert.ok(sexta.name.synonyms.includes("sexta"));
  const proxima = week.find((value) => value.id === "5_proxima");
  assert.ok(proxima.name.synonyms.includes("sexta que vem") && proxima.name.synonyms.includes("próxima sexta"));
  assert.ok(week.find((value) => value.id === "6").name.value === "sábado");
});
