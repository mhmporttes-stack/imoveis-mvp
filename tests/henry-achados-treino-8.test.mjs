// Achados do Treino 8 do Henry (rodada automática real de 2026-10-25T19:10:46Z, id c8b35543 em crm_settings
// henry_training_reports), com as falas reais do dono. Ver docs/CHANGELOG_AI.md (2026-10-25, "Henry: achados do Treino 8")
// e docs/INCIDENTES.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_INTERNAL_FALLBACK,
  HENRY_LOOKUP_FAIL,
  henryClaimedLookupWithoutTool,
  henryClientNameRequest,
  henryComparisonRequest,
  henryDirectRoute,
  henryPlaceClientReply,
  henryResumeTopic,
  henryTurnHint,
  isHenryDiagnosisQuestion,
  isHenryPlanRequest,
  stripInternalTalk
} from "../lib/henry-voice-turn.mjs";
import { buildHenryAwaitingReport, buildHenryBrokerComparison, buildHenryStaleClientsSpeech, henryBottleneckPlan, henryBottleneckStage, henryFunnelBottleneck, resolveHenryPeriod } from "../lib/henry-reports-core.mjs";
import { rollingOverviewIdFor } from "../lib/crm-metrics/overview-core.mjs";
import { analyzeHenryTraining } from "../lib/henry-training-core.mjs";
import { buildHenryStaticPrompt } from "../lib/henry-voice-persona.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const reports = readFileSync(new URL("../lib/henry-reports.js", import.meta.url), "utf8");
const TODAY = "2026-10-25";
const route = (text, turns = []) => henryDirectRoute(text, { turns, today: TODAY });
const kinds = (report) => report.issues.map((issue) => issue.kind);
const user = (text) => ({ role: "user", text });
const henry = (text) => ({ role: "assistant", text });

