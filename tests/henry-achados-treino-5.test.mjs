// Achados do Treino 5 do Henry (rodada automática real de 2026-10-25T18:02:42Z em crm_settings henry_training_reports),
// com as falas reais do dono. Ver docs/CHANGELOG_AI.md (2026-10-25, "Henry: achados do Treino 5") e docs/INCIDENTES.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_NO_SALES_GOAL,
  henryDirectRoute,
  henryQuestionPart,
  henryTurnHint,
  henryVolumeRequest,
  isPreviousReference,
  isVagueClientReference,
  stripSpeechLabel
} from "../lib/henry-voice-turn.mjs";
import { buildHenryStaticPrompt } from "../lib/henry-voice-persona.mjs";
import { buildHenryStageWaitingReport, buildHenryTeamGoalSizeSpeech } from "../lib/henry-reports-core.mjs";
import { isOfferClosing, trimRepeatedClosing } from "../lib/henry-repetition-core.mjs";
import { closingsFrom } from "../lib/henry-voice-persona.mjs";
import { dropReportGreeting } from "../lib/henry-morning-core.mjs";
import { analyzeHenryTraining } from "../lib/henry-training-core.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const reports = readFileSync(new URL("../lib/henry-reports.js", import.meta.url), "utf8");
const training = readFileSync(new URL("../lib/henry-training.js", import.meta.url), "utf8");
const TODAY = "2026-10-25";
const route = (text, turns = []) => henryDirectRoute(text, { turns, today: TODAY });
const kinds = (report) => report.issues.map((issue) => issue.kind);

// Conversa real do cenário "Frustração" (na ordem da rodada).
const FRUSTRATION = [
  { role: "user", text: "Cara, e aí, quantas vendas a gente fechou esse mês?" },
  { role: "assistant", text: "Esse mês já fechamos 3 vendas, e 20 clientes estão aprovados esperando a próxima etapa." }
];

