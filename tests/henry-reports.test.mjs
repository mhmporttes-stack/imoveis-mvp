import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildHenryBrokerReport,
  buildHenryClientSearch,
  buildHenryPeriodReport,
  henryPeriodFromText,
  henryReportKind,
  previousHenryPeriod,
  resolveHenryPeriod,
  sanitizeClientSearchTerm
} from "../lib/henry-reports-core.mjs";
import {
  HENRY_WAIT_PHRASES,
  NARRATION_FIRST_DELAY_MS,
  NARRATION_MIN_GAP_MS,
  RECENT_PHRASES_TO_AVOID,
  HENRY_ANSWER_SCENES,
  brokerWithArticle,
  extractSpokenFigures,
  henryInitialProgress,
  henryProgressFor,
  narrationVoiceKey,
  normalizeHenryScene,
  pickHenryAnswerScene,
  pickWaitPhrase,
  rememberPhrase,
  shouldNarrate
} from "../lib/henry-voice-narration.mjs";
import { detectBargeIn } from "../lib/henry-voice-conversation.mjs";
import { isSafeToSpeak } from "../lib/alexa-v2/sanitize.mjs";

const TODAY = "2026-10-22"; // quinta-feira

// --- Períodos ---------------------------------------------------------------------------------------------------------
test("período: 'últimos 30 dias', 'semana passada', 'mês passado' e datas viram datas de São Paulo", () => {
  assert.deepEqual(henryPeriodFromText("Henry, me dá os números dos últimos 30 dias", TODAY), { periodo: "ultimos_30_dias" });
  assert.deepEqual(henryPeriodFromText("e da semana passada?", TODAY), { periodo: "semana_passada" });
  assert.deepEqual(henryPeriodFromText("como foi o mês passado", TODAY), { periodo: "mes_passado" });
  assert.deepEqual(henryPeriodFromText("últimos sete dias", TODAY), { periodo: "ultimos_7_dias" });
  assert.deepEqual(henryPeriodFromText("últimos três meses", TODAY), { periodo: "ultimos_90_dias" });
  assert.deepEqual(henryPeriodFromText("últimos 45 dias", TODAY), { periodo: "intervalo", inicio: "2026-09-08", fim: TODAY });
  assert.deepEqual(henryPeriodFromText("quero o relatório semanal", TODAY), { periodo: "ultimos_7_dias" });
  assert.deepEqual(henryPeriodFromText("relatório mensal", TODAY), { periodo: "ultimos_30_dias" });
  assert.deepEqual(henryPeriodFromText("de 01/10 a 15/10", TODAY), { periodo: "intervalo", inicio: "2026-10-01", fim: "2026-10-15" });
  assert.deepEqual(henryPeriodFromText("de 20/12 a 31/12", TODAY), { periodo: "intervalo", inicio: "2025-12-20", fim: "2025-12-31" }); // sem ano, futuro → ano passado
  assert.equal(henryPeriodFromText("quantos leads?", TODAY), null);

  const last30 = resolveHenryPeriod({ periodo: "ultimos_30_dias" }, TODAY);
  assert.deepEqual([last30.startDate, last30.endDate, last30.days], ["2026-09-23", TODAY, 30]);
  const lastWeek = resolveHenryPeriod({ periodo: "semana_passada" }, TODAY);
  assert.deepEqual([lastWeek.startDate, lastWeek.endDate], ["2026-10-12", "2026-10-18"]); // segunda a domingo
  const lastMonth = resolveHenryPeriod({ periodo: "mes_passado" }, TODAY);
  assert.deepEqual([lastMonth.startDate, lastMonth.endDate], ["2026-09-01", "2026-09-30"]);
  const thisWeek = resolveHenryPeriod({ periodo: "esta_semana" }, TODAY);
  assert.equal(thisWeek.startDate, "2026-10-19");
  // Intervalo: datas invertidas são trocadas, fim nunca passa de hoje, no máximo 366 dias.
  const swapped = resolveHenryPeriod({ periodo: "intervalo", inicio: "2026-10-15", fim: "2026-10-01" }, TODAY);
  assert.deepEqual([swapped.startDate, swapped.endDate], ["2026-10-01", "2026-10-15"]);
  assert.equal(resolveHenryPeriod({ periodo: "intervalo", inicio: "2026-10-20", fim: "2026-12-31" }, TODAY).endDate, TODAY);
  assert.equal(resolveHenryPeriod({ periodo: "intervalo", inicio: "2020-01-01", fim: TODAY }, TODAY).days, 366);
  assert.equal(resolveHenryPeriod({ periodo: "qualquer" }, TODAY).id, "hoje");
});