// 1. "e a dona Joana, ela já respondeu?" → "Não achei nenhum cliente chamado Joana no CRM…" e "o cliente da Vila Carvalho,
// ele já respondeu?" → "Não consegui ver essa resposta de jeito nenhum, a consulta não voltou." — as duas SEM ferramenta.
test("1: cliente com nome = buscar_clientes direto; por lugar = pergunta o nome; busca dita sem ferramenta é barrada", () => {
  assert.deepEqual(route("e a dona Joana, ela já respondeu?"), { name: "buscar_clientes", input: { clientes: [{ nome: "Joana" }] }, topic: "cliente" });
  assert.equal(route("e a dona joana, ela já respondeu?")?.input.clientes[0].nome, "joana"); // transcrição minúscula
  assert.equal(henryClientNameRequest("o cliente Bruno Souza já mandou os documentos?"), "Bruno Souza");
  // Nome solto pode ser corretora; "seu dia", "o cliente respondeu" e pedido de abrir a ficha ficam com o modelo.
  for (const other of ["e a Carol, já respondeu?", "como foi seu dia?", "o cliente respondeu?", "abre a ficha da dona Joana"]) assert.equal(henryClientNameRequest(other), "", other);
  const hint = henryTurnHint({ text: "e a dona Joana, ela já respondeu?", direct: route("e a dona Joana, ela já respondeu?") });
  assert.match(hint, /campo whatsapp \(de quem foi a última mensagem/);
  // Lugar: o cadastro não tem bairro → a pergunta do nome, fixa, sem modelo e sem rota.
  const place = "o cliente da Vila Carvalho, ele já respondeu?";
  assert.equal(route(place), null);
  assert.equal(henryPlaceClientReply(place), "Qual cliente da Vila Carvalho? Me fala o nome, mesmo que seja só o primeiro.");
  assert.equal(henryPlaceClientReply("a cliente lá do jardim são paulo já respondeu"), "Qual cliente do Jardim São Paulo? Me fala o nome, mesmo que seja só o primeiro.");
  assert.equal(henryPlaceClientReply("quantos clientes da Vila Carvalho entraram?"), "");
  assert.match(lib, /henryAlreadyOpenReply\(text, lastAssistant\) \|\| \(locked \? "" : henryPlaceClientReply\(text\)\)/);
  // Barreira geral: "não achei/a consulta não voltou" sem ferramenta de leitura → rodada que obriga; continuou → não mente.
  for (const reply of ["Não achei nenhum cliente chamado Joana no CRM, tem certeza do nome?", "Não consegui ver essa resposta de jeito nenhum, a consulta não voltou."]) {
    assert.equal(henryClaimedLookupWithoutTool(reply, [])?.kind, "busca", reply);
    assert.equal(henryClaimedLookupWithoutTool(reply, ["spotify"])?.kind, "busca", reply); // ação não é leitura
    assert.equal(henryClaimedLookupWithoutTool(reply, ["buscar_clientes"]), null, reply);
  }
  for (const fine of ["Não vi o jogo ontem, e você?", "A Joana respondeu ontem às 15h.", "Não achei a música, quer outra?"]) assert.equal(henryClaimedLookupWithoutTool(fine, []), null, fine);
  assert.match(lib, /henryClaimedActionWithoutTool\(replyText, context\.tools\.map\(\(tool\) => tool\.name\)\) \|\| \(!image && !usage\.webSearches && !locked \? henryClaimedLookupWithoutTool\(/);
  assert.match(lib, /const stillLookup = withTools && !image && !usage\.webSearches && !locked \? henryClaimedLookupWithoutTool\([\s\S]*?replyText = stillLookup\.fail;/);
  assert.equal(HENRY_LOOKUP_FAIL, "Ainda não busquei isso. Me fala de novo, por favor?");
  const report = analyzeHenryTraining([{ owner: "e a dona Joana, ela já respondeu?", reply: "Não achei nenhum cliente chamado Joana no CRM.", toolNames: [] }]);
  assert.ok(kinds(report).includes("busca_sem_ferramenta"));
  assert.equal(kinds(analyzeHenryTraining([{ owner: "e a dona Joana?", reply: "Não achei nenhum cliente chamado Joana no CRM.", toolNames: ["buscar_clientes"] }])).includes("busca_sem_ferramenta"), false);
});

// 2. "e a meta do dia da equipe, bateu ou tá faltando alguma coisa?" → "A ferramenta não entendeu essa consulta. Tenta
// perguntar de outro jeito…".
test("2: meta da equipe bateu/faltando = tamanho da Meta Diária pela rota direta; fala interna nunca chega ao dono", () => {
  const size = { name: "consultar_crm", input: { assunto: "meta_equipe", periodo: "hoje", detalhe: "tamanho" }, topic: "meta", speak: true };
  assert.deepEqual(route("e a meta do dia da equipe, bateu ou tá faltando alguma coisa?"), size);
  assert.deepEqual(route("a equipe já bateu a meta?"), size);
  assert.equal(route("Quem bateu a meta hoje?"), null); // quem bateu continua com o modelo
  assert.equal(stripInternalTalk("A ferramenta não entendeu essa consulta. Tenta perguntar de outro jeito…"), `${HENRY_INTERNAL_FALLBACK} Tenta perguntar de outro jeito…`);
  assert.equal(stripInternalTalk("Não consegui ver essa resposta, a consulta não voltou."), HENRY_INTERNAL_FALLBACK);
  assert.equal(stripInternalTalk("Uma ferramenta boa pra planilha é o Excel."), "Uma ferramenta boa pra planilha é o Excel.");
  assert.match(lib, /replyText = stripInternalTalk\(replyText\);/);
  // O "Não entendi." cru do catálogo vira instrução ao modelo (nunca a frase).
  assert.match(lib, /if \(!built\.speech \|\| \/\^n\[aã\]o entendi/);
  assert.match(lib, /const HENRY_CATALOG_RETRY_NOTE = "[^"]*Nunca fale de ferramenta, consulta ou sistema para ele/);
  assert.match(buildHenryStaticPrompt(), /Nunca fale de "ferramenta", "consulta", "sistema" ou erro interno para ele/);
  assert.ok(kinds(analyzeHenryTraining([{ owner: "e a meta?", reply: "A ferramenta não entendeu essa consulta." }])).includes("vazamento_interno"));
});

// 3. "quantas simulações o Eduardo rodou nos últimos trinta dias" … "Quem ficou em segundo?" → "Ainda não tenho o segundo
// colocado…".
test("3: posição, 'quem tá na frente' e 'e os outros' herdam métrica e período → comparar_corretores", () => {
  const turns = [user("quantas simulações o Eduardo rodou nos últimos trinta dias"), henry("O Eduardo fez 14 simulações nos últimos 30 dias.")];
  const base = { metrica: "simulacoes", periodo: "ultimos_30_dias" };
  assert.deepEqual(route("Quem ficou em segundo?", turns), { name: "comparar_corretores", input: { ...base, ordem: "mais", posicao: 2 }, topic: "comparacao", speak: true });
  assert.deepEqual(henryComparisonRequest("quem ficou em terceiro lugar?", { turns, today: TODAY }), { ...base, ordem: "mais", posicao: 3 });
  assert.deepEqual(henryComparisonRequest("quem tá na frente?", { turns, today: TODAY }), { ...base, ordem: "mais" });
  assert.deepEqual(henryComparisonRequest("e os outros?", { turns, today: TODAY }), { ...base, ordem: "mais", seguintes: true });
  assert.deepEqual(henryComparisonRequest("quem ficou em último?", { turns, today: TODAY }), { ...base, ordem: "menos" });
  // "ranking" falado antes = pontos; sem métrica na conversa recente → null (o modelo decide).
  assert.equal(henryComparisonRequest("quem ficou em segundo?", { turns: [user("como tá o ranking da semana?")], today: TODAY }).metrica, "pontos");
  assert.equal(henryComparisonRequest("quem ficou em segundo?", { turns: [user("toca um rock")], today: TODAY }), null);
  assert.equal(henryComparisonRequest("e os outros?", { turns: [], today: TODAY }), null);
  // Montagem: a posição pedida (com empate) e os seguintes.
  const range = resolveHenryPeriod({ periodo: "ultimos_30_dias" }, TODAY);
  const overview = { team: [
    { id: "1", name: "Eduardo Souza", role: "broker", gender: "male", simulation: 14 },
    { id: "2", name: "Bruna Lima", role: "broker", gender: "female", simulation: 12 },
    { id: "3", name: "Gabriel", role: "broker", gender: "male", simulation: 12 },
    { id: "4", name: "Luan", role: "broker", simulation: 3 }
  ] };
  assert.equal(buildHenryBrokerComparison({ range, overview, metric: "simulacoes", position: 2 }).spoken, "Nos últimos 30 dias, em segundo lugar em simulações ficou a Bruna, com 12, empatada com o Gabriel.");
  assert.equal(buildHenryBrokerComparison({ range, overview, metric: "simulacoes", position: 9 }).spoken, "Nos últimos 30 dias, só 4 corretores aparecem em simulações; não tem nono lugar.");
  assert.equal(buildHenryBrokerComparison({ range, overview, metric: "simulacoes", others: true }).spoken, "Nos últimos 30 dias, depois vêm a Bruna, com 12, o Gabriel, com 12 e Luan, com 3.");
  assert.match(lib, /posicao: \{ type: "integer", minimum: 1, maximum: 10/);
  assert.match(lib, /position: Number\.isInteger\(input\?\.posicao\) \? input\.posicao : null, others: input\?\.seguintes === true/);
});

// 4. consultar_corretor (30 dias) ainda 9,4 s. A rodada das 19:10:46Z rodou ~6 min depois do commit do Treino 7 (19:04:42Z,
// build de 5–10 min): muito provavelmente ainda sem o pré-cálculo; e o intervalo em datas não usava o cache.
test("4: intervalo com as datas da janela de 30 dias de hoje usa o mesmo pré-cálculo do Desempenho", () => {
  const interval = resolveHenryPeriod({ periodo: "intervalo", inicio: "2026-09-26", fim: "2026-10-25" }, TODAY);
  assert.equal(interval.id, "intervalo");
  assert.equal(rollingOverviewIdFor(interval, TODAY), "ultimos_30_dias");
  assert.equal(rollingOverviewIdFor(resolveHenryPeriod({ periodo: "intervalo", inicio: "2026-09-25", fim: "2026-10-25" }, TODAY), TODAY), null);
  assert.match(reports, /ROLLING_OVERVIEW_IDS\.includes\(range\.id\) \? range\.id : rollingOverviewIdFor\(range, getTodayInSaoPaulo\(\)\) \|\| previousOverviewIdFor/);
});

// 5. "quem tá há mais tempo sem retorno no CRM?" → parados + conversas (2 ferramentas, modelo 10,3 s, total 11,8 s).
test("5: sem retorno/sem contato/parado há mais tempo = parados (sem_contato), uma ferramenta, fala montada", () => {
  assert.deepEqual(route("quem tá há mais tempo sem retorno no CRM?"), { name: "consultar_crm", input: { assunto: "sem_contato", formato: "lista" }, topic: "parados", speak: "always" });
  assert.deepEqual(route("quantos clientes estão sem contato?")?.input, { assunto: "sem_contato", formato: "numero" });
  for (const other of ["quantas conversas estão sem retorno no WhatsApp?", "quantos aprovados estão parados?", "o funil tá parado?"]) assert.notEqual(route(other)?.input?.assunto, "sem_contato", other);
  const spoken = buildHenryStaleClientsSpeech({ count: 23, days: 3, items: [{ name: "Noemi Silva" }, { name: "Leticia" }, { name: "Lais Souza" }, { name: "Fabio" }] });
  assert.equal(spoken.spoken, "São 23 clientes há mais de 3 dias sem contato; os que estão há mais tempo são Noemi, Leticia e Lais. A lista toda está na tela.");
  assert.equal(buildHenryStaleClientsSpeech({ count: 0, days: 3, items: [] }).spoken, "Nenhum cliente está há mais de 3 dias sem contato.");
  assert.match(lib, /if \(query\.assunto === "sem_contato" && query\.formato === "lista" && !query\.corretor && query\.periodo !== "ontem"\)/);
});

// 6. "Não foi isso… quero saber por que a gente não está fechando" → "Entendi torto, foi mal. O que você quer saber?".
test("6: 'por que não fecha/não vende' = diagnóstico; a frase do gargalo vale mesmo depois de reclamação", () => {
  const diag = { name: "funil_periodo", input: { periodo: "este_mes" }, topic: "diagnostico", speak: "fixed" };
  assert.deepEqual(route("Não foi isso… quero saber por que a gente não está fechando"), diag);
  for (const ask of ["por que a equipe não vende?", "por que a gente não tá fechando venda nenhuma esse mês"]) assert.ok(isHenryDiagnosisQuestion(ask), ask);
  assert.equal(isHenryDiagnosisQuestion("por que você não fecha a tela?"), false);
  assert.match(lib, /const spoken = step\.speak && \(fixed \|\| !complaint\)/);
  assert.match(lib, /if \(complaint && direct\.speak === "fixed"\) replyText = `Foi mal\. \$\{replyText\}`;/);
});

// 7. "cadê o plano pra subir essa taxa?" → recusa.
test("7: plano = gargalo calculado + 2 ações práticas, sem inventar número", () => {
  assert.deepEqual(route("cadê o plano pra subir essa taxa?"), { name: "funil_periodo", input: { periodo: "este_mes" }, topic: "plano", speak: "fixed" });
  assert.ok(isHenryPlanRequest("e o plano?", [user("onde tá o gargalo?")]));
  assert.equal(isHenryPlanRequest("e o plano?", [user("toca um pagode")]), false);
  assert.equal(isHenryPlanRequest("me dá uma dica de música"), false);
  const gargalo = henryFunnelBottleneck({ atendimento: 300, simulacao: 120, documentacao: 60, enviadosAprovacao: 40, aprovados: 20, vendas: 3 });
  assert.equal(henryBottleneckStage(gargalo), "aprovados");
  const plan = henryBottleneckPlan(gargalo, { total: 9, rows: [{ full_name: "Ana Paula" }, { full_name: "Bruno Lima" }, { full_name: "Carla" }] });
  assert.equal(plan.spoken, "O gargalo tá entre aprovação e venda. Primeiro, chamar os aprovados que ainda não compraram: são 9, começando por Ana e Bruno. Depois, levar cada um para visita ou proposta ainda esta semana.");
  assert.ok(plan.spoken.length <= 300);
  // Sem a lista da etapa: as ações sem número nenhum.
  assert.equal(/\d/.test(henryBottleneckPlan(gargalo, null).spoken.replace(/^[^.]*\./, "")), false);
  const approval = henryFunnelBottleneck({ atendimento: 100, simulacao: 90, documentacao: 80, enviadosAprovacao: 70, aprovados: 10, vendas: 9 });
  assert.match(henryBottleneckPlan(approval, null).spoken, /revisar a documentação antes de mandar para análise/);
  assert.match(lib, /const plan = context\.directTopic === "plano" \|\| isHenryPlanRequest\(context\.question, context\.dayTurns\);/);
  assert.match(buildHenryStaticPrompt(), /2 ou 3 ações práticas e curtas; nunca recuse e nunca invente número/);
});

// 8. "117 conversas aguardam resposta, 117 atrasadas; Matheus com 24, Jennyfer com 23, Ketlin com 17."
test("8: conversas aguardando em fala de gente; o dono é 'você'", () => {
  const names = { m: "Matheus Machado", j: "Jennyfer Souza", k: "Ketlin Alves" };
  const gender = { m: "male", j: "female", k: "female" };
  const read = (opts) => buildHenryAwaitingReport({ brokerName: (id) => names[id], brokerGender: (id) => gender[id], ownerId: "m", ...opts }).spoken;
  assert.equal(read({ total: 117, late: 117, groups: [{ brokerId: "m", count: 24 }, { brokerId: "j", count: 23 }, { brokerId: "k", count: 17 }] }), "São 117 conversas esperando resposta, todas atrasadas. Você tem 24, a Jennyfer 23 e a Ketlin 17.");
  assert.equal(read({ total: 40, late: 3, groups: [{ brokerId: "j", count: 23 }, { brokerId: "m", count: 10 }] }), "São 40 conversas esperando resposta, 3 atrasadas. A Jennyfer tem 23 e você 10.");
  assert.equal(read({ total: 1, groups: [{ brokerId: "m", count: 1 }], onlyBrokerId: "m" }), "Você tem 1 conversa esperando resposta.");
  assert.doesNotMatch(read({ total: 117, late: 117, groups: [{ brokerId: "m", count: 24 }] }), /Matheus/);
  assert.match(reports, /ownerId: auth\?\.profile\?\.id \|\| ""/);
});

// 9. "voltando pro assunto do cliente, onde a gente tava?" → respondeu o funil; o último cliente citado foi a dona Joana.
test("9: retomar o cliente = o último cliente COM nome (buscar_clientes)", () => {
  const turns = [user("e a dona Joana, ela já respondeu?"), henry("…"), user("o cliente da Vila Carvalho, ele já respondeu?"), henry("Qual cliente da Vila Carvalho?"), user("como tá o funil do mês?"), henry("…")];
  const ask = "voltando pro assunto do cliente, onde a gente tava?";
  assert.equal(henryResumeTopic(ask, turns).name, "Joana");
  assert.equal(henryResumeTopic(ask, turns).needsName, false);
  assert.deepEqual(route(ask, turns), { name: "buscar_clientes", input: { clientes: [{ nome: "Joana" }] }, topic: "cliente" });
  // Só o cliente por lugar na conversa → pergunta o nome (needsName), sem ferramenta.
  assert.equal(henryResumeTopic(ask, [user("o cliente da Vila Carvalho, ele já respondeu?")]).needsName, true);
});

// 10. "me lembra do WhatsApp" (logo depois de pedir a tela) → ofereceu lembrete.
test("10: 'me lembra/fala do WhatsApp' = resumo das conversas aguardando; 'me lembra de…' segue lembrete", () => {
  const whatsapp = { name: "conversas_aguardando", input: {}, topic: "whatsapp", speak: true };
  assert.deepEqual(route("me lembra do WhatsApp"), whatsapp);
  assert.deepEqual(route("me fala do zap"), whatsapp);
  assert.equal(route("me lembra de ligar pro Bruno amanhã"), null);
});
