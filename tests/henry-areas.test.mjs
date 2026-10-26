import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_AREAS,
  HENRY_AREA_IDS,
  HENRY_AREA_PERIOD_IDS,
  adsBoardPeriodFor,
  buildHenryAcademyReport,
  buildHenryAgendaReport,
  buildHenryAiCostReport,
  buildHenryAlertsReport,
  buildHenryAutomationsReport,
  buildHenryCampaignsReport,
  buildHenryCaptacoesReport,
  buildHenryClientHistoryReport,
  buildHenryClientTabsReport,
  buildHenryDailyMessageReport,
  buildHenryDocumentationReport,
  buildHenryFinanceDetailReport,
  buildHenryMarketplaceReport,
  buildHenryProspectingBasesReport,
  buildHenryReentriesReport,
  buildHenryRouletteReport,
  buildHenryScoringReport,
  buildHenryTagsReport,
  buildHenryTeamReport,
  buildHenryTrafficReport,
  resolveAreaPeriod
} from "../lib/henry-areas-core.mjs";
import { HENRY_NAV_TARGETS, HENRY_TOOL_ACCESS, isCrmQuestion } from "../lib/henry-voice-core.mjs";
import { henryProgressFor } from "../lib/henry-voice-narration.mjs";
import { isSafeToSpeak } from "../lib/alexa-v2/sanitize.mjs";
import { HENRY_TRAINING_SCENARIOS, henryTrainingTotalSteps, HENRY_TRAINING_MAX_EXCHANGES } from "../lib/henry-training-core.mjs";

// Henry com acesso a tudo (REGRA OFICIAL do dono, 2026-10-26: "Faça um pente fino e veja o que o Henry ainda não tem acesso
// no CRM, depois libere tudo… ele deve ter acesso a tudo e todas as informações"). Continua SOMENTE LEITURA.

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const TODAY = "2026-10-26";
const range = resolveAreaPeriod("captacoes", { periodo: "ultimos_30_dias" }, TODAY);
const month = resolveAreaPeriod("financeiro", { periodo: "este_mes" }, TODAY);

// --- Trava: só leitura, pelas funções das telas -----------------------------------------------------------------------
test("consultar_area é leitura, está na lista de ferramentas e cada área tem leitura, frase de espera e tela válida", () => {
  assert.equal(HENRY_TOOL_ACCESS.consultar_area, "leitura");
  const lib = read("../lib/henry-voice.js");
  const block = lib.slice(lib.indexOf("const TOOLS = ["), lib.indexOf("const idSlot"));
  assert.match(block, /^ {4}name: "consultar_area"/m);
  const server = read("../lib/henry-areas.js");
  for (const id of HENRY_AREA_IDS) {
    assert.match(server, new RegExp(`\\b${id}: `), `leitura da área ${id}`);
    const area = HENRY_AREAS[id];
    assert.ok(area.label.endsWith("…") && area.descricao, id);
    assert.ok(!area.tela || HENRY_NAV_TARGETS[area.tela], `tela ${area.tela} da área ${id}`);
    assert.deepEqual(henryProgressFor("consultar_area", { area: id }), { progress: "crm", topic: area.topic, label: area.label });
  }
});

