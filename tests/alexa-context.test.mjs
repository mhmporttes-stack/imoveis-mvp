import test from "node:test";
import assert from "node:assert/strict";
import { handleSkillRequestV2 } from "../lib/alexa-v2/router.mjs";
import { makeBrokerMatcher } from "../lib/alexa-v2/brokers.mjs";
import { deriveCorretor } from "../lib/alexa-v2/providers/corretor-core.mjs";
import { buildActivityItems } from "../lib/alexa-v2/providers/activities-core.mjs";

// Sequências completas alternando Agenda, corretor, métrica e período (hoje = quarta 07/10/2026).
const TODAY = "2026-10-07";
const SKILL = "amzn1.ask.skill.test";

const row = (id, name, fullName, gender, extra) => ({
  id, name, fullName, gender, role: "broker",
  newClients: 0, prospecting: 0, service: 0, simulation: 0, documentation: 0, approvalPending: 0, approval: 0, meeting: 0, sale: 0,
  completedActivities: 0, overdueActivities: 0, awaitingAction: 0, staleContact: 0, noFutureActivity: 0, points: 0, ...extra
});
const OVERVIEW = {
  metrics: { newClients: 9, prospecting: 99, service: 11, simulation: 6, approvalPending: 3, approval: 2, sale: 1 },
  funnel: { documentation: 5, meeting: 2 },
  attention: { overdueActivities: 7, awaitingAction: 9, staleContact: 3, noFutureActivity: 4 },
  team: [
    row("i1", "Izabela", "Izabela Silvério", "female", { prospecting: 34, service: 6, simulation: 3, points: 185 }),
    row("b1", "Bruna", "Bruna Souza", "female", { prospecting: 50, service: 4, simulation: 2, sale: 1, points: 210 }),
    row("e1", "Eduardo", "Eduardo Lima", "male", { prospecting: 15, service: 1, simulation: 1, points: 90 })
  ],
  ranking: [{ id: "b1", name: "Bruna", points: 210 }, { id: "i1", name: "Izabela", points: 185 }, { id: "e1", name: "Eduardo", points: 90 }]
};
// ontem e a semana têm números diferentes para provar que só o período mudou
const BY_PERIOD = {
  hoje: OVERVIEW,
  ontem: { ...OVERVIEW, team: OVERVIEW.team.map((r) => ({ ...r, simulation: r.simulation + 10, service: r.service + 10 })) },
  esta_semana: { ...OVERVIEW, team: OVERVIEW.team.map((r) => ({ ...r, simulation: r.simulation + 20, service: r.service + 20 })) }
};
const GOAL = { summary: { metaPercent: 70 }, brokers: [{ id: "i1", name: "Izabela", percent: 82, done: 41, total: 50, prospectingDone: 34, prospectingTarget: 40 }] };
const ROSTER = [
  { id: "i1", name: "Izabela", fullName: "Izabela Silvério", gender: "female" },
  { id: "b1", name: "Bruna", fullName: "Bruna Souza", gender: "female" },
  { id: "e1", name: "Eduardo", fullName: "Eduardo Lima", gender: "male" }
];
const FRIDAY = [{ at: "2026-10-09T13:00:00Z", type: "reuniao", title: "", clientName: "Ana", clientId: "9" }];

const slot = (value, id) => ({ value, ...(id ? { resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { id, name: value } }] }] } } : {}) });

function conversation() {
  let attributes = {};
  const deps = {
    today: () => TODAY,
    brokers: makeBrokerMatcher(ROSTER),
    legacyDeps: {},
    providers: {
      corretor: async (q) => deriveCorretor(q, { overview: BY_PERIOD[q.periodo] || OVERVIEW, goal: GOAL, meetings: 0 }),
      agenda: async (q) => ({ items: buildActivityItems(q.periodo === "d:2026-10-09" ? FRIDAY : [], { today: TODAY }), multiDay: false }),
      etapa: async () => ({ count: 4, items: [] })
    }
  };
  return async (intent, slots = {}) => {
    const result = await handleSkillRequestV2({
      session: { new: false, application: { applicationId: SKILL }, user: { userId: "u" }, attributes },
      request: { type: "IntentRequest", intent: { name: intent, slots } }
    }, deps);
    attributes = result.sessionAttributes;
    return { text: result.response.outputSpeech.text, reprompt: result.response.reprompt?.outputSpeech?.text, end: result.response.shouldEndSession, ctx: attributes.v2 };
  };
}