// 1. "quanto a equipe precisa fechar por dia pra bater a meta?" → "Não tenho esse número fixo aqui… Quer que eu abra a tela?"
test("1: tamanho da Meta Diária da equipe pela rota direta, com número (mesma fonte da tela)", () => {
  const ask = "Henry, e aí, quanto a equipe precisa fechar por dia pra bater a meta?";
  assert.deepEqual(route(ask), { name: "consultar_crm", input: { assunto: "meta_equipe", periodo: "hoje", detalhe: "tamanho" }, topic: "meta", speak: true });
  assert.equal(route("qual é a meta de hoje?")?.input.detalhe, "tamanho");
  assert.equal(route("quanto falta pra Carol bater a meta?"), null); // de um corretor: fica com o modelo
  assert.equal(route("quanto falta para cada corretor bater a meta?"), null); // meta_cada (lista por corretor)
  assert.deepEqual(route("como tá a meta do dia pra equipe?")?.input, { assunto: "meta_equipe", periodo: "hoje" }); // percentual de sempre
  const goal = { summary: { atividadesTotal: 150, atividadesDone: 40 }, brokers: [{ total: 30 }, { total: 30 }, { total: 30 }, { total: 30 }, { total: 30 }, { total: 0 }] };
  assert.equal(buildHenryTeamGoalSizeSpeech({ goal }), "A meta de hoje da equipe soma 150 ações de prospecção e pendentes, umas 30 por corretor; já foram feitas 40, faltam 110.");
  assert.equal(buildHenryTeamGoalSizeSpeech({ goal: { ...goal, summary: { atividadesTotal: 150, atividadesDone: 160 } } }), "A meta de hoje da equipe soma 150 ações de prospecção e pendentes, umas 30 por corretor, e já está completa: foram feitas 160.");
  assert.equal(buildHenryTeamGoalSizeSpeech({ goal, periodo: "ontem" }), "Ontem a meta da equipe somava 150 ações de prospecção e pendentes, umas 30 por corretor; foram feitas 40.");
  assert.equal(buildHenryTeamGoalSizeSpeech({ goal: { summary: { atividadesTotal: 0 }, brokers: [] } }), "Hoje ainda não tem meta montada para a equipe.");
  assert.equal(buildHenryTeamGoalSizeSpeech({ goal: null }), null); // leitura falhou: nunca um zero falso
  assert.match(lib, /query\.assunto === "meta_equipe" && query\.detalhe === "tamanho"[\s\S]*?buildHenryTeamGoalSizeSpeech\(\{ goal: await softRead\("meta da equipe", readTeamGoalFor\(auth, range\)\), periodo \}\)/);
  assert.match(lib, /detalhe: \{ type: "string", enum: \["tamanho"\]/);
});

// 2. "Eu não perguntei isso… Quero saber quanto falta pra fechar essas vendas." → "só o de hoje e de ontem. Quer que eu traga…?"
test("2: quanto falta de vendas = sem meta de vendas no CRM + aprovados e vendas do funil do período, sem oferecer", () => {
  const ask = "Eu não perguntei isso, Henry. Quero saber quanto falta pra fechar essas vendas.";
  const direct = route(ask, FRUSTRATION);
  assert.deepEqual(direct, { name: "funil_periodo", input: { periodo: "este_mes" }, topic: "vendas_meta" });
  assert.deepEqual(route("quanto falta pra bater a meta de vendas da semana?")?.input, { periodo: "esta_semana" });
  const hint = henryTurnHint({ text: ask, lastAssistant: FRUSTRATION[1].text, turns: FRUSTRATION, direct });
  assert.ok(hint.includes(HENRY_NO_SALES_GOAL));
  assert.match(hint, /aprovados e as vendas/);
  assert.match(hint, /nada de oferecer/);
  assert.match(hint, /ele reclamou/);
  // A mesma conta certa depois da reclamação não vira "repetiu" (nem ao vivo, nem no Treino).
  assert.match(lib, /if \(complaint && !direct && henryRepeatedAfterComplaint\(replyText, lastAssistant\)\)/);
  const report = analyzeHenryTraining([
    { owner: FRUSTRATION[0].text, reply: FRUSTRATION[1].text },
    { owner: ask, reply: "Não tem meta de vendas cadastrada no CRM; no mês são 20 aprovados e 3 vendas." }
  ]);
  assert.equal(kinds(report).includes("repetiu_apos_reclamacao"), false);
  assert.match(buildHenryStaticPrompt(), /Não existe meta de VENDAS cadastrada no CRM/);
});

// 3. "Tá, mas e os vinte esperando? Isso não pode ficar parado." → "Esse número eu só consigo ver de hoje e de ontem…"
test("3: os aprovados esperando = lista da etapa agora (quantos, mais antigos na etapa, até 3 nomes)", () => {
  const ask = "Tá, mas e os vinte esperando? Isso não pode ficar parado.";
  const turns = [...FRUSTRATION, { role: "user", text: "Cara, dá pra resumir isso aí? Tá longo demais." }, { role: "assistant", text: "Feito: são 3 vendas no mês, com 20 aprovados esperando a próxima etapa." }];
  const etapa = { name: "consultar_crm", input: { assunto: "etapa", etapa: "aprovados", formato: "lista" }, topic: "etapa", speak: "always" };
  assert.deepEqual(route(ask, turns), etapa);
  assert.deepEqual(route("quantos aprovados estão esperando?"), etapa);
  assert.equal(route(ask, [{ role: "assistant", text: "Tem 20 conversas aguardando resposta." }]), null); // sem etapa na conversa
  // Treino 7: conversa no WhatsApp esperando resposta = rota direta das conversas aguardando (nunca a etapa).
  assert.equal(route("Henry, tem alguma conversa no WhatsApp esperando resposta?")?.name, "conversas_aguardando");
  assert.equal(route("quem tá parado há mais tempo no CRM?"), null); // parados: o catálogo de sempre
  const rows = [
    { full_name: "Ana Paula Souza", since: "2026-09-21T15:00:00Z", broker: "Bruna" },
    { full_name: "Sem nome", since: "2026-09-30T15:00:00Z" },
    { full_name: "Bruno Lima", since: "2026-10-05T15:00:00Z" },
    { full_name: "Carla", since: "2026-10-24T20:00:00Z" },
    { full_name: "Davi", since: "2026-10-25T10:00:00Z" }
  ];
  const report = buildHenryStageWaitingReport({ etapa: "aprovados", total: 20, rows, today: TODAY, stageLabel: "aprovados" });
  assert.equal(report.spoken, "Hoje 20 clientes continuam na etapa aprovado, esperando; os mais antigos na etapa são Ana há 34 dias, Bruno há 20 dias e Carla há 1 dia.");
  assert.equal(report.detail.sections[0].rows.length, 5);
  assert.equal(buildHenryStageWaitingReport({ etapa: "aprovados", total: 0, rows: [] }).spoken, "Hoje nenhum cliente continua na etapa aprovado esperando.");
  assert.equal(buildHenryStageWaitingReport({ etapa: "aprovados", total: 1, rows: [rows[2]], today: TODAY }).spoken, "Hoje 1 cliente continua na etapa aprovado, esperando; é Bruno há 20 dias.");
  assert.equal(buildHenryStageWaitingReport({ etapa: "aprovados", total: null }), null); // leitura falhou
  // Leitura: mesmos status da etapa (ETAPA_STATUSES), escopo, sem Particular, mais antigos na etapa primeiro.
  assert.match(reports, /export async function loadHenryStageClients\(auth, etapa\)/);
  assert.match(reports, /\.order\("last_status_change_at", \{ ascending: true, nullsFirst: false \}\)/);
  assert.match(reports, /applyResponsibleUserScope\(supabase\.from\("simulation_registrations"\)\.select\("id", \{ count: "exact", head: true \}\)\.in\("status", statuses\)\.is\("private_contact_at", null\), auth\)/);
  // Etapa com período longo vira AGORA (nunca a recusa "só sei para hoje e ontem").
  // (Treino 6: a mesma regra vale para todo assunto da situação de AGORA — NOW_CATALOG_TOPICS, que inclui "etapa".)
  assert.match(lib, /NOW_CATALOG_TOPICS\.has\(query\.assunto\) && query\.periodo && query\.periodo !== "hoje" && query\.periodo !== "ontem"\) query = \{ \.\.\.query, periodo: "hoje" \}/);
});

