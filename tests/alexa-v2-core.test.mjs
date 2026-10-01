import test from "node:test";
import assert from "node:assert/strict";
import { PERIOD_IDS, addDays, mondayOf, periodFromText, resolvePeriod, weekdayOf } from "../lib/alexa-v2/periods.mjs";
import { ETAPAS, TOPICS, etapaFromText, topicFromText } from "../lib/alexa-v2/catalog.mjs";
import { SAFE_FALLBACK, isSafeToSpeak, sanitizeSpeech } from "../lib/alexa-v2/sanitize.mjs";
import { namesSentence, pageOfNames } from "../lib/alexa-v2/text.mjs";
import { handleSkillRequestV2 } from "../lib/alexa-v2/router.mjs";

// 2026-10-07 é uma quarta-feira.
const TODAY = "2026-10-07";
const SKILL = "amzn1.ask.skill.test";

const slot = (id, name) => ({
  value: name || id,
  resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { id, name: name || id } }] }] }
});
const envelope = (intentName, slots = {}, attributes = {}) => ({
  session: { new: false, application: { applicationId: SKILL }, user: { userId: "u" }, attributes },
  request: { type: "IntentRequest", intent: { name: intentName, slots } }
});
const text = (result) => result.response.outputSpeech.text;
const ctxOf = (result) => result.sessionAttributes.v2;

const BROKERS = ["Bruna", "Eduardo", "Carlos", "Daniela", "Everaldo", "Fabiana", "Gustavo"];
function makeDeps(overrides = {}) {
  return {
    today: () => TODAY,
    brokers: { match: (name) => (BROKERS.includes(name) ? { id: `id-${name}`, name } : null) },
    legacyDeps: {
      countByTopic: async (topic) => ({ simulacao: 6, documentacao: 1, aprovacao: 0 })[topic],
      namesByTopic: async () => ({ names: ["João"], total: 1 }),
      nextMeeting: async () => null,
      daySummary: async () => "Bom dia, Matheus."
    },
    providers: {
      meta: async (q) => {
        if (q.topic === "meta_bateram") return { count: 7, items: BROKERS.map((name) => ({ name, percent: 120 })) };
        if (q.topic === "meta_faltam") return { count: 0, items: [] };
        if (q.topic === "meta_equipe") return { percent: 83.4 };
        return null;
      },
      prospeccao: async (q) =>
        q.topic === "prospeccao_corretor"
          ? { name: q.corretorName, count: 30 }
          : { count: 85, items: [{ name: "Eduardo", count: 30 }, { name: "Bruna", count: 25 }] },
      etapa: async (q) => ({ count: q.etapa === "simulacao" ? 2 : 0, items: [{ name: "João" }, { name: "Maria" }] }),
      agenda: async () => ({ count: 2, items: [{ hours: 10, minutes: 0, client: "João" }, { hours: 14, minutes: 30, client: "Maria" }] })
    },
    ...overrides
  };
}

test("períodos: semana e mês seguem o CRM (segunda a hoje; mês até hoje)", () => {
  assert.equal(weekdayOf(TODAY), 3);
  assert.equal(mondayOf(TODAY), "2026-10-05");
  assert.equal(mondayOf("2026-10-04"), "2026-09-28");
  const week = resolvePeriod("esta_semana", TODAY);
  assert.equal(week.startDate, "2026-10-05");
  assert.equal(week.endDate, TODAY);
  const last = resolvePeriod("semana_passada", TODAY);
  assert.equal(last.startDate, "2026-09-28");
  assert.equal(last.endDate, "2026-10-04");
  assert.equal(resolvePeriod("este_mes", TODAY).startDate, "2026-10-01");
  assert.equal(resolvePeriod("mes_passado", TODAY).startDate, "2026-09-01");
  assert.equal(resolvePeriod("mes_passado", TODAY).endDate, "2026-09-30");
  assert.equal(resolvePeriod("mes_passado", "2026-01-15").startDate, "2025-12-01");
  assert.equal(resolvePeriod("ontem", "2026-03-01").startDate, "2026-02-28");
  assert.equal(resolvePeriod("amanha", TODAY).startDate, "2026-10-08");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(periodFromText("semana passada"), "semana_passada");
  assert.equal(periodFromText("esta semana"), "esta_semana");
  assert.equal(periodFromText("amanhã"), "amanha");
  assert.equal(periodFromText("nada"), "");
});

