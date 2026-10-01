import test from "node:test";
import assert from "node:assert/strict";
import { handleSkillRequestV2 } from "../lib/alexa-v2/router.mjs";
import { makeBrokerMatcher } from "../lib/alexa-v2/brokers.mjs";
import { deriveCorretor } from "../lib/alexa-v2/providers/corretor-core.mjs";
import { auditModel, brokerSlotValues, buildInteractionModel } from "../lib/alexa-v2/model-core.mjs";
import { aggregateBrokerStatus, sumStatuses } from "../lib/crm-metrics/broker-stock-core.mjs";
import { slimOverview } from "../lib/crm-metrics/overview-core.mjs";
import { brokerPosition, composeBrokerSummary, findBrokerMeta, rankByMeasure } from "../lib/alexa-v2/medidas.mjs";

const SKILL = "amzn1.ask.skill.test";
const TODAY = "2026-10-07";

const row = (id, name, fullName, gender, extra) => ({
  id, name, fullName, gender, role: "broker",
  newClients: 0, prospecting: 0, service: 0, simulation: 0, documentation: 0, approvalPending: 0, approval: 0, meeting: 0, sale: 0,
  completedActivities: 0, overdueActivities: 0, awaitingAction: 0, staleContact: 0, noFutureActivity: 0, points: 0,
  ...extra
});

// Formato idêntico ao cache de Desempenho (slimOverview).
const OVERVIEW = {
  range: { startDate: TODAY, endDate: TODAY },
  metrics: { newClients: 20, prospecting: 99, service: 11, simulation: 6, approvalPending: 3, approval: 2, sale: 1 },
  funnel: { documentation: 5, meeting: 2 },
  attention: { overdueActivities: 7, awaitingAction: 9, staleContact: 3, noFutureActivity: 4 },
  team: [
    row("i1", "Izabela", "Izabela Silvério", "female", { prospecting: 34, service: 6, simulation: 3, documentation: 2, approvalPending: 1, approval: 1, meeting: 1, points: 185, overdueActivities: 2, awaitingAction: 4 }),
    row("b1", "Bruna", "Bruna Souza", "female", { prospecting: 50, service: 4, simulation: 2, sale: 1, points: 210, overdueActivities: 0, awaitingAction: 1 }),
    row("e1", "Eduardo", "Eduardo Lima", "male", { prospecting: 15, service: 1, simulation: 1, points: 90, overdueActivities: 5, awaitingAction: 4 }),
    { ...row("m1", "Gerente", "Gerente Teste", "", { prospecting: 0, points: 10 }), role: "manager" }
  ],
  ranking: [{ id: "b1", name: "Bruna", points: 210 }, { id: "i1", name: "Izabela", points: 185 }, { id: "e1", name: "Eduardo", points: 90 }]
};
const GOAL = {
  summary: { metaPercent: 70 },
  brokers: [
    { id: "i1", name: "Izabela", percent: 82, done: 41, total: 50, prospectingDone: 34, prospectingTarget: 40 },
    { id: "b1", name: "Bruna", percent: 120, done: 60, total: 50, prospectingDone: 50, prospectingTarget: 40 },
    { id: "e1", name: "Eduardo", percent: 30, done: 15, total: 50, prospectingDone: 15, prospectingTarget: 40 }
  ]
};

const ROSTER = [
  { id: "i1", name: "Izabela", fullName: "Izabela Silvério", gender: "female" },
  { id: "b1", name: "Bruna", fullName: "Bruna Souza", gender: "female" },
  { id: "e1", name: "Eduardo", fullName: "Eduardo Lima", gender: "male" }
];

const slot = (value, id) => ({ value, ...(id ? { resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { id, name: value } }] }] } } : {}) });
const envelope = (intent, slots = {}, attributes = {}) => ({
  session: { new: false, application: { applicationId: SKILL }, user: { userId: "u" }, attributes },
  request: { type: "IntentRequest", intent: { name: intent, slots } }
});

function deps() {
  return {
    today: () => TODAY,
    brokers: makeBrokerMatcher(ROSTER),
    legacyDeps: {},
    providers: {
      corretor: async (q) => deriveCorretor(q, { overview: OVERVIEW, goal: GOAL, meetings: 1, compromissos: 3 }),
      etapa: async (q) => ({ count: q.corretorId ? 3 : 40, items: [{ name: "João" }] }),
      agenda: async () => ({ count: 1, items: [{ hours: 10, minutes: 0, client: "João" }] })
    }
  };
}