test("período anterior para comparar: mesmo tamanho; mês corrente → mesmos dias do mês anterior", () => {
  const last30 = resolveHenryPeriod({ periodo: "ultimos_30_dias" }, TODAY);
  assert.deepEqual(previousHenryPeriod(last30), { id: "intervalo", startDate: "2026-08-24", endDate: "2026-09-22", days: 30 });
  const thisMonth = resolveHenryPeriod({ periodo: "este_mes" }, TODAY);
  assert.deepEqual([previousHenryPeriod(thisMonth).startDate, previousHenryPeriod(thisMonth).endDate], ["2026-09-01", "2026-09-22"]);
  const lastMonth = resolveHenryPeriod({ periodo: "mes_passado" }, TODAY);
  assert.deepEqual([previousHenryPeriod(lastMonth).startDate, previousHenryPeriod(lastMonth).endDate], ["2026-08-01", "2026-08-31"]);
  const lastWeek = resolveHenryPeriod({ periodo: "semana_passada" }, TODAY);
  assert.deepEqual([previousHenryPeriod(lastWeek).startDate, previousHenryPeriod(lastWeek).endDate], ["2026-10-05", "2026-10-11"]);
  assert.equal(henryReportKind({}, last30), "mensal");
  assert.equal(henryReportKind({}, lastWeek), "semanal");
  assert.equal(henryReportKind({ tipo: "semanal" }, last30), "semanal");
});

// --- Relatório semanal/mensal com dados de mentira (mesmo formato de slimOverview / slimTeamGoal) ----------------------
const overview = {
  range: { startDate: "2026-09-23", endDate: TODAY },
  metrics: { newClients: 150, prospecting: 900, service: 96, simulation: 58, approvalPending: 12, approval: 7, sale: 3 },
  funnel: { documentation: 21, meeting: 4 },
  team: [
    { id: "b1", name: "Ana", service: 30, simulation: 20, documentation: 8, approvalPending: 4, approval: 3, sale: 2, points: 412, newClients: 40, prospecting: 300, completedActivities: 50, overdueActivities: 1, staleContact: 2 },
    { id: "b2", name: "Bruno", service: 20, simulation: 10, documentation: 4, approvalPending: 2, approval: 1, sale: 1, points: 377, newClients: 30, prospecting: 200, completedActivities: 40, overdueActivities: 0, staleContact: 5 }
  ],
  ranking: [
    { id: "b1", name: "Ana", points: 412 },
    { id: "b2", name: "Bruno", points: 377 },
    { id: "b3", name: "Caio", points: 0 }
  ],
  attention: { overdueActivities: 3, awaitingAction: 14, staleContact: 11, noFutureActivity: 6 }
};
const previousOverview = { ...overview, metrics: { ...overview.metrics, service: 80, sale: 3, prospecting: 800 }, funnel: { documentation: 15 } };
const teamGoal = { summary: { metaPercent: 87, atividadesDone: 1040, atividadesTotal: 1196 }, brokers: [{ id: "b1", name: "Ana", percent: 104, done: 520, total: 500 }, { id: "b2", name: "Bruno", percent: 70, done: 350, total: 500 }] };
const leads = { total: 214, ad: 128, marketplace: 41, other: 45 };
const previousLeads = { total: 191, ad: 100, marketplace: 50, other: 41 };

