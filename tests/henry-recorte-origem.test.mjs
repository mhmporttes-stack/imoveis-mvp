// Henry — origem de quem NÃO virou simulação (bug real do dono, 2026-10-26, conversa de 25/10 em henry_day_memory):
// "Nos últimos 7 dias, 44 dos 107 atendimentos viraram simulação." → "dos 107, 63 não viraram" → "Qual origem desses 63?"
// respondeu a origem de TODOS os clientes novos ("185 de 220 por outras origens"); depois "o detalhe você só encontra na
// tela", "Vou puxar a origem desses 63 agora mesmo." sem ferramenta e "Certo" → "Beleza!".
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_DEFLECT_RETRY,
  henryDirectRoute,
  henryFunnelSegmentRequest,
  henryPendingFollowUp,
  henryPendingHint,
  henryPromisedAction,
  henryScreenDeflection,
  isHenryInsistence
} from "../lib/henry-voice-turn.mjs";
import {
  HENRY_FUNNEL_SEGMENT_IDS,
  buildHenryFunnelSegmentReport,
  buildHenryPeriodReport,
  groupHenryOrigins,
  henryFunnelSegmentFilter,
  henryOriginGroup,
  resolveHenryPeriod
} from "../lib/henry-reports-core.mjs";
import { HENRY_TOOL_ACCESS } from "../lib/henry-voice-core.mjs";
import { HENRY_TRAINING_MAX_EXCHANGES, analyzeHenryTraining, henryTrainingScenario, henryTrainingTotalSteps } from "../lib/henry-training-core.mjs";
import { buildHenryStaticPrompt } from "../lib/henry-voice-persona.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const lib = read("../lib/henry-voice.js");
const reports = read("../lib/henry-reports.js");
const overview = read("../lib/performance-overview.js");
const TODAY = "2026-10-25";

// A conversa real (memória do dia de 25/10).
const T = (role, text) => ({ role, text });
const DAY = [
  T("user", "Quantos atendimentos fizemos nos últimos 7 dias ?"),
  T("assistant", "Nos últimos 7 dias foram 107 atendimentos."),
  T("user", "Dos 107 atendimentos quantos clientes fizeram simulação ?"),
  T("assistant", "Quer que eu tente de novo?"),
  T("user", "Sim"),
  T("assistant", "Nos últimos 7 dias, 44 dos 107 atendimentos viraram simulação."),
  T("user", "Os que não viraram simulação existe um motivo específico?"),
  T("assistant", "Não tenho o motivo de cada cliente, mas dá pra ver a conta: dos 107 atendimentos, 63 não viraram simulação.")
];
const ORIGIN_ASK = "Qual origem desses 63, são cliente que entraram por onde ?";
const WRONG = "A maior parte dos 63 que não viraram simulação veio de fora dos canais que eu consigo separar: nos últimos 7 dias, 185 dos 220 clientes novos entraram por outras origens, 34 pelo Marketplace e só 1 por anúncio.";
const SEGMENT_ROUTE = { name: "funil_recorte", input: { recorte: "sem_simulacao", periodo: "ultimos_7_dias" }, topic: "funil_recorte", speak: true };

test("1: 'Qual origem desses 63?' = funil_recorte dos atendidos SEM simulação, no período da conversa (rota direta)", () => {
  assert.deepEqual(henryDirectRoute(ORIGIN_ASK, { turns: DAY, today: TODAY }), SEGMENT_ROUTE);
  // "desses 44" (o número dos que viraram) = o recorte inverso.
  assert.equal(henryFunnelSegmentRequest("E a origem desses 44?", { turns: DAY, today: TODAY }).recorte, "com_simulacao");
  // Dito na própria fala, sem conversa: período da fala (ou o padrão).
  assert.deepEqual(henryFunnelSegmentRequest("De onde vieram os que não viraram simulação esse mês?", { turns: [], today: TODAY }), { recorte: "sem_simulacao", periodo: "este_mes" });
  assert.deepEqual(henryFunnelSegmentRequest("Por onde entraram os que viraram simulação?", { turns: [], today: TODAY }), { recorte: "com_simulacao", periodo: "ultimos_7_dias" });
  // Origem dos clientes novos continua com o relatório do período (não é o recorte).
  assert.equal(henryFunnelSegmentRequest("Qual a origem dos clientes novos dessa semana?", { turns: DAY, today: TODAY }), null);
  assert.equal(henryFunnelSegmentRequest("Quantos atendimentos fizemos?", { turns: DAY, today: TODAY }), null);
  assert.ok(HENRY_FUNNEL_SEGMENT_IDS.includes("sem_simulacao") && HENRY_FUNNEL_SEGMENT_IDS.includes("com_simulacao"));
});