// Conversa: guarda os atributos de sessão entre as falas, como a Alexa.
function conversation() {
  let attributes = {};
  const d = deps();
  return async (intent, slots) => {
    const result = await handleSkillRequestV2(envelope(intent, slots, attributes), d);
    attributes = result.sessionAttributes;
    return result.response.outputSpeech.text;
  };
}

test("catálogo de corretores: primeiro nome, nome completo, apelido e ambíguo", () => {
  const matcher = makeBrokerMatcher([...ROSTER, { id: "k1", name: "Ketlin", fullName: "Ketlin Santos", gender: "female" }]);
  assert.equal(matcher.match("Izabela").id, "i1");
  assert.equal(matcher.match("Izabela Silvério").id, "i1");
  assert.equal(matcher.match("a izabela silverio souza").id, "i1");
  assert.equal(matcher.match("Isabela").id, "i1"); // apelido do catálogo central
  assert.equal(matcher.match("Kathleen").id, "k1");
  assert.equal(matcher.match("Eduarda"), null); // não "adivinha"
  assert.equal(matcher.byId("b1").name, "Bruna");
  const dup = makeBrokerMatcher([{ id: "1", name: "Ana", fullName: "Ana Lima" }, { id: "2", name: "Ana", fullName: "Ana Souza" }]);
  assert.equal(dup.match("Ana"), null);
  assert.equal(dup.match("Ana Souza").id, "2");
});

test("resumo individual: meta, movimento só do que tem número, venda, agenda e ranking", () => {
  const summary = composeBrokerSummary({
    name: "Izabela", gender: "female", periodId: "hoje", periodoSpoken: "hoje", row: OVERVIEW.team[0],
    meta: findBrokerMeta(GOAL, { id: "i1" }), position: brokerPosition(OVERVIEW, { id: "i1" }), meetings: 1
  });
  assert.match(summary, /^Hoje a Izabela está com 82 por cento da meta diária\. Faltam 9 ações para concluir\./);
  assert.match(summary, /Fez 34 prospecções, iniciou 6 atendimentos, levou 3 clientes para simulação/);
  assert.match(summary, /Ainda não registrou venda hoje\./);
  assert.match(summary, /Tem 1 reunião hoje\./);
  assert.match(summary, /No ranking do dia está em 2º lugar, com 185 pontos\./);
  assert.ok(!/ 0 /.test(summary), "não fala métrica zerada");
  const bruna = composeBrokerSummary({ name: "Bruna", gender: "female", periodId: "hoje", periodoSpoken: "hoje", row: OVERVIEW.team[1], meta: findBrokerMeta(GOAL, { id: "b1" }), position: brokerPosition(OVERVIEW, { id: "b1" }) });
  assert.match(bruna, /^Hoje a Bruna bateu a meta diária, com 120 por cento\./);
  assert.match(bruna, /registrou 1 venda/);
});

test("conversa: dia da Izabela -> e ontem -> quantas simulações -> e a Bruna", async () => {
  const say = conversation();
  const first = await say("CorretorIntent", { corretor: slot("Izabela Silvério", "i1") });
  assert.match(first, /^Hoje a Izabela está com 82 por cento/);
  const yesterday = await say("ContinuaIntent", { periodo: slot("ontem", "ontem") });
  assert.match(yesterday, /^Ontem a Izabela fechou com 82 por cento da meta diária/);
  const sims = await say("ConsultarIntent", { assunto: slot("simulações", "med_simulacoes") });
  assert.equal(sims, "A Izabela levou 3 clientes para simulação ontem.");
  const bruna = await say("ContinuaIntent", { corretor: slot("Bruna", "b1") });
  assert.equal(bruna, "A Bruna levou 2 clientes para simulação ontem.");
  const eduardo = await say("ContinuaIntent", { corretor: slot("o Eduardo") });
  assert.equal(eduardo, "O Eduardo levou 1 cliente para simulação ontem.");
});