// 4. "só consigo ver de hoje e de ontem" não pode mais aparecer.
test("4: recusa de período do catálogo vira instrução das ferramentas de período; Treino acusa limitacao_periodo", () => {
  assert.match(lib, /if \(\/\^isso eu s\[oó\] sei para\\b\/i\.test\(String\(built\.speech \|\| ""\)\)\) \{\n\s+const text = JSON\.stringify\(\{ instrucao: HENRY_PERIOD_TOOLS_NOTE \}\);/);
  assert.match(lib, /HENRY_PERIOD_TOOLS_NOTE = "[^"]*funil_periodo[^"]*ranking_periodo[^"]*relatorio_periodo[^"]*nunca diga que só consegue ver hoje e ontem/);
  assert.match(buildHenryStaticPrompt(), /Nunca diga que "só consegue ver hoje e ontem"/);
  const replies = [
    "Esse número eu só consigo ver de hoje e de ontem, então não tenho como confirmar quanto tempo esses vinte estão parados.",
    "Pra esse mês eu não consigo ver quanto falta de meta de vendas por enquanto, só o de hoje e de ontem.",
    "Isso eu só sei para hoje e ontem."
  ];
  for (const reply of replies) assert.ok(kinds(analyzeHenryTraining([{ owner: "e os vinte esperando?", reply }])).includes("limitacao_periodo"), reply);
  assert.equal(kinds(analyzeHenryTraining([{ owner: "quantos clientes novos hoje?", reply: "Hoje entraram 2 clientes novos." }])).includes("limitacao_periodo"), false);
});

// 5. "E aí, aquele cliente, como é que tá?" → relatorio_do_dia (3 rodadas, 4,8 s) e "entraram 2 clientes novos".
test("5: cliente citado sem nome = pergunta o nome, sem ferramenta", () => {
  const ask = "E aí, aquele cliente, como é que tá?";
  assert.equal(isVagueClientReference(ask), true);
  assert.equal(henryQuestionPart(ask), "");
  assert.equal(route(ask), null);
  assert.match(henryTurnHint({ text: ask }), /pergunte o nome[\s\S]*nenhuma ferramenta/);
  assert.match(lib, /isCasualRequest\(text\) \|\| isVagueClientReference\(text\) \|\|/);
  for (const other of ["E aí, aquele cliente, o Bruno, como é que tá?", "como tá a Ana?", "quantos clientes novos hoje?", "me mostra aquela parada que você falou"]) {
    assert.equal(isVagueClientReference(other), false, other);
  }
  assert.equal(isPreviousReference(ask), false);
  assert.match(buildHenryStaticPrompt(), /Cliente citado sem nome/);
});

// 6. Bom dia no Treino: "Pode, pode tocar." → "Boa tarde, Matheus! …dois clientes novos" (sem sinal da música e 2º cumprimento).
test("6: aceite da música do bom dia toca a sugestão (Treino guarda qual) e o relatório não cumprimenta de novo", () => {
  // O Treino já repassa o passo pendente igual ao app (morning → mode report): é o MESMO answerMorningMusic do servidor.
  assert.match(training, /mode: morning\?\.step === "music" \|\| morning\?\.step === "style" \? "report" : "question"/);
  assert.match(training, /\.\.\.\(answer\.morningMusic \? \{ music: String\(answer\.morningMusic\)\.slice\(0, 80\) \} : \{\}\)/);
  assert.match(lib, /return music\.ok \? \{ \.\.\.report, morningMusic: query \} : report;/);
  assert.equal((lib.match(/greeted: true \}\)/g) || []).length, 4);
  assert.match(lib, /const reply = greeted \? dropReportGreeting\(composed\) : composed;/);
  assert.equal(dropReportGreeting("Boa tarde, Matheus! Olha, até agora já entraram dois clientes novos."), "Olha, até agora já entraram dois clientes novos.");
  assert.equal(dropReportGreeting("Bom dia, Matheus. Entraram 2 clientes novos."), "Entraram 2 clientes novos.");
  assert.equal(dropReportGreeting("Olha, entraram 2 clientes novos."), "Olha, entraram 2 clientes novos.");
  assert.equal(dropReportGreeting("Boa tarde!"), "Boa tarde!"); // sem relatório depois: fica
});