test("relatório mensal: leads por origem, funil, ranking, Meta Diária, atenção e comparação — tudo dos dados", () => {
  const range = resolveHenryPeriod({ periodo: "ultimos_30_dias" }, TODAY);
  const report = buildHenryPeriodReport({ kind: "mensal", range, previousRange: previousHenryPeriod(range), overview, previousOverview, teamGoal, leads, previousLeads, awaitingReply: 9, cooledPending: 2 });
  assert.equal(report.detail.title, "Relatório mensal");
  const titles = report.detail.sections.map((section) => section.title);
  for (const title of ["Leads por origem", "Funil", "Ranking e pontuação", "Meta Diária", "Atenção agora"]) assert.ok(titles.includes(title), title);
  assert.ok(titles.some((title) => title.startsWith("Comparação com 24/08 a 22/09")));
  const funnel = report.detail.sections.find((section) => section.title === "Funil").rows;
  assert.deepEqual(funnel.map((row) => row.value), ["96", "58", "21", "12", "7", "3"]);
  assert.equal(funnel[0].note, "+20% (antes 80)");
  assert.equal(funnel[5].note, "igual");
  const ranking = report.detail.sections.find((section) => section.title === "Ranking e pontuação").rows;
  assert.deepEqual(ranking.map((row) => row.label), ["1º Ana", "2º Bruno"]); // quem não pontuou fica de fora
  // Fala: 3 a 5 frases, só contagens e primeiros nomes, passa na barreira da voz.
  const sentences = report.spoken.split(/(?<=[.!?])\s+/).filter(Boolean);
  assert.ok(sentences.length >= 3 && sentences.length <= 5, report.spoken);
  assert.match(report.spoken, /214 leads, 128 de anúncio e 41 do Marketplace/);
  assert.match(report.spoken, /Ana lidera o ranking com 412 pontos/);
  assert.match(report.spoken, /87%/);
  assert.match(report.spoken, /9 clientes aguardando resposta/);
  assert.ok(isSafeToSpeak(report.spoken));
  assert.equal(report.facts.meta_diaria_equipe, "87%");
  // Cena "comparativo": mesmos números da seção de comparação, período atual x anterior.
  assert.equal(report.chart.previousLabel, "24/08 a 22/09");
  assert.deepEqual(report.chart.rows.map((row) => row.label), ["Leads", "Atendimentos", "Simulações", "Aprovados", "Vendas"]);
  assert.deepEqual(report.chart.rows[0], { label: "Leads", current: 214, previous: 191 });
  const compare = report.detail.sections.find((section) => section.title.startsWith("Comparação")).rows;
  for (const row of report.chart.rows) assert.equal(String(row.current), compare.find((item) => item.label === row.label).value);
});

test("relatório: fonte que falhou vira 'indisponível', nunca um zero falso", () => {
  const range = resolveHenryPeriod({ periodo: "ultimos_7_dias" }, TODAY);
  const report = buildHenryPeriodReport({ kind: "semanal", range, previousRange: previousHenryPeriod(range), overview: null, teamGoal: null, leads, previousLeads: null, awaitingReply: null, cooledPending: null });
  assert.equal(report.facts.funil, "indisponível");
  assert.equal(report.detail.sections.find((section) => section.title === "Funil").rows[0].label, "Indisponível agora");
  assert.doesNotMatch(report.spoken, /0 atendimentos|aguardando resposta/);
  assert.equal(report.detail.sections.find((section) => section.title === "Atenção agora").rows[0].value, "—");
  assert.equal(report.chart, null); // sem período anterior → a cena usa os números da fala
});