test("2: recorte = MESMA definição do funil (Atendimento − Simulação), cliente por cliente (getFunnelCohortStages)", () => {
  const notSim = henryFunnelSegmentFilter("sem_simulacao");
  const sim = henryFunnelSegmentFilter("com_simulacao");
  assert.deepEqual([0, 1, 2, 6].map(notSim), [true, false, false, false]);
  assert.deepEqual([0, 1, 2, 6].map(sim), [false, true, true, true]);
  // Uma regra só da etapa mais avançada: o funil e o recorte usam computeFurthestStageByClient.
  assert.match(overview, /export async function getFunnelCohortStages\(/);
  assert.match(overview, /const furthestIndexByClient = computeFurthestStageByClient\(cohortClientIds, fullHistory, currentStatusByClientId, directBrokerLinkClientIds\);/);
  assert.match(overview, /const cohortIds = getProspectingClientIds\(teamRegistrations, prospectingEvents, range, history\);/);
  assert.match(reports, /const cohort = await getFunnelCohortStages\(screenParams\(range\)\);/);
  assert.match(reports, /applyResponsibleUserScope\(\n\s+supabase\.from\("simulation_registrations"\)\.select\("id, full_name, acquisition_context, prospecting_contact_id"\)\.in\("id"/);
  assert.equal(HENRY_TOOL_ACCESS.funil_recorte, "leitura");
  assert.match(lib, /name: "funil_recorte",/);
  assert.match(lib, /if \(name === "funil_recorte"\) return await runFunnelSegment\(input \|\| \{\}, auth, context\);/);
});

test("3: origem pelos rótulos do CRM, nunca 'outras origens' genérico", () => {
  assert.equal(henryOriginGroup({ kind: "manual", prospecting: true }), "prospeccao");
  assert.equal(henryOriginGroup({ kind: "facebook_marketplace" }), "marketplace");
  assert.equal(henryOriginGroup({ kind: "whatsapp_individual" }), "whatsapp_pessoal");
  assert.equal(henryOriginGroup({ kind: "whatsapp_organic" }), "whatsapp_oficial");
  assert.equal(henryOriginGroup({ kind: "whatsapp_ad" }), "anuncio");
  assert.equal(henryOriginGroup({ kind: "site", metadata: { utm_medium: "cpc" } }), "anuncio");
  assert.equal(henryOriginGroup({ kind: "broker_link" }), "link_pessoal");
  assert.equal(henryOriginGroup({ kind: "campaign" }), "campanha");
  assert.equal(henryOriginGroup({ kind: "roulette_link" }), "roleta");
  assert.equal(henryOriginGroup({ kind: "site" }), "site");
  assert.equal(henryOriginGroup({ kind: "facebook_messenger" }), "messenger");
  assert.equal(henryOriginGroup({ kind: "manual" }), "manual");
  assert.equal(henryOriginGroup({ kind: "" }), "sem_registro");
  const groups = groupHenryOrigins([{ name: "Ana", group: "marketplace" }, { name: "Bia", group: "prospeccao" }, { name: "Caio", group: "prospeccao" }]);
  assert.deepEqual(groups.map((g) => [g.label, g.count]), [["Prospecção", 2], ["Marketplace", 1]]);
});

test("4: fala = total do recorte + 3 maiores origens + 'o resto na tela'; lista por origem na tela", () => {
  const range = resolveHenryPeriod({ periodo: "ultimos_7_dias" }, TODAY);
  const many = (n, group) => Array.from({ length: n }, (_, i) => ({ name: `Cliente ${group} ${i}`, group }));
  // Números reais de 19/10 a 25/10 (SQL só leitura em 2026-10-26, mesma definição do funil): 107 atendidos, 44 simulação.
  const rows = [...many(21, "prospeccao"), ...many(18, "marketplace"), ...many(18, "whatsapp_pessoal"), ...many(2, "manual"), ...many(2, "link_pessoal"), ...many(1, "anuncio"), ...many(1, "whatsapp_oficial")];
  const report = buildHenryFunnelSegmentReport({ range, segment: "sem_simulacao", rows, attended: 107, simulated: 44 });
  assert.equal(report.spoken, "Nos últimos 7 dias, dos 63 atendidos que não viraram simulação, 21 vieram da prospecção, 18 do Marketplace e 18 do WhatsApp pessoal dos corretores; os outros 6 estão na tela, por origem.");
  assert.equal(report.facts.total, 63);
  assert.equal(report.facts.atendidos - report.facts.viraram_simulacao, 63);
  assert.doesNotMatch(report.spoken, /outras origens/);
  assert.equal(report.detail.sections[0].title, "Por origem");
  assert.equal(report.detail.sections.length, 1 + 7);
  assert.equal(buildHenryFunnelSegmentReport({ range, segment: "sem_simulacao", rows: [] }).spoken, "Nos últimos 7 dias, nenhum cliente ficou nesse recorte.");
});

test("5: insistência ('Todo cliente tem uma origem', 'pq vc não abre a lista', 'quero que vc me diga') refaz o pedido com a ferramenta", () => {
  const turns = [...DAY, T("user", ORIGIN_ASK), T("assistant", WRONG)];
  for (const insist of ["Todo cliente tem uma origem", "É pq vc não abre a lista para me responder ?", "Quero que vc me diga"]) {
    assert.ok(isHenryInsistence(insist), insist);
    const pending = henryPendingFollowUp(insist, turns);
    assert.deepEqual(pending, { request: ORIGIN_ASK, kind: "insistencia" }, insist);
    assert.deepEqual(henryDirectRoute(pending.request, { turns, today: TODAY }), SEGMENT_ROUTE);
  }
  assert.equal(isHenryInsistence("Quantos clientes novos entraram hoje?"), false);
  assert.match(henryPendingHint({ kind: "insistencia", request: ORIGIN_ASK }), /nunca mande ele abrir a tela/);
  // Ligado no servidor: insistência tira a resposta fixa, liga as ferramentas e usa a rota do pedido de antes.
  assert.match(lib, /const pending = !image && !accepted && !fixedReply && !locked && !reinterpreted && !deepen \? henryPendingFollowUp\(text, memoryTurns\.length \? memoryTurns : previous\) : null;/);
  assert.match(lib, /const turnReply = !image && !accepted && !fixedReply && !pending\n/);
  assert.match(lib, /\(pending \? henryDirectRoute\(pending\.request,/);
  assert.match(lib, /pending && !direct \? henryPendingHint\(pending\)/);
});

test("6: 'Vou puxar a origem desses 63 agora mesmo.' é promessa sem ação (o 63 só repete a pergunta)", () => {
  assert.equal(henryPromisedAction("Tem razão, eu devia ter buscado isso. Vou puxar a origem desses 63 agora mesmo."), true);
  assert.equal(henryPromisedAction("Vou puxar quantos dos 107 viraram simulação."), true);
  // Resultado de verdade continua valendo como resposta.
  assert.equal(henryPromisedAction("Já te mostro: foram 3 vendas no mês."), false);
  assert.equal(henryPromisedAction("Nos últimos 7 dias, 44 dos 107 atendimentos viraram simulação."), false);
});

test("7: 'Certo' depois da promessa = cumprir agora (nunca 'Beleza!')", () => {
  const turns = [...DAY, T("user", ORIGIN_ASK), T("assistant", WRONG), T("user", "Quero que vc me diga"), T("assistant", "Tem razão, eu devia ter buscado isso. Vou puxar a origem desses 63 agora mesmo.")];
  const pending = henryPendingFollowUp("Certo", turns);
  assert.equal(pending.kind, "promessa");
  assert.equal(pending.request, ORIGIN_ASK);
  assert.deepEqual(henryDirectRoute(pending.request, { turns, today: TODAY }), SEGMENT_ROUTE);
  // "Certo" depois de uma resposta com conteúdo continua sendo só concordância.
  assert.equal(henryPendingFollowUp("Certo", [...DAY]), null);
  assert.match(lib, /const personal = !image && !greeting && !accepted && !screenOpen && !pending && \(/);
});

test("8: mandar olhar a tela no lugar de responder = rodada que obriga a ferramenta; Treino acusa 'recusa_com_dado'", () => {
  assert.equal(henryScreenDeflection("Não consegui ver isso agora. O detalhe por cliente você só encontra abrindo a lista de clientes na tela."), true);
  assert.equal(henryScreenDeflection("A tela de Clientes está aberta. Lá você vê a origem de cada um dos 63 que não viraram simulação."), true);
  assert.equal(henryScreenDeflection("Pronto, deixei os detalhes na tela."), false);
  assert.equal(henryScreenDeflection("Nos últimos 7 dias, dos 63, 21 vieram da prospecção; os outros estão na tela, por origem."), false);
  assert.match(HENRY_DEFLECT_RETRY, /funil_recorte/);
  assert.match(lib, /henryScreenDeflection\(replyText\) && \(!crmToolUsed \|\| !\/\\d\/\.test\(replyText\)\)\) \{\n\s+deflectRetried = true;[\s\S]*?content: HENRY_DEFLECT_RETRY \}\);\n\s+forceTool = true;/);
  const { issues } = analyzeHenryTraining([
    { owner: "Todo cliente tem uma origem", reply: "Não consegui ver isso agora. O detalhe por cliente você só encontra abrindo a lista de clientes na tela.", toolNames: [] },
    { owner: "Quero que vc me diga", reply: "Tem razão, eu devia ter buscado isso. Vou puxar a origem desses 63 agora mesmo.", toolNames: [] },
    { owner: ORIGIN_ASK, reply: "Nos últimos 7 dias, dos 63 atendidos que não viraram simulação, 21 vieram da prospecção; os outros estão na tela, por origem.", toolNames: ["funil_recorte"] }
  ]);
  assert.ok(issues.some((issue) => issue.kind === "recusa_com_dado" && issue.index === 0));
  assert.ok(issues.some((issue) => issue.kind === "promessa_sem_acao" && issue.index === 1));
  assert.ok(!issues.some((issue) => issue.index === 2 && ["recusa_com_dado", "promessa_sem_acao"].includes(issue.kind)));
});

test("9: Treino tem o cenário da conversa (atendimentos → simulação → origem dos que não viraram → insistência → 'certo')", () => {
  const scenario = henryTrainingScenario("recorte_origem");
  assert.ok(scenario);
  assert.equal(scenario.steps.length, 6);
  assert.match(scenario.steps[2].say, /origem dos que não viraram simulação/);
  assert.equal(scenario.steps[5].say, "Certo");
  assert.ok(henryTrainingTotalSteps() <= HENRY_TRAINING_MAX_EXCHANGES);
});

test("10: persona proíbe 'só na tela' com ferramenta e manda usar funil_recorte; relatório do período sem 'outras' quando há o detalhe", () => {
  const prompt = buildHenryStaticPrompt();
  assert.match(prompt, /proibido "o detalhe você só encontra na tela"/);
  assert.match(prompt, /= funil_recorte com o MESMO período da conversa/);
  const range = resolveHenryPeriod({ periodo: "ultimos_7_dias" }, TODAY);
  const leads = { total: 220, ad: 1, marketplace: 34, other: 185, byOrigin: [{ key: "prospeccao", label: "Prospecção", count: 138 }, { key: "marketplace", label: "Marketplace", count: 34 }] };
  const report = buildHenryPeriodReport({ kind: "semanal", range, previousRange: null, overview: null, leads });
  assert.deepEqual(report.facts.clientes_novos.por_origem, [{ origem: "Prospecção", clientes: 138 }, { origem: "Marketplace", clientes: 34 }]);
  assert.equal(report.facts.clientes_novos.outras, undefined);
  assert.ok(report.detail.sections.some((section) => section.title === "Clientes novos por origem"));
});