test("catálogo: todo assunto é consistente", () => {
  for (const [id, topic] of Object.entries(TOPICS)) {
    assert.ok(topic.provider, `${id} sem provedor`);
    assert.ok(topic.periods.every((p) => PERIOD_IDS.includes(p) || p === "data"), `${id} período inválido`);
    for (const kind of topic.kinds) assert.equal(typeof topic.say[kind], "function", `${id} sem frase ${kind}`);
    if (topic.defaultPeriod) assert.ok(topic.periods.includes(topic.defaultPeriod));
  }
  assert.equal(topicFromText("quantos bateram a meta"), "meta_bateram");
  assert.equal(etapaFromText("aprovados"), "aprovados");
  assert.equal(etapaFromText("documentação"), "documentacao");
  assert.ok(Object.keys(ETAPAS).length >= 8);
});

test("privacidade: nada de telefone, e-mail, CPF ou valores", () => {
  assert.equal(isSafeToSpeak("6 clientes aguardando simulação."), true);
  assert.equal(isSafeToSpeak("Ligue para 14 99840-7380"), false);
  assert.equal(isSafeToSpeak("joao@email.com"), false);
  assert.equal(isSafeToSpeak("CPF 123.456.789-09"), false);
  assert.equal(isSafeToSpeak("Venda de R$ 300 mil"), false);
  assert.equal(sanitizeSpeech("renda alta"), SAFE_FALLBACK);
  assert.equal(sanitizeSpeech("  A   frase   "), "A frase");
});

test("listas: 5 nomes e 'e mais X'", () => {
  assert.equal(namesSentence(["A", "B", "C", "D", "E", "F", "G"]), "A, B, C, D e E, e mais 2.");
  assert.equal(namesSentence(["A", "B", "C", "D", "E", "F", "G"], 1), "F e G.");
  assert.equal(pageOfNames(["A", "B", "C", "D", "E", "F"], 0).hasMore, true);
  assert.equal(pageOfNames(["A"], 0).hasMore, false);
});

test("V1: tratador antigo continua disponível e as frases antigas agora usam as fontes da V2", async () => {
  const legacy = await handleSkillRequestV2(envelope("AguardandoSimulacaoIntent"), makeDeps({ v1ToV2: false }));
  assert.equal(text(legacy), "6 clientes aguardando simulação.");
  assert.deepEqual(legacy.sessionAttributes, { lastTopic: "simulacao", lastCount: 6 });
  const r = await handleSkillRequestV2(envelope("AguardandoSimulacaoIntent"), makeDeps());
  assert.equal(text(r), "2 clientes aguardando simulação.");
  assert.equal(ctxOf(r).topic, "etapa");
  const deps = makeDeps();
  deps.providers.resumo = async () => ({ text: "Bom dia, Matheus." });
  assert.equal(text(await handleSkillRequestV2(envelope("ResumoDoDiaIntent"), deps)), "Bom dia, Matheus.");
  const who = await handleSkillRequestV2(envelope("QuemSaoIntent", {}, { lastTopic: "simulacao" }), makeDeps({ v1ToV2: false }));
  assert.ok(text(who).length > 0);
});

test("etapa falada sem assunto ('quantos clientes em documentação') vira consulta de etapa", async () => {
  const r = await handleSkillRequestV2(envelope("ConsultarIntent", { etapa: slot("simulacao", "simulação") }, { v2: { topic: "funil", kind: "count", periodo: "hoje" } }), makeDeps());
  assert.equal(text(r), "2 clientes aguardando simulação.");
});

test("consulta simples e contexto salvo", async () => {
  const r = await handleSkillRequestV2(envelope("ConsultarIntent", { assunto: slot("meta_equipe") }), makeDeps());
  assert.equal(text(r), "A meta da equipe está em 83 por cento.");
  assert.equal(ctxOf(r).topic, "meta_equipe");
  assert.equal(ctxOf(r).periodo, "hoje");
  assert.equal(r.response.shouldEndSession, false);
});