const wd = (id, value) => slot(value, id);

test("Agenda -> Agenda: 'e no sábado?' mantém a agenda e troca só a data", async () => {
  const say = conversation();
  assert.match((await say("AgendaIntent", { dia_semana: wd("5", "sexta") })).text, /^Na sexta-feira, dia 9 de outubro, você tem 1 atividade/);
  const next = await say("AgendaIntent", { dia_semana: wd("6", "sábado") });
  assert.equal(next.text, "Você não tem nenhuma atividade agendada para sábado, dia 10 de outubro.");
  assert.equal(next.ctx.topic, "minha_agenda");
  assert.equal(next.ctx.domain, "agenda");
});

test("Agenda -> desempenho do corretor -> ontem (pergunta nova completa vence o contexto)", async () => {
  const say = conversation();
  await say("AgendaIntent", { dia_semana: wd("5", "sexta") });
  const edu = await say("ConsultarIntent", { assunto: slot("simulações", "med_simulacoes"), corretor: slot("Eduardo", "e1"), periodo: slot("hoje", "hoje") });
  assert.equal(edu.text, "O Eduardo levou 1 cliente para simulação hoje.");
  assert.equal(edu.ctx.domain, "corretor");
  const ontem = await say("ContinuaIntent", { periodo: slot("ontem", "ontem") });
  assert.equal(ontem.text, "O Eduardo levou 11 clientes para simulação ontem.", "mantém Eduardo + simulações; só o período muda");
});

test("corretor -> outro corretor -> outra métrica -> outro período", async () => {
  const say = conversation();
  assert.equal((await say("ConsultarIntent", { assunto: slot("atendimentos", "med_atendimentos"), corretor: slot("Bruna", "b1"), periodo: slot("hoje", "hoje") })).text, "A Bruna iniciou 4 atendimentos hoje.");
  assert.equal((await say("ContinuaIntent", { corretor: slot("Izabela", "i1") })).text, "A Izabela iniciou 6 atendimentos hoje.");
  assert.equal((await say("ContinuaIntent", { assunto: slot("simulações", "med_simulacoes") })).text, "A Izabela levou 3 clientes para simulação hoje.");
  assert.equal((await say("ContinuaIntent", { periodo: slot("esta semana", "esta_semana") })).text, "A Izabela levou 23 clientes para simulação esta semana.");
});

test("hoje -> ontem -> semana no resumo do corretor", async () => {
  const say = conversation();
  assert.match((await say("CorretorIntent", { corretor: slot("Izabela", "i1") })).text, /^Hoje a Izabela está com 82 por cento/);
  assert.match((await say("ContinuaIntent", { periodo: slot("ontem", "ontem") })).text, /^Ontem a Izabela fechou com 82 por cento da meta diária\. Fez 34 prospecções, iniciou 16 atendimentos/);
  assert.match((await say("ContinuaIntent", { periodo: slot("esta semana", "esta_semana") })).text, /^Esta semana a Izabela fez 34 prospecções, iniciou 26 atendimentos/);
});

test("pergunta nova sobre o dia do corretor não herda semana/ontem da conversa", async () => {
  const say = conversation();
  await say("CorretorIntent", { corretor: slot("Izabela", "i1") });
  assert.match((await say("ContinuaIntent", { periodo: slot("esta semana", "esta_semana") })).text, /^Esta semana a Izabela/);
  assert.match((await say("CorretorIntent", { corretor: slot("Izabela", "i1") })).text, /^Hoje a Izabela está com 82 por cento/);
});