test("meta por corretor com a regra da Meta Diária (percentual, faltam, bateu)", async () => {
  const say = conversation();
  assert.equal(await say("ConsultarIntent", { assunto: slot("meta", "meta_equipe"), corretor: slot("Izabela", "i1") }), "A Izabela está com 82 por cento da meta hoje. Faltam 9 ações para concluir.");
  assert.equal(await say("ContinuaIntent", { corretor: slot("Eduardo", "e1") }), "O Eduardo está com 30 por cento da meta hoje. Faltam 35 ações para concluir.");
  assert.equal(await say("ContinuaIntent", { corretor: slot("Bruna", "b1") }), "A Bruna bateu a meta hoje, com 120 por cento.");
  assert.equal(await say("ConsultarIntent", { assunto: slot("bateu a meta", "meta_bateram"), corretor: slot("Izabela", "i1") }), "Ainda não. A Izabela está com 82 por cento da meta hoje.");
  assert.equal(await say("ConsultarIntent", { assunto: slot("prospecções que faltam", "prospeccao_faltam"), corretor: slot("Izabela", "i1") }), "Faltam 6 prospecções para a Izabela cumprir a meta de hoje: 34 de 40.");
});

test("desempenho detalhado e posição no ranking por corretor", async () => {
  const say = conversation();
  assert.equal(await say("ConsultarIntent", { assunto: slot("prospecções", "prospeccao_equipe"), corretor: slot("Izabela", "i1") }), "A Izabela fez 34 prospecções hoje.");
  assert.equal(await say("ConsultarIntent", { assunto: slot("vendas", "vendas") }), "A Izabela ainda não registrou venda hoje.");
  assert.equal(await say("ConsultarIntent", { assunto: slot("posição no ranking", "posicao_ranking") }), "A Izabela está em 2º lugar no ranking de hoje, com 185 pontos.");
  assert.equal(await say("ConsultarIntent", { assunto: slot("atividades atrasadas", "atividades_atrasadas") }), "A Izabela tem 2 atividades atrasadas.");
  assert.equal(await say("ConsultarIntent", { assunto: slot("clientes aguardando ação", "acao_pendente"), corretor: slot("Bruna", "b1") }), "A Bruna tem 1 cliente aguardando ação.");
});

test("estoque x movimentação: 'estão em' usa o estoque; 'levou para' usa o Desempenho", async () => {
  const say = conversation();
  assert.equal(await say("ConsultarIntent", { etapa: slot("aprovação", "aprovacao"), corretor: slot("Izabela", "i1") }), "A Izabela tem 3 clientes aguardando aprovação.");
  assert.equal(await say("ConsultarIntent", { assunto: slot("clientes para aprovação", "med_aprovacao"), corretor: slot("Izabela", "i1") }), "A Izabela levou 1 cliente para aprovação hoje.");
});

test("agenda do corretor e contexto de pronome", async () => {
  const say = conversation();
  assert.equal(await say("ConsultarIntent", { assunto: slot("reuniões", "agenda"), corretor: slot("Izabela", "i1") }), "A Izabela tem 1 reunião hoje.");
  assert.equal(await say("ListarIntent", {}), "10 horas com João.");
  assert.equal(await say("ConsultarIntent", { assunto: slot("compromissos", "compromissos") }), "A Izabela tem 3 compromissos hoje.");
});

test("assunto do time não herda o corretor; sem corretor a resposta é da equipe", async () => {
  const say = conversation();
  await say("CorretorIntent", { corretor: slot("Izabela", "i1") });
  const team = await say("ConsultarIntent", { assunto: slot("quem bateu a meta", "meta_bateram") });
  assert.doesNotMatch(team, /Izabela está/);
  const fresh = conversation();
  assert.equal(await fresh("ConsultarIntent", { assunto: slot("simulações", "med_simulacoes") }), "A equipe levou 6 clientes para simulação hoje.");
  assert.equal(await fresh("ConsultarIntent", { assunto: slot("documentações", "med_documentacao") }), "A equipe levou 5 clientes para documentação hoje.");
});

test("gerencial: quem fez mais, quem tem atividade atrasada", async () => {
  const say = conversation();
  assert.equal(await say("ListarIntent", { assunto: slot("prospecções feitas", "med_prospeccoes") }), "Bruna, 50; Izabela, 34; Eduardo, 15.");
  assert.equal(await say("ListarIntent", { assunto: slot("atividades atrasadas", "atividades_atrasadas") }), "Eduardo, 5; Izabela, 2.");
  assert.equal(await say("ListarIntent", { assunto: slot("simulações", "med_simulacoes") }), "Izabela, 3; Bruna, 2; Eduardo, 1.");
  assert.deepEqual(rankByMeasure(OVERVIEW, "vendas"), [{ name: "Bruna", count: 1 }]);
});