test("'quem são?' usa o assunto anterior; 'mais' pagina; fim da lista", async () => {
  const deps = makeDeps();
  const first = await handleSkillRequestV2(envelope("ConsultarIntent", { assunto: slot("meta_bateram") }), deps);
  assert.equal(text(first), "7 corretores bateram a meta.");
  const who = await handleSkillRequestV2(envelope("ListarIntent", {}, first.sessionAttributes), deps);
  assert.equal(text(who), "Bruna, Eduardo, Carlos, Daniela e Everaldo, e mais 2.");
  assert.equal(ctxOf(who).hasMore, true);
  assert.equal(who.response.reprompt.outputSpeech.text, "Quer ouvir mais?");
  const more = await handleSkillRequestV2(envelope("MaisIntent", {}, who.sessionAttributes), deps);
  assert.equal(text(more), "Fabiana e Gustavo.");
  assert.equal(ctxOf(more).hasMore, false);
  const end = await handleSkillRequestV2(envelope("MaisIntent", {}, more.sessionAttributes), deps);
  assert.equal(text(end), "Esses eram todos.");
});

test("'mais' sem lista anterior explica", async () => {
  const r = await handleSkillRequestV2(envelope("MaisIntent"), makeDeps());
  assert.match(text(r), /Não há uma lista/);
});

test("etapa: pergunta e continuação com outra etapa", async () => {
  const deps = makeDeps();
  const first = await handleSkillRequestV2(envelope("ConsultarIntent", { assunto: slot("etapa_simulacao") }), deps);
  assert.equal(text(first), "2 clientes aguardando simulação.");
  assert.equal(ctxOf(first).etapa, "simulacao");
  const names = await handleSkillRequestV2(envelope("ListarIntent", {}, first.sessionAttributes), deps);
  assert.equal(text(names), "João e Maria.");
  const lost = await handleSkillRequestV2(envelope("ContinuaIntent", { etapa: slot("aprovacao") }), deps);
  assert.match(text(lost), /Sobre o que/);
  const chained = await handleSkillRequestV2(envelope("ContinuaIntent", { etapa: slot("aprovacao") }, first.sessionAttributes), deps);
  assert.equal(text(chained), "Nenhum cliente aguardando aprovação.");
});

test("'e ontem?' muda o período; período não suportado é explicado", async () => {
  const deps = makeDeps();
  const today = await handleSkillRequestV2(envelope("ConsultarIntent", { assunto: slot("meta_bateram") }), deps);
  const yesterday = await handleSkillRequestV2(envelope("ContinuaIntent", { periodo: slot("ontem") }, today.sessionAttributes), deps);
  assert.equal(ctxOf(yesterday).periodo, "ontem");
  assert.equal(text(yesterday), "7 corretores bateram a meta.");
  const week = await handleSkillRequestV2(envelope("ContinuaIntent", { periodo: slot("esta_semana") }, today.sessionAttributes), deps);
  assert.equal(text(week), "Isso eu só sei para hoje e ontem.");
});

test("'e o Eduardo?' filtra por corretor; corretor desconhecido é explicado", async () => {
  const deps = makeDeps();
  const team = await handleSkillRequestV2(envelope("ConsultarIntent", { assunto: slot("prospeccao_equipe") }), deps);
  assert.equal(text(team), "A equipe fez 85 prospecções hoje.");
  const asked = await handleSkillRequestV2(envelope("ConsultarIntent", { assunto: slot("prospeccao_corretor") }), deps);
  assert.equal(text(asked), "De qual corretor?");
  const eduardo = await handleSkillRequestV2(envelope("ContinuaIntent", { corretor: { value: "Eduardo" } }, asked.sessionAttributes), deps);
  assert.equal(text(eduardo), "Eduardo fez 30 prospecções hoje.");
  const unknown = await handleSkillRequestV2(envelope("ContinuaIntent", { corretor: { value: "Zeca" } }, asked.sessionAttributes), deps);
  assert.equal(text(unknown), "Não encontrei o corretor Zeca.");
});