test("corretor no período: números da linha dele, posição no ranking e 2 números no card", () => {
  const range = resolveHenryPeriod({ periodo: "este_mes" }, TODAY);
  const report = buildHenryBrokerReport({ broker: { id: "b2", name: "Bruno" }, range, overview, teamGoal });
  assert.deepEqual(report.stats, [{ label: "pontos", value: "377" }, { label: "meta", value: "70%" }]);
  assert.equal(report.facts.posicao_ranking, 2);
  assert.match(report.spoken, /Bruno neste mês: 20 atendimentos, 10 simulações, 1 aprovado e 1 venda/);
  assert.ok(isSafeToSpeak(report.spoken));
  const missing = buildHenryBrokerReport({ broker: { id: "x", name: "Zé" }, range, overview, teamGoal });
  assert.equal(missing.facts.aviso, "sem números deste corretor no período");
});

test("busca de cliente: etapa, responsável e último contato; telefone só quando pedido e só na tela", () => {
  const rows = [{ full_name: "Maria Aparecida Souza", status: "in_service", responsible_user_id: "b1", last_whatsapp_contact_at: "2026-10-20T12:00:00Z", phone: "14999990000" }];
  const base = { term: "maria", rows, statusLabel: () => "Em atendimento", brokerName: () => "Ana Lima", formatDate: () => "20/10 (há 2 dias)" };
  const plain = buildHenryClientSearch(base);
  assert.match(plain.spoken, /^Maria está em Em atendimento, com Ana/);
  assert.ok(isSafeToSpeak(plain.spoken));
  assert.equal(JSON.stringify(plain.detail).includes("14999990000"), false);
  const withPhone = buildHenryClientSearch({ ...base, withPhone: true });
  assert.equal(JSON.stringify(withPhone.detail).includes("14999990000"), true);
  assert.equal(JSON.stringify(withPhone.facts).includes("14999990000"), false); // nunca vai para o modelo/voz
  assert.match(buildHenryClientSearch({ term: "zz", rows: [] }).spoken, /Não achei/);
  assert.equal(sanitizeClientSearchTerm("Maria%_ (123) , Silva"), "Maria Silva");
});

// --- Narração e cena ----------------------------------------------------------------------------------------------------
test("eventos de progresso: chave e assunto por ferramenta; corretor com o nome e artigo", () => {
  assert.deepEqual(henryInitialProgress("question"), { progress: "inicio", topic: "geral", label: "Só um instante…" });
  assert.equal(henryInitialProgress("report").topic, "relatorio");
  assert.equal(henryProgressFor("relatorio_periodo", { tipo: "mensal" }).label, "Montando o relatório do mês…");
  assert.equal(henryProgressFor("consultar_crm", { assunto: "funil" }).topic, "funil");
  assert.equal(henryProgressFor("consultar_crm", { assunto: "ranking" }).topic, "ranking");
  assert.equal(henryProgressFor("consultar_crm", { assunto: "meta_equipe" }).topic, "meta");
  assert.equal(henryProgressFor("buscar_cliente", { nome: "x" }).topic, "clientes");
  assert.equal(henryProgressFor("abrir_tela", { destino: "clientes" }), null);
  const broker = henryProgressFor("consultar_corretor", { corretor: "carol" }, { name: "Carolina Souza", gender: "female" });
  assert.deepEqual(broker, { progress: "corretor", topic: "corretor", label: "Consultando a Carolina…", say: "Consultando a Carolina." });
  assert.equal(brokerWithArticle("Eduardo", "male"), "o Eduardo");
  assert.equal(brokerWithArticle("Kim", ""), "Kim");
});