test("comparação objetiva entre dois corretores", async () => {
  const say = conversation();
  assert.equal(await say("CompararIntent", { corretor: slot("Izabela", "i1"), outro_corretor: slot("Bruna", "b1"), assunto: slot("prospecções feitas", "med_prospeccoes") }), "Hoje, Izabela: 34 prospecções. Bruna: 50 prospecções.");
  const meta = await say("CompararIntent", { corretor: slot("Izabela", "i1"), outro_corretor: slot("Eduardo", "e1"), assunto: slot("meta", "meta_equipe") });
  assert.equal(meta, "Hoje, Izabela: 82 por cento da meta. Eduardo: 30 por cento da meta.");
  const general = await say("CompararIntent", { corretor: slot("Izabela", "i1"), outro_corretor: slot("Bruna", "b1") });
  assert.match(general, /^Hoje, Izabela: 82 por cento da meta, 34 prospecções, 0 vendas\. Bruna: 120 por cento da meta, 50 prospecções, 1 venda\.$/);
  assert.match(await say("CompararIntent", { corretor: slot("Izabela", "i1") }), /Quais corretores/);
});

test("corretor desconhecido e período sem fonte confiável", async () => {
  const say = conversation();
  assert.equal(await say("CorretorIntent", { corretor: slot("Zeca") }), "Não encontrei o corretor Zeca.");
  await say("CorretorIntent", { corretor: slot("Izabela", "i1") });
  assert.equal(await say("ContinuaIntent", { assunto: slot("meta", "meta_equipe"), periodo: slot("esta semana", "esta_semana") }), "Isso eu só sei para hoje e ontem.");
});

test("equipe: resumo gerencial", async () => {
  const d = deps();
  d.providers.corretor = async (q) => deriveCorretor(q, { overview: OVERVIEW, goal: GOAL, online: 3 });
  const result = await handleSkillRequestV2(envelope("ConsultarIntent", { assunto: slot("minha equipe", "equipe_resumo") }), d);
  const speech = result.response.outputSpeech.text;
  assert.match(speech, /^A equipe está com 70 por cento da meta de hoje\. 1 corretor já bateu a meta\./);
  assert.match(speech, /Hoje foram 99 prospecções, 6 simulações e 1 venda\./);
  assert.match(speech, /3 corretores online agora\./);
});

test("estoque por corretor: agregação e soma por etapa", () => {
  const stock = aggregateBrokerStatus(
    [
      { responsible_user_id: "i1", status: "approval_pending", total: 3 },
      { responsible_user_id: "i1", status: "in_service", total: 5 },
      { responsible_user_id: "i1", status: "status_estranho", total: 2 },
      { responsible_user_id: null, status: "in_service", total: 9 }
    ],
    (status) => (status === "status_estranho" ? "pending" : status)
  );
  assert.deepEqual(stock.byBroker.i1, { approval_pending: 3, in_service: 5, pending: 2 });
  assert.equal(stock.byBroker[""], undefined);
  assert.equal(sumStatuses(stock.byBroker.i1, ["pending", "approval_pending"]), 5);
});

test("cache reduzido guarda os campos por corretor do Desempenho", () => {
  const slim = slimOverview({
    range: {}, metrics: {}, funnel: [{ key: "documentation", value: 7 }, { key: "meeting", value: 2 }], attention: { overdueActivities: 3 },
    team: [{ profile: { id: "i1", name: "izabela silvério souza", role: "broker", gender: "female" }, service: 6, simulation: 3, documentation: 2, approvalPending: 1, approval: 1, meeting: 1, overdueActivities: 2, points: 5 }],
    ranking: []
  });
  assert.equal(slim.team[0].name, "Izabela");
  assert.equal(slim.team[0].fullName, "izabela silvério souza");
  assert.equal(slim.team[0].simulation, 3);
  assert.equal(slim.team[0].overdueActivities, 2);
  assert.deepEqual(slim.funnel, { documentation: 7, meeting: 2 });
  assert.equal(slim.attention.overdueActivities, 3);
});

