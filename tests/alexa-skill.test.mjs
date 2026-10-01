import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeSkillRequest,
  handleSkillRequest,
  joinNames,
  parseAllowedUserIds,
  spokenWhen,
  topicFromText
} from "../lib/alexa-skill-core.mjs";

const SKILL = "amzn1.ask.skill.test";
const USER = "amzn1.ask.account.USER1";
const config = { skillId: SKILL, allowedUserIds: parseAllowedUserIds(` ${USER} , outro `) };

const envelope = (request, attributes = {}) => ({
  session: { new: false, application: { applicationId: SKILL }, user: { userId: USER }, attributes },
  request
});
const intent = (name, slots = {}, attributes = {}) => envelope({ type: "IntentRequest", intent: { name, slots } }, attributes);
const text = (result) => result.response.outputSpeech.text;

const deps = {
  countByTopic: async (topic) => ({ simulacao: 6, documentacao: 1, aprovacao: 0 })[topic],
  namesByTopic: async (topic, limit) => ({ names: ["João", "Maria", "Pedro"].slice(0, limit), total: topic === "simulacao" ? 8 : 3 }),
  nextMeeting: async () => ({ dayOffset: 0, hours: 14, minutes: 0, weekdayName: "quinta-feira" }),
  daySummary: async () => "Bom dia, Matheus. Temos 6 clientes aguardando simulação."
};

test("autorização: skill e usuário corretos, tudo mais é negado", () => {
  assert.deepEqual(parseAllowedUserIds(" a, b ,,c "), ["a", "b", "c"]);
  assert.equal(authorizeSkillRequest(intent("X"), config).ok, true);
  const otherSkill = intent("X");
  otherSkill.session.application.applicationId = "amzn1.ask.skill.outra";
  assert.equal(authorizeSkillRequest(otherSkill, config).reason, "skill_id");
  const otherUser = intent("X");
  otherUser.session.user.userId = "amzn1.ask.account.OUTRO";
  assert.equal(authorizeSkillRequest(otherUser, config).reason, "allowed_user");
  assert.equal(authorizeSkillRequest(intent("X"), { skillId: "", allowedUserIds: [USER] }).ok, false);
  assert.equal(authorizeSkillRequest(intent("X"), { skillId: SKILL, allowedUserIds: [] }).ok, false);
  assert.equal(authorizeSkillRequest({}, config).ok, false);
});

test("abertura e ajuda mantêm a sessão aberta", async () => {
  const launch = await handleSkillRequest(envelope({ type: "LaunchRequest" }), deps);
  assert.match(text(launch), /Central Machado/);
  assert.equal(launch.response.shouldEndSession, false);
  assert.ok(launch.response.reprompt);
  const help = await handleSkillRequest(intent("AMAZON.HelpIntent"), deps);
  assert.equal(help.response.shouldEndSession, false);
});

test("parar encerra; fim de sessão não fala", async () => {
  const stop = await handleSkillRequest(intent("AMAZON.StopIntent"), deps);
  assert.equal(stop.response.shouldEndSession, true);
  const ended = await handleSkillRequest(envelope({ type: "SessionEndedRequest" }), deps);
  assert.equal(ended.response.shouldEndSession, true);
  assert.equal(ended.response.outputSpeech, undefined);
});

test("contagens por assunto, no singular, plural e zero", async () => {
  const sim = await handleSkillRequest(intent("AguardandoSimulacaoIntent"), deps);
  assert.equal(text(sim), "6 clientes aguardando simulação.");
  assert.deepEqual(sim.sessionAttributes, { lastTopic: "simulacao", lastCount: 6 });
  assert.equal(sim.response.shouldEndSession, false);
  assert.equal(text(await handleSkillRequest(intent("AguardandoDocumentacaoIntent"), deps)), "1 cliente com documentação pendente.");
  const none = await handleSkillRequest(intent("AguardandoAprovacaoIntent"), deps);
  assert.equal(text(none), "Nenhum cliente aguardando aprovação.");
});

test("conversa: 'quem são?' usa o assunto da pergunta anterior", async () => {
  const first = await handleSkillRequest(intent("AguardandoSimulacaoIntent"), deps);
  const followUp = await handleSkillRequest(intent("QuemSaoIntent", {}, first.sessionAttributes), deps);
  assert.equal(text(followUp), "João, Maria e Pedro, e mais 5.");
  assert.equal(followUp.sessionAttributes.lastTopic, "simulacao");
});

test("'quem são?' sem contexto pergunta o assunto; com slot responde direto", async () => {
  const ask = await handleSkillRequest(intent("QuemSaoIntent"), deps);
  assert.match(text(ask), /De qual assunto/);
  assert.equal(ask.response.shouldEndSession, false);
  const withSlot = await handleSkillRequest(intent("QuemSaoIntent", { assunto: { name: "assunto", value: "documentos" } }), deps);
  assert.equal(text(withSlot), "João, Maria e Pedro.");
  const resolved = await handleSkillRequest(
    intent("QuemSaoIntent", {
      assunto: { value: "x", resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { name: "aprovação" } }] }] } }
    }),
    deps
  );
  assert.equal(resolved.sessionAttributes.lastTopic, "aprovacao");
});

test("'quem são?' quando não há ninguém", async () => {
  const empty = { ...deps, namesByTopic: async () => ({ names: [], total: 0 }) };
  const result = await handleSkillRequest(intent("QuemSaoIntent", {}, { lastTopic: "aprovacao" }), empty);
  assert.equal(text(result), "Nenhum cliente aguardando aprovação.");
});

test("resumo do dia e próxima reunião", async () => {
  assert.equal(text(await handleSkillRequest(intent("ResumoDoDiaIntent"), deps)), "Bom dia, Matheus. Temos 6 clientes aguardando simulação.");
  assert.equal(text(await handleSkillRequest(intent("ProximaReuniaoIntent"), deps)), "Sua próxima reunião é hoje às 14 horas.");
  const none = await handleSkillRequest(intent("ProximaReuniaoIntent"), { ...deps, nextMeeting: async () => null });
  assert.match(text(none), /não tem reuniões/);
});

test("intenção desconhecida cai no fallback sem quebrar", async () => {
  const result = await handleSkillRequest(intent("AMAZON.FallbackIntent"), deps);
  assert.match(text(result), /Não entendi/);
  assert.equal(result.response.shouldEndSession, false);
});

test("auxiliares de frase", () => {
  assert.equal(joinNames(["A", "B", "C"]), "A, B e C");
  assert.equal(spokenWhen({ dayOffset: 1, hours: 9, minutes: 30, weekdayName: "" }), "amanhã às 9 e 30");
  assert.equal(spokenWhen({ dayOffset: 3, hours: 1, minutes: 0, weekdayName: "sexta-feira" }), "na sexta-feira às 1 hora");
  assert.equal(topicFromText("Documentações"), "documentacao");
  assert.equal(topicFromText("nada"), "");
});

test("nenhuma resposta contém dados sensíveis (CPF, R$, longos números)", async () => {
  const sensitive = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}|R\s?\$|\d{6,}|renda|cpf/i;
  for (const name of ["ResumoDoDiaIntent", "AguardandoSimulacaoIntent", "ProximaReuniaoIntent", "QuemSaoIntent"]) {
    const result = await handleSkillRequest(intent(name, {}, { lastTopic: "simulacao" }), deps);
    assert.doesNotMatch(text(result), sensitive);
  }
});