test("leituras das áreas não gravam: sem insert/update/upsert/delete/rpc, sem fila da Prospecção, sem reparo do financeiro, anúncios sem renovar miniaturas", () => {
  const server = read("../lib/henry-areas.js");
  assert.doesNotMatch(server, /\.(insert|update|upsert|delete|rpc)\(/);
  assert.doesNotMatch(server, /\b(listProspectingContacts|hibernate\w*|assignProspectingContacts|claim\w*)\(/);
  assert.match(server, /listFinancialSales\(auth, \{ repair: false \}\)/);
  assert.match(server, /getAdsBoard\(\{ period, refreshCreatives: false \}\)/);
  const board = read("../lib/meta-ads-board.js");
  assert.match(board, /if \(refreshCreatives && hasMetaAdsReadConfig\(\) && needsCreativeRefresh\(entities\)\)/);
  // financeiro detalhado só para o dono (mesma checagem do financeiro_resumo); alertas: só os do próprio dono (privados)
  assert.match(server, /if \(!isExpectedReceiptOwner\(auth\)\) return \{ spoken: "O financeiro detalhado é só do Matheus\."/);
  assert.match(server, /listMyAlertHistory\(auth\)/);
  assert.doesNotMatch(server, /crm_alert_deliveries|crm_notifications/);
  // nada de SQL livre: a área é um enum fechado
  assert.doesNotMatch(read("../lib/henry-voice.js"), /name: "(sql|consulta_livre|executar)/);
});

test("perguntas das áreas novas contam como pergunta do CRM", () => {
  for (const text of ["como tá o marketplace?", "quanto gastou nos anúncios?", "quantos arquivados?", "quais automações estão ligadas?", "e a academia?", "quanto de comissão?"]) assert.ok(isCrmQuestion(text), text);
});

test("treino: cenário 'areas' com uma pergunta curta por área nova e cabe no teto da rodada", () => {
  const scenario = HENRY_TRAINING_SCENARIOS.find((item) => item.id === "areas");
  assert.ok(scenario && scenario.steps.length >= 8);
  for (const item of scenario.steps) assert.ok(item.say.length <= 60, item.say);
  assert.ok(henryTrainingTotalSteps() <= HENRY_TRAINING_MAX_EXCHANGES);
});

// --- Períodos ---------------------------------------------------------------------------------------------------------
test("período: agenda aceita futuro; as outras áreas nunca passam de hoje; sem período = padrão da área", () => {
  assert.deepEqual([resolveAreaPeriod("agenda", { periodo: "amanha" }, TODAY).startDate, resolveAreaPeriod("agenda", { periodo: "amanha" }, TODAY).endDate], ["2026-10-27", "2026-10-27"]);
  const next = resolveAreaPeriod("agenda", { periodo: "proxima_semana" }, TODAY);
  assert.deepEqual([next.startDate, next.endDate], ["2026-11-02", "2026-11-08"]);
  assert.equal(resolveAreaPeriod("agenda", {}, TODAY).endDate, "2026-11-01");
  const future = resolveAreaPeriod("agenda", { periodo: "intervalo", inicio: "2026-11-10", fim: "2026-11-12" }, TODAY);
  assert.deepEqual([future.startDate, future.endDate], ["2026-11-10", "2026-11-12"]);
  assert.equal(resolveAreaPeriod("captacoes", { periodo: "amanha" }, TODAY).endDate, TODAY);
  assert.equal(resolveAreaPeriod("financeiro", {}, TODAY).startDate, "2026-10-01");
  assert.ok(HENRY_AREA_PERIOD_IDS.includes("ultimos_90_dias") && HENRY_AREA_PERIOD_IDS.includes("proximos_30_dias"));
});

// --- Montadores (fala curta, números da tela, detalhe completo) ---------------------------------------------------------
const NOW = Date.parse("2026-10-26T15:00:00Z");
test("agenda: total, pendentes/concluídas/atrasadas, próximas com tipo, cliente e corretor; por corretor", () => {
  const report = buildHenryAgendaReport({
    now: NOW,
    range: resolveAreaPeriod("agenda", { periodo: "hoje" }, TODAY),
    brokerName: (id) => ({ b1: "Carolina Souza", b2: "Gabriel Lima" })[id] || "",
    activities: [
      { at: "2026-10-26T12:00:00Z", type: "reuniao", status: "pending", clientName: "Ana Paula", brokerId: "b1" },
      { at: "2026-10-26T13:00:00Z", type: "follow_up", status: "completed", clientName: "Bruno", brokerId: "b2" },
      { at: "2026-10-26T18:00:00Z", type: "reuniao", status: "pending", clientName: "Carla Dias", brokerId: "b2" }
    ]
  });
  assert.equal(report.facts.total, 3);
  assert.equal(report.facts.atrasadas, 1);
  assert.match(report.spoken, /três atividades|3 atividades/);
  assert.match(report.spoken, /reunião com Carla \(Gabriel\)/);
  assert.ok(isSafeToSpeak(report.spoken));
  assert.equal(report.detail.sections[0].rows.length, 3);
  const empty = buildHenryAgendaReport({ range: resolveAreaPeriod("agenda", { periodo: "amanha" }, TODAY), activities: [], onlyBroker: "Carolina Souza" });
  assert.equal(empty.spoken, "Não há atividades na agenda de Carolina amanhã.");
});

test("documentação e abas de Clientes: as mesmas contagens da tela; arquivados e Não contactar separados", () => {
  const byStatus = { documentation: 4, documents_pending: 2, approval_pending: 5, restriction: 1, approved: 3, archived: 40, do_not_contact: 7 };
  const docs = buildHenryDocumentationReport({ byStatus, statusLabel: (key) => key });
  assert.equal(docs.facts.enviados_para_analise_cca, 5);
  assert.match(docs.spoken, /5 enviados para análise na CCA/);
  assert.ok(isSafeToSpeak(docs.spoken));
  const tabs = buildHenryClientTabsReport({ byStatus, groups: [{ key: "all", label: "Todos", count: 15 }, { key: "documentation", label: "Documentação", count: 6 }, { key: "archived", label: "Arquivados", count: 47 }], statusLabel: (key) => key });
  assert.equal(tabs.facts.arquivados, 40);
  assert.equal(tabs.facts.nao_contactar, 7);
  assert.match(tabs.spoken, /Arquivados: 40; Não contactar: 7\./);
});

test("histórico do cliente: as movimentações mais recentes na fala, todas na tela; sem nome real = sem nome falado", () => {
  const events = Array.from({ length: 6 }, (_, index) => ({ title: `Evento ${index + 1}`, description: "x", at: `2026-10-${20 + index}T12:00:00Z` }));
  const report = buildHenryClientHistoryReport({ clientName: "Joana Prado", events });
  assert.match(report.spoken, /^Histórico de Joana, do mais recente: Evento 1 em 20\/10/);
  assert.match(report.spoken, /O resto está na tela\.$/);
  assert.equal(report.detail.sections[0].rows.length, 6);
  assert.match(buildHenryClientHistoryReport({ clientName: "Sem nome", events: [] }).spoken, /histórico do cliente/);
});

test("etiquetas: lista; com busca achada = clientes por aba; não achada = sugere as que existem", () => {
  const tags = [{ name: "Lista fria" }, { name: "RESTRIÇÃO" }];
  assert.match(buildHenryTagsReport({ tags }).spoken, /duas etiquetas|2 etiquetas/);
  const found = buildHenryTagsReport({ tags, query: "lista fria", match: tags[0], groups: [{ key: "all", label: "Todos", count: 9 }, { key: "prospecting", label: "Prospecção", count: 12 }] });
  assert.equal(found.facts.clientes, 12);
  assert.match(buildHenryTagsReport({ tags, query: "vip" }).spoken, /Não achei a etiqueta "vip"/);
});

test("financeiro detalhado: vendas do período, comissão e a receber em reais falados; despesas da Saúde; nunca R$ na fala", () => {
  const report = buildHenryFinanceDetailReport({
    range: month,
    sales: [
      { saleDate: "2026-10-05", saleValue: 250000, grossCommission: 10000, receivableTotal: 4000, brokerName: "Gabriel", clientName: "Ana" },
      { saleDate: "2026-09-10", saleValue: 200000, grossCommission: 8000, receivableTotal: 8000, brokerName: "Bruna", clientName: "Beto" }
    ],
    expenses: { totalPaid: { amount: 3000 }, totalToPay: { amount: 1500 }, overdue: { count: 1, amount: 500 }, upcoming: [] }
  });
  assert.equal(report.facts.vendas, 1);
  assert.equal(report.facts.a_receber_total, 12000);
  assert.match(report.spoken, /250\.000 reais vendidos e 10\.000 reais de comissão bruta/);
  assert.match(report.spoken, /3\.000 reais pagas e 1\.500 reais a pagar, uma vencida/);
  assert.doesNotMatch(report.spoken, /R\$/);
  assert.ok(isSafeToSpeak(report.spoken));
});

test("campanhas: totais da tela e os links que mais trouxeram", () => {
  const report = buildHenryCampaignsReport({ range, summary: { views: 120, submissions: 14, clients: 12, simulation: 5, sale: 1 }, campaigns: [{ name: "Black", submissionCount: 9, viewCount: 80 }, { name: "Instagram", submissionCount: 5, viewCount: 40 }] });
  assert.match(report.spoken, /120 visitas, 14 envios/);
  assert.match(report.spoken, /Black com 9 e Instagram com 5/);
});

test("tráfego: gasto e custo em reais só para o dono; período da tela de Anúncios", () => {
  assert.deepEqual(adsBoardPeriodFor({ id: "hoje", days: 1 }), { period: "today", spoken: "hoje" });
  assert.equal(adsBoardPeriodFor({ id: "ultimos_30_dias", days: 30 }).period, "30d");
  const board = { configured: true, summary: { spend: 812.5, results: 40, costPerResult: 20.31, activeCount: 3 }, ads: [{ name: "Ad 1", campaignShort: "MCMV", metrics: { spend: 500, results: 25, crmLeads: 20 } }] };
  const owner = buildHenryTrafficReport({ board, periodSpoken: "nos últimos 7 dias", ownerMoney: true });
  assert.match(owner.spoken, /gasto de 813 reais, 40 resultados, 20 reais por resultado/);
  assert.match(owner.spoken, /20 clientes que entraram no CRM/);
  const other = buildHenryTrafficReport({ board, periodSpoken: "nos últimos 7 dias", ownerMoney: false });
  assert.doesNotMatch(other.spoken, /reais/);
  assert.match(buildHenryTrafficReport({ board: { configured: false } }).spoken, /não está configurada/);
});

test("roleta: quem está ligado/on-line e quantos cada um recebeu no período", () => {
  const report = buildHenryRouletteReport({
    range: resolveAreaPeriod("roleta", { periodo: "hoje" }, TODAY),
    dashboard: {
      brokers: [{ name: "Gabriel Lima", enabled: true, presence: "online", clientCount: 3 }, { name: "Bruna Reis", enabled: true, presence: "offline", clientCount: 2 }, { name: "Inativo", enabled: true, presence: "online", status: "inactive" }],
      history: [{ createdAt: "2026-10-26T13:00:00Z", toUserName: "Gabriel Lima" }, { createdAt: "2026-10-26T14:00:00Z", toUserName: "Gabriel Lima" }, { createdAt: "2026-10-20T14:00:00Z", toUserName: "Bruna Reis" }]
    }
  });
  assert.equal(report.facts.distribuicoes_no_periodo, 2);
  assert.match(report.spoken, /(duas|2) pessoas estão com a distribuição ligada e 1 on-line agora \(Gabriel\)/);
  assert.match(report.spoken, /Gabriel 2/);
});

test("marketplace: anúncios por situação, conversas, Messenger, fila da roleta, não lidas e a extensão", () => {
  const report = buildHenryMarketplaceReport({
    now: Date.parse("2026-10-26T15:00:00Z"),
    listings: [{ status: "published" }, { status: "published" }, { status: "pending" }],
    conversations: [{ channel: "messenger", waiting: true, unreadCount: 2 }, { channel: "marketplace", assignedName: "Gabriel Lima", unreadCount: 1 }],
    extension: { lastSyncAt: "2026-10-26T14:50:00Z" }
  });
  assert.match(report.spoken, /2 anúncios publicados, um na fila/);
  assert.match(report.spoken, /Conversas: 2 \(1 do Messenger\)/);
  assert.match(report.spoken, /A extensão leu há 10 minutos\./);
});

test("academia: desligada avisa; equipe e uma pessoa", () => {
  assert.equal(buildHenryAcademyReport({ enabled: false }).spoken, "A Academia está desligada no CRM.");
  const team = { summary: { people: 5, withEnrollment: 4, completed: 1, inProgress: 3, overdue: 1 }, members: [{ name: "Gabriel Lima", enrollments: [{ trackTitle: "Formação Inicial", percent: 60, status: "in_progress", overdue: false, lessonsDone: 6, lessonsTotal: 10 }] }] };
  assert.match(buildHenryAcademyReport({ team }).spoken, /5 pessoas/);
  assert.match(buildHenryAcademyReport({ team, onlyBroker: "Gabriel Lima" }).spoken, /Gabriel na Academia: Formação Inicial com 60 por cento\./);
});

test("automações, alertas (só os do dono), mensagem do dia e pontuação", () => {
  assert.match(buildHenryAutomationsReport({ rules: [{ name: "Redistribuição", enabled: true, runCount: 5, lastRunAt: "2026-10-26T14:00:00Z" }, { name: "X", enabled: false }], flows: [{ name: "Formulário", status: "active", liveSessions: 2 }] }).spoken, /uma regra ligada de 2.*um ativo de 1, com (duas|2) conversas em andamento/);
  const alerts = buildHenryAlertsReport({ definitions: [{ title: "WhatsApp caiu", enabled: true }], mine: { items: [{ title: "Extensão sem sinal", createdAt: "2026-10-26T14:00:00Z" }], pending: 1 } });
  assert.match(alerts.spoken, /o mais recente: Extensão sem sinal/);
  assert.match(alerts.facts.observacao, /privados/);
  assert.match(buildHenryDailyMessageReport({ settings: { enabled: true, startTime: "08:00", contentType: "biblical" }, dispatches: [{ createdAt: "2026-10-26T11:00:00Z", recipients: 8, completed: 5 }] }).spoken, /ligada, sai às 08:00, tipo bíblica.*8 pessoas, 5 concluíram/);
  const scoring = buildHenryScoringReport({ range: month, rules: [{ label: "Simulação realizada", points: 10, active: true }, { label: "Intervalo online", points: 10, active: true, unit: "minutos" }], adjustments: [{ brokerName: "Gabriel", points: 50, reason: "bônus" }] });
  assert.match(scoring.spoken, /simulação realizada 10\. Ajustes manuais neste mês: 1, somando 50 pontos\./);
});

test("equipe: cargos, gestor de cada um e uma pessoa; nunca telefone nem e-mail", () => {
  const profiles = [
    { id: "m", name: "Carolina Souza", role: "manager", status: "active", email: "c@x.com", phone: "14999999999" },
    { id: "b", name: "Gabriel Lima", role: "broker", status: "active", managerId: "m", hasCreci: true, leadDistributionEnabled: true },
    { id: "a", name: "Ana Assoc", role: "associate", status: "active", linkedBrokerId: "b" },
    { id: "x", name: "Velho", role: "broker", status: "inactive" }
  ];
  const team = buildHenryTeamReport({ profiles });
  assert.match(team.spoken, /três pessoas ativas|3 pessoas ativas/);
  assert.match(team.spoken, /Gestor: Carolina\./);
  assert.doesNotMatch(JSON.stringify(team), /c@x\.com|14999999999/);
  assert.equal(buildHenryTeamReport({ profiles, onlyBroker: "Gabriel Lima" }).spoken, "Gabriel é corretor, da equipe de Carolina, com CRECI e com a roleta ligada.");
});

test("captações, gastos de IA, reentradas e bases de prospecção", () => {
  const cap = buildHenryCaptacoesReport({ range, captacoes: [{ createdAt: "2026-10-20T12:00:00Z", status: "nova", propertyType: "casa", neighborhood: "Centro", ownerPhone: "14999999999", intendedPrice: 300000 }] });
  assert.match(cap.spoken, /uma captação: casa no Centro/);
  assert.doesNotMatch(cap.spoken, /14999|reais/);
  const ai = buildHenryAiCostReport({ range: month, ownerMoney: true, entries: [{ createdAt: "2026-10-20T12:00:00Z", costUsd: 3.4, feature: "henry_voice_assistant", success: true }, { createdAt: "2026-10-21T12:00:00Z", costUsd: 0.2, feature: "document", success: false }] });
  assert.match(ai.spoken, /4 dólares em (duas|2) chamadas, uma falha; o que mais gastou foi henry voice assistant/);
  assert.match(buildHenryReentriesReport({ range, report: { total: 3, brokers: [{ brokerName: "Gabriel Lima", total: 2, clients: [] }, { brokerName: "Bruna", total: 1, clients: [] }] } }).spoken, /três clientes voltaram|3 clientes voltaram/);
  assert.match(buildHenryProspectingBasesReport({ bases: [{ name: "Gabriel Lima", contactCount: 120 }, { name: "Bruna", contactCount: 0 }] }).spoken, /somam 120 contatos: Gabriel 120\./);
});