test("gatilho de corretor no servidor: anunciado depois do reconhecimento, com foto, e o achado com os números", () => {
  const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  assert.match(lib, /progress: "corretor_achado"/);
  assert.match(lib, /photoUrl: card\?\.photoUrl/);
  // consultar_corretor e consultar_crm com nome não são anunciados antes de reconhecer o corretor.
  assert.match(lib, /block\.name === "consultar_corretor" \|\| \(block\.name === "consultar_crm" && block\.input\?\.corretor\)\) continue/);
  const route = readFileSync(new URL("../app/api/admin/henry/route.js", import.meta.url), "utf8");
  assert.match(route, /send\(henryInitialProgress\(request\.mode, \{ question: request\.question/); // evento inicial logo ao receber o pedido
  assert.ok(route.indexOf("send(henryInitialProgress") < route.indexOf("await answerHenry"));
});

test("frases de espera: banco de 20+, curtas, sem palavra que interrompa o próprio Henry e passam na barreira", () => {
  assert.ok(HENRY_WAIT_PHRASES.length >= 20);
  assert.equal(new Set(HENRY_WAIT_PHRASES.map((phrase) => phrase.id)).size, HENRY_WAIT_PHRASES.length);
  for (const phrase of HENRY_WAIT_PHRASES) {
    assert.ok(phrase.text.length <= 60, phrase.text);
    assert.ok(isSafeToSpeak(phrase.text));
    assert.equal(detectBargeIn(phrase.text, "").interrupt, false, phrase.text); // ouvido pelo microfone não corta o pedido
    assert.doesNotMatch(phrase.text, /henry/i);
  }
});

test("escolha da frase: do assunto, sem repetir as últimas 5 e nunca a anterior", () => {
  let recent = [];
  const seen = [];
  for (let index = 0; index < 40; index += 1) {
    const phrase = pickWaitPhrase({ topic: "relatorio", recentIds: recent, random: () => (index * 0.37) % 1 });
    assert.ok(phrase);
    assert.ok(!recent.slice(-RECENT_PHRASES_TO_AVOID).includes(phrase.id), `${phrase.id} repetiu`);
    seen.push(phrase.id);
    recent = rememberPhrase(recent, phrase.id);
  }
  assert.ok(new Set(seen).size >= 6);
  const first = pickWaitPhrase({ topic: "clientes", random: () => 0 });
  assert.ok(first.topics.includes("clientes"));
  assert.equal(pickWaitPhrase({ topic: "geral", recentIds: ["w1"], available: ["w1"] }), null); // só a anterior pronta → nada
  assert.equal(pickWaitPhrase({ available: [] }), null); // sem áudio da voz do Henry → silêncio
});

test("quando narrar: depois de ~0,8 s, 1 frase a cada ~2,5 s, nunca com resposta chegando ou sem áudio", () => {
  const base = { startedAt: 1000, hasAudio: true };
  assert.equal(shouldNarrate({ ...base, now: 1000 + NARRATION_FIRST_DELAY_MS - 1 }), false);
  assert.equal(shouldNarrate({ ...base, now: 1000 + NARRATION_FIRST_DELAY_MS }), true);
  assert.equal(shouldNarrate({ ...base, now: 5000, lastNarrationAt: 5000 - NARRATION_MIN_GAP_MS + 1 }), false);
  assert.equal(shouldNarrate({ ...base, now: 5000, lastNarrationAt: 5000 - NARRATION_MIN_GAP_MS }), true);
  assert.equal(shouldNarrate({ ...base, now: 5000, playing: true }), false);
  assert.equal(shouldNarrate({ ...base, now: 5000, replied: true }), false);
  assert.equal(shouldNarrate({ ...base, now: 5000, hasAudio: false }), false);
  assert.notEqual(narrationVoiceKey({ elevenVoice: "a" }, "elevenlabs"), narrationVoiceKey({ elevenVoice: "b" }, "elevenlabs"));
});

test("narração só na voz do Henry: provedor principal, nunca a voz do navegador; cache por voz", () => {
  const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  const narration = lib.slice(lib.indexOf("export async function getHenryNarration"), lib.indexOf("// \"Ouvir amostra\""));
  assert.match(narration, /primaryOnly: true/);
  assert.match(narration, /if \(!voiceKey\) return \{ voiceKey: "", phrases: \[\] \}/);
  const client = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(client, /if \(clip\.narration && !clip\.audio\?\.base64\)/); // sem áudio: nada (nunca speakBrowser)
  assert.match(client, /queue\.playing && queue\.narrating/); // a resposta espera a frase atual terminar
  assert.match(client, /sessionStorage/);
});

// --- "Quando eu pergunto uma informação, ele passa outras" (dono, 2026-10-22) ------------------------------------------
test("pergunta sobre UM indicador: só ele vai ao modelo e à voz; prompt manda responder só o perguntado", async () => {
  const { HENRY_BROKER_METRIC_IDS } = await import("../lib/henry-reports-core.mjs");
  const range = resolveHenryPeriod({ periodo: "hoje" }, TODAY);
  const report = buildHenryBrokerReport({ broker: { id: "b2", name: "Gabriel" }, range, overview: { ...overview, team: [{ ...overview.team[1], name: "Gabriel" }] }, teamGoal, metric: "atendimentos" });
  assert.equal(report.spoken, "Gabriel teve 20 atendimentos hoje.");
  assert.deepEqual(Object.keys(report.facts), ["corretor", "periodo", "atendimentos"]);
  assert.doesNotMatch(report.spoken, /simula|venda|aprova/);
  assert.deepEqual(report.stats, [{ label: "atendimentos", value: "20" }]);
  assert.ok(report.detail.sections[0].rows.length > 5); // o detalhe completo continua na tela
  assert.match(buildHenryBrokerReport({ broker: { id: "b2", name: "Gabriel" }, range, overview, teamGoal, metric: "ranking" }).spoken, /2º no ranking/);
  assert.ok(HENRY_BROKER_METRIC_IDS.includes("vendas"));
  const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  assert.match(lib, /metrica: \{ type: "string", enum: HENRY_BROKER_METRIC_IDS/);
  assert.match(lib, /metric: String\(input\?\.metrica \|\| ""\)/);
  const { buildHenryStaticPrompt } = await import("../lib/henry-voice-persona.mjs");
  const prompt = buildHenryStaticPrompt();
  assert.match(prompt, /Responda SÓ o que foi perguntado, em 1 frase/);
  assert.match(prompt, /Não liste outros indicadores, a não ser que ele peça "detalhes" ou "resumo"/);
  assert.match(prompt, /Quer que eu veja as simulações dele também\?/);
});

test("selo de posição no card: só com ranking/pontos (ou resumo) e quando o corretor está no ranking", () => {
  const range = resolveHenryPeriod({ periodo: "este_mes" }, TODAY);
  assert.equal(buildHenryBrokerReport({ broker: { id: "b2", name: "Bruno" }, range, overview, teamGoal, metric: "pontos" }).position, 2);
  assert.equal(buildHenryBrokerReport({ broker: { id: "b2", name: "Bruno" }, range, overview, teamGoal }).position, 2);
  assert.equal("position" in buildHenryBrokerReport({ broker: { id: "b2", name: "Bruno" }, range, overview, teamGoal, metric: "atendimentos" }), false);
  assert.equal("position" in buildHenryBrokerReport({ broker: { id: "x", name: "Zé" }, range, overview, teamGoal, metric: "pontos" }), false);
  const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  assert.match(lib, /\.\.\.\(Number\.isInteger\(position\) && position > 0 \? \{ position \} : \{\}\)/);
  const client = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(client, /broker\.position > 0 \? \{ position: broker\.position \} : \{\}/);
});

// --- Cena da resposta (dono, 2026-10-22: "cenas diferentes por tipo de pergunta") ---------------------------------------
test("cena da resposta: escolhida pelas ferramentas chamadas, sem IA extra", () => {
  const tool = (name, input = {}) => ({ name, input });
  assert.equal(pickHenryAnswerScene({ tools: [tool("consultar_corretor", { corretor: "Carol" })] }), "corretor");
  assert.equal(pickHenryAnswerScene({ tools: [tool("consultar_crm", { assunto: "ranking" })] }), "corretor");
  assert.equal(pickHenryAnswerScene({ tools: [tool("consultar_crm", { assunto: "pontos", corretor: "Ana" })] }), "corretor");
  assert.equal(pickHenryAnswerScene({ tools: [tool("consultar_crm", { assunto: "prospeccao_equipe" })] }), "numeros");
  assert.equal(pickHenryAnswerScene({ tools: [tool("relatorio_do_dia")] }), "numeros");
  assert.equal(pickHenryAnswerScene({ mode: "report" }), "numeros"); // "bom dia, Henry"
  assert.equal(pickHenryAnswerScene({ tools: [tool("relatorio_periodo", { tipo: "semanal" })] }), "comparativo");
  assert.equal(pickHenryAnswerScene({ tools: [tool("consultar_crm", { assunto: "funil", periodo: "semana_passada" })] }), "comparativo");
  assert.equal(pickHenryAnswerScene({ tools: [tool("buscar_cliente", { nome: "Ana" })] }), "cliente");
  assert.equal(pickHenryAnswerScene({ tools: [tool("abrir_tela", { destino: "clientes" })] }), "cliente");
  assert.equal(pickHenryAnswerScene({ tools: [], webSearches: 2 }), "web");
  assert.equal(pickHenryAnswerScene({ memory: true }), "memoria");
  assert.equal(pickHenryAnswerScene({ tools: [] }), "conversa"); // papo, piada, elogio
  assert.equal(pickHenryAnswerScene(), "conversa");
  for (const kind of ["corretor", "numeros", "comparativo", "cliente", "web", "memoria", "conversa"]) assert.ok(HENRY_ANSWER_SCENES.includes(kind));
});

test("cena da resposta: só tipos conhecidos e gráfico numérico chegam à tela", () => {
  assert.equal(normalizeHenryScene(null), null);
  assert.equal(normalizeHenryScene({ kind: "<script>" }), null);
  assert.deepEqual(normalizeHenryScene({ kind: "numeros", chart: { rows: [{ label: "x", current: 1, previous: 2 }] } }), { kind: "numeros" });
  const scene = normalizeHenryScene({ kind: "comparativo", chart: { currentLabel: "Últimos 7 dias", previousLabel: "08/10 a 14/10", rows: [{ label: "Leads", current: 30, previous: 20 }, { label: "ruim", current: "x", previous: 1 }] } });
  assert.deepEqual(scene.chart.rows, [{ label: "Leads", current: 30, previous: 20 }]);
  assert.equal(scene.chart.previousLabel, "08/10 a 14/10");
});

test("números da fala para os contadores: só o que ele falou, sem hora/data/ano/posição", () => {
  assert.deepEqual(extractSpokenFigures("Hoje entraram 12 leads e 5 clientes aguardando resposta."), [
    { value: 12, decimals: 0, suffix: "", label: "leads" },
    { value: 5, decimals: 0, suffix: "", label: "clientes aguardando resposta" }
  ]);
  assert.deepEqual(extractSpokenFigures("A equipe tá em 87% da meta, faltam 1.040 atividades.").map((item) => [item.value, item.suffix, item.label]), [[87, "%", "da meta"], [1040, "", "atividades"]]);
  assert.deepEqual(extractSpokenFigures("Reunião às 14h do dia 22 de outubro de 2026, com 3 clientes.").map((item) => item.value), [3]);
  assert.deepEqual(extractSpokenFigures("A Carol é a 2º no ranking com 412 pontos.").map((item) => item.value), [412]);
  assert.equal(extractSpokenFigures("7,5 por cento de conversão")[0].value, 7.5);
  assert.deepEqual(extractSpokenFigures("Boa noite, Matheus! E aí, tudo certo?"), []);
  assert.equal(extractSpokenFigures("1 2 3 4 5 6").length, 3);
});

test("cena da resposta vai no stream e na resposta JSON; comparativo leva o gráfico do relatório", () => {
  const route = readFileSync(new URL("../app/api/admin/henry/route.js", import.meta.url), "utf8");
  assert.match(route, /scene: answer\.scene \|\| null/);
  const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
  assert.match(lib, /pickHenryAnswerScene\(\{ tools: context\.tools, webSearches: usage\.webSearches \}\)/);
  assert.match(lib, /context\.chart = report\.chart/);
});