// 7. "Pode baixar um pouco a música, Henry?" → 2 rodadas (1,8 s).
test("7: volume com infinitivo (baixar/abaixar/aumentar) pela rota direta", () => {
  const down = { name: "spotify", input: { acao: "volume", ajuste: "mais_baixo" }, topic: "musica" };
  assert.deepEqual(route("Pode baixar um pouco a música, Henry?"), down);
  assert.deepEqual(route("dá pra abaixar o volume?"), down);
  assert.deepEqual(route("deixa o som mais baixo"), down);
  assert.deepEqual(henryVolumeRequest("pode aumentar o som?"), { acao: "volume", ajuste: "mais_alto" });
  assert.equal(henryVolumeRequest("o volume de leads baixou?"), null);
});

// 8. "Feito: são 3 vendas no mês…" → rótulo no começo.
test("8: rótulo com dois-pontos no começo sai da fala (persona + trava no código)", () => {
  assert.equal(stripSpeechLabel("Feito: são 3 vendas no mês, com 20 aprovados esperando a próxima etapa."), "São 3 vendas no mês, com 20 aprovados esperando a próxima etapa.");
  assert.equal(stripSpeechLabel("Suspense: são 116 clientes."), "São 116 clientes.");
  assert.equal(stripSpeechLabel("10:30 tem reunião."), "10:30 tem reunião.");
  assert.equal(stripSpeechLabel("Hoje entraram 2 clientes novos."), "Hoje entraram 2 clientes novos.");
  assert.match(lib, /replyText = stripSpeechLabel\(trimOpening\(replyText\)\);/);
  assert.match(buildHenryStaticPrompt(), /"Feito:"/);
});

// 9. "Quando quiser outra coisa, é só pedir." depois de um "é só chamar" no mesmo dia.
test("9: fechamento \"é só pedir/chamar/falar\" conta como o mesmo em qualquer variante", () => {
  const used = closingsFrom([{ role: "assistant", text: "Valeu, Matheus! Precisando, é só chamar." }]);
  assert.equal(trimRepeatedClosing("Tudo certo, deixo a tela de Clientes aberta. Quando quiser outra coisa, é só pedir.", used), "Tudo certo, deixo a tela de Clientes aberta.");
  assert.equal(trimRepeatedClosing("Abri a tela de Clientes, qualquer coisa é só falar.", used), "Abri a tela de Clientes.");
  for (const closing of ["é só pedir", "É só me chamar", "só falar", "tô por aqui"]) assert.equal(isOfferClosing(closing), true, closing);
  assert.equal(isOfferClosing("bora pra cima"), false);
  // sem bordão usado hoje: fica
  assert.equal(trimRepeatedClosing("Deixo a tela aberta. Quando quiser outra coisa, é só pedir.", []), "Deixo a tela aberta. Quando quiser outra coisa, é só pedir.");
});