test("desempenho -> Agenda: a data nova leva para a agenda mesmo com corretor na conversa", async () => {
  const say = conversation();
  await say("CorretorIntent", { corretor: slot("Izabela", "i1") });
  const agenda = await say("AgendaIntent", { dia_semana: wd("5", "sexta") });
  assert.equal(agenda.text, "Na sexta-feira, dia 9 de outubro, você tem 1 atividade. Às 10 horas, reunião com Ana.");
  assert.equal(agenda.ctx.topic, "minha_agenda");
  // "e a Bruna?" sobre a agenda pessoal não tem fonte segura
  assert.equal((await say("ContinuaIntent", { corretor: slot("Bruna", "b1") })).text, "Não entendi.");
  // ...mas uma pergunta nova de desempenho volta a funcionar
  assert.equal((await say("ConsultarIntent", { assunto: slot("atendimentos", "med_atendimentos"), corretor: slot("Bruna", "b1") })).text, "A Bruna iniciou 4 atendimentos hoje.");
});

test("lista (ranking) -> 'e a Izabela?' vira o número dela, mantendo a métrica", async () => {
  const say = conversation();
  assert.equal((await say("ListarIntent", { assunto: slot("simulações", "med_simulacoes") })).text, "Izabela, 3; Bruna, 2; Eduardo, 1.");
  assert.equal((await say("ContinuaIntent", { corretor: slot("Izabela", "i1") })).text, "A Izabela levou 3 clientes para simulação hoje.");
  // e de volta ao time com um assunto novo em lista
  assert.equal((await say("ListarIntent", { assunto: slot("atendimentos", "med_atendimentos") })).text, "Izabela, 6; Bruna, 4; Eduardo, 1.");
});

test("sem contexto suficiente: só 'Não entendi.' (sem exemplos, opções ou ajuda) e a sessão continua aberta", async () => {
  const cases = [
    ["ContinuaIntent", { corretor: slot("Izabela", "i1") }],
    ["ContinuaIntent", { periodo: slot("ontem", "ontem") }],
    ["ContinuaIntent", {}],
    ["ConsultarIntent", {}],
    ["ListarIntent", {}],
    ["MaisIntent", {}],
    ["PrimeiraIntent", {}],
    ["UltimaIntent", {}],
    ["DiaSeguinteIntent", {}],
    ["CompararIntent", { corretor: slot("Izabela", "i1") }],
    ["AgendaIntent", { data: { value: "2026-10" } }],
    ["ConsultarIntent", { corretor: slot("Zeca") }]
  ];
  for (const [intent, slots] of cases) {
    const say = conversation();
    const answer = await say(intent, slots);
    if (intent === "ConsultarIntent" && slots.corretor) {
      assert.equal(answer.text, "Não entendi."); // sem assunto nem contexto
    } else {
      assert.equal(answer.text, "Não entendi.", `${intent} ${JSON.stringify(slots)}`);
    }
    assert.equal(answer.reprompt, undefined, "não repete o texto nem oferece ajuda");
    assert.equal(answer.end, false);
  }
});

test("FallbackIntent (global) responde só 'Não entendi.' e preserva o contexto", async () => {
  const say = conversation();
  await say("CorretorIntent", { corretor: slot("Izabela", "i1") });
  const fallback = await say("AMAZON.FallbackIntent");
  assert.equal(fallback.text, "Não entendi.");
  assert.equal(fallback.reprompt, undefined);
  assert.equal(fallback.ctx?.corretor?.name, "Izabela", "o contexto continua para a próxima pergunta");
  assert.match((await say("ContinuaIntent", { periodo: slot("ontem", "ontem") })).text, /^Ontem a Izabela/);
});

test("nenhuma resposta de erro/fallback traz lista de opções ou exemplos", async () => {
  const say = conversation();
  const texts = [];
  for (const [intent, slots] of [["ConsultarIntent", {}], ["MaisIntent", {}], ["PrimeiraIntent", {}], ["AMAZON.FallbackIntent", {}], ["ContinuaIntent", {}]]) texts.push((await say(intent, slots)).text);
  for (const text of texts) assert.doesNotMatch(text, /por exemplo|você pode pedir|diga|pergunte|simulação, documentação|opções/i);
});