test("período padrão de assuntos específicos e agenda", async () => {
  const deps = makeDeps({ providers: { ranking: async () => ({ name: "Bruna", points: 420, gender: "female" }), agenda: makeDeps().providers.agenda } });
  const champion = await handleSkillRequestV2(envelope("ConsultarIntent", { assunto: slot("campeao_semana") }), deps);
  assert.equal(text(champion), "A campeã da semana foi Bruna, com 420 pontos.");
  assert.equal(ctxOf(champion).periodo, "semana_passada");
  const agenda = await handleSkillRequestV2(envelope("ListarIntent", { assunto: slot("agenda") }), deps);
  assert.equal(text(agenda), "10 horas com João; 14 e 30 com Maria.");
});

test("fallback: provedor que falha, que demora ou que não existe", async () => {
  const failing = makeDeps({ providers: { meta: async () => { throw new Error("banco fora"); } } });
  const failed = await handleSkillRequestV2(envelope("ConsultarIntent", { assunto: slot("meta_equipe") }), failing);
  assert.equal(text(failed), "Não consegui buscar isso agora. Quer o resumo geral?");
  assert.doesNotMatch(text(failed), /banco|erro/i);
  const slow = makeDeps({ timeoutMs: 20, providers: { meta: () => new Promise(() => {}) } });
  const timedOut = await handleSkillRequestV2(envelope("ConsultarIntent", { assunto: slot("meta_equipe") }), slow);
  assert.equal(text(timedOut), "Não consegui buscar isso agora. Quer o resumo geral?");
  const missing = makeDeps({ providers: {} });
  const none = await handleSkillRequestV2(envelope("ConsultarIntent", { assunto: slot("meta_equipe") }), missing);
  assert.equal(text(none), "Ainda não consigo responder isso por aqui.");
});

test("dado antigo vira aviso curto; dado sensível nunca é falado", async () => {
  const stale = makeDeps({ providers: { meta: async () => ({ percent: 50, staleMinutes: 17 }) } });
  const r = await handleSkillRequestV2(envelope("ConsultarIntent", { assunto: slot("meta_equipe") }), stale);
  assert.equal(text(r), "Última atualização há 17 minutos. A meta da equipe está em 50 por cento.");
  const leaky = makeDeps({ providers: { presenca: async () => ({ count: 1, items: [{ name: "João 14998407380" }] }) } });
  const safe = await handleSkillRequestV2(envelope("ListarIntent", { assunto: slot("online") }), leaky);
  assert.equal(text(safe), SAFE_FALLBACK);
});

test("repetir e assunto ausente", async () => {
  const deps = makeDeps();
  const first = await handleSkillRequestV2(envelope("ConsultarIntent", { assunto: slot("meta_equipe") }), deps);
  const again = await handleSkillRequestV2(envelope("AMAZON.RepeatIntent", {}, first.sessionAttributes), deps);
  assert.equal(text(again), text(first));
  const nothing = await handleSkillRequestV2(envelope("ConsultarIntent"), deps);
  assert.match(text(nothing), /Sobre qual assunto/);
  const noKind = await handleSkillRequestV2(envelope("ListarIntent", { assunto: slot("meta_equipe") }), deps);
  assert.match(text(noKind), /^Para isso só tenho o número\. A meta da equipe/);
});

test("'quem bateu a meta' lista nomes; 'e o Eduardo' vira a meta do corretor", async () => {
  const deps = makeDeps();
  deps.providers.meta = async (q) => {
    if (q.topic === "meta_bateram") return { count: 2, items: [{ name: "Bruna", percent: 120 }, { name: "Eduardo", percent: 110 }] };
    return null;
  };
  deps.providers.corretor = async (q) => ({ name: q.corretorName, gender: "male", meta: { percent: 110, hasGoal: true, hit: true, remaining: 0 } });
  const who = await handleSkillRequestV2(envelope("ConsultarIntent", { assunto: slot("meta_bateram", "quem bateu a meta") }), deps);
  assert.equal(text(who), "Bruna e Eduardo.");
  const howMany = await handleSkillRequestV2(envelope("ConsultarIntent", { assunto: { ...slot("meta_bateram", "bateram a meta"), value: "quantos bateram a meta" } }), deps);
  assert.match(text(howMany), /2 corretores bateram a meta/);
  const one = await handleSkillRequestV2(envelope("ContinuaIntent", { corretor: { value: "Eduardo" } }, { v2: ctxOf(howMany) }), deps);
  assert.equal(text(one), "Sim, o Eduardo bateu a meta hoje, com 110 por cento.");
});