test("modelo de voz: gerado do catálogo central, sem repetições e com os corretores do cadastro", () => {
  const model = buildInteractionModel({ brokers: ROSTER });
  assert.deepEqual(auditModel(model), []);
  const language = model.interactionModel.languageModel;
  assert.equal(language.invocationName, "central");
  const corretores = language.types.find((type) => type.name === "CORRETOR").values;
  const izabela = corretores.find((value) => value.id === "i1");
  assert.equal(izabela.name.value, "Izabela");
  assert.ok(izabela.name.synonyms.includes("Izabela Silvério"));
  assert.ok(izabela.name.synonyms.includes("Isabela"));
  const intents = language.intents.map((intent) => intent.name);
  for (const name of ["ConsultarIntent", "CorretorIntent", "CompararIntent", "ListarIntent", "ContinuaIntent", "MaisIntent", "ResumoDoDiaIntent", "AguardandoSimulacaoIntent"]) assert.ok(intents.includes(name), name);
  // dois corretores com o mesmo primeiro nome: o valor vira o nome completo
  const twins = brokerSlotValues([{ id: "1", name: "Ana", fullName: "Ana Lima" }, { id: "2", name: "Ana", fullName: "Ana Souza" }]);
  assert.deepEqual(twins.map((value) => value.name.value), ["Ana Lima", "Ana Souza"]);
});

test("modelo de voz recebe as variantes ACENTUADAS dos apelidos e o ranking fala 'da semana'", async () => {
  const { accentize } = await import("../lib/alexa-v2/model-core.mjs");
  const { rankingLabel } = await import("../lib/alexa-v2/medidas.mjs");
  assert.equal(accentize("prospeccoes feitas"), "prospecções feitas");
  assert.equal(accentize("posicao no ranking"), "posição no ranking");
  const model = buildInteractionModel({ brokers: ROSTER });
  const assunto = model.interactionModel.languageModel.types.find((type) => type.name === "ASSUNTO").values.find((value) => value.id === "prospeccao_equipe");
  assert.ok(assunto.name.synonyms.includes("prospecções"));
  assert.equal(rankingLabel("esta_semana", "esta semana"), "da semana");
  assert.equal(rankingLabel("este_mes", "este mês"), "do mês");
  assert.equal(rankingLabel("hoje", "hoje"), "do dia");
});

test("ranking por métrica (time) mesmo com um corretor na conversa", async () => {
  const say = conversation();
  await say("CorretorIntent", { corretor: slot("Izabela", "i1") });
  assert.equal(await say("ListarIntent", { assunto: slot("atendimentos", "med_atendimentos"), periodo: slot("hoje", "hoje") }), "Izabela, 6; Bruna, 4; Eduardo, 1.");
  assert.equal(await say("ListarIntent", { assunto: slot("simulações", "med_simulacoes") }), "Izabela, 3; Bruna, 2; Eduardo, 1.");
  assert.equal(await say("ListarIntent", { assunto: slot("documentação", "med_documentacao") }), "Izabela, 2.");
  assert.equal(await say("ListarIntent", { assunto: slot("aprovação", "med_aprovacao") }), "Izabela, 1.");
  // "qual corretor ..." pelo texto da fala vira lista de ranking (sem herdar o corretor da conversa)
  assert.equal(await say("ConsultarIntent", { assunto: { ...slot("atendimentos", "med_atendimentos"), value: "qual corretor mais fez atendimentos" } }), "Izabela, 6; Bruna, 4; Eduardo, 1.");
  const fresh = conversation();
  assert.equal(await fresh("ConsultarIntent", { assunto: { ...slot("atendimentos", "med_atendimentos"), value: "qual corretor mais fez atendimentos" } }), "Izabela, 6; Bruna, 4; Eduardo, 1.");
});

test("ranking com nenhum resultado e vendas atribuídas", async () => {
  const say = conversation();
  assert.equal(await say("ListarIntent", { assunto: slot("vendas feitas", "med_vendas") }), "Bruna, 1.");
  assert.equal(await say("ListarIntent", { assunto: slot("reuniões realizadas", "med_reunioes") }), "Izabela, 1.");
  const d = deps();
  d.providers.corretor = async (q) => deriveCorretor(q, { overview: { ...OVERVIEW, team: OVERVIEW.team.map((r) => ({ ...r, approvalPending: 0 })) }, goal: GOAL });
  const empty = await handleSkillRequestV2(envelope("ListarIntent", { assunto: slot("clientes para aprovação", "med_aprovacao") }), d);
  assert.equal(empty.response.outputSpeech.text, "Ninguém levou cliente para aprovação hoje.");
});
