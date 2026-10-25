// Achados do Treino do Henry de 2026-10-25 (rodada real em crm_settings henry_training_reports): cada correção com a
// sua trava. Ver docs/CHANGELOG_AI.md (2026-10-25, "Henry: achados do Treino") e docs/INCIDENTES.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HENRY_CUT_REPLY_RETRY, HENRY_TOOL_ACCESS, isCrmQuestion, isCutReply } from "../lib/henry-voice-core.mjs";
import { buildHenryRankingReport, buildHenryClientsReport, resolveHenryPeriod } from "../lib/henry-reports-core.mjs";
import { clientFirstNameOf, firstNameOf } from "../lib/alexa-v2/text.mjs";
import { derivePendencias } from "../lib/crm-metrics/team-goal-core.mjs";
import { HENRY_GOODBYES, HENRY_STYLE_GUIDE, buildHenryStaticPrompt } from "../lib/henry-voice-persona.mjs";
import { HENRY_LEXICON } from "../lib/henry-voice-lexicon.mjs";
import { trimRepeatedClosing } from "../lib/henry-repetition-core.mjs";
import { analyzeHenryTraining, offersUndoableAction } from "../lib/henry-training-core.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const teamGoal = readFileSync(new URL("../lib/crm-metrics/team-goal.js", import.meta.url), "utf8");
const kinds = (report) => report.issues.map((issue) => issue.kind);

// 1. "e a meta do dia da equipe, como tá?" → "Nenhuma delas" (875 ms): resposta cortada virava a fala.
test("1: resposta cortada é reconhecida (e resposta curta completa não)", () => {
  assert.equal(isCutReply("Nenhuma delas"), true);
  assert.equal(isCutReply("Ninguém bateu a meta."), false);
  assert.equal(isCutReply("Nenhuma simulação hoje."), false);
  assert.equal(isCutReply("Tá em 40"), false); // tem número
  assert.equal(isCutReply(""), false);
  assert.equal(isCrmQuestion("Ô Henry, e a meta do dia da equipe, como tá?"), true);
  assert.equal(isCrmQuestion("tem alguma conversa no WhatsApp esperando resposta?"), true);
  assert.equal(isCrmQuestion("Valeu, Henry, obrigado pela força"), false);
  assert.equal(isCrmQuestion("Me conta uma piada"), false);
});

test("1: stream sem fim vira erro (nunca resposta) e tenta de novo sem stream se nada foi para a voz", () => {
  assert.match(lib, /if \(!message\.stop_reason\) throw Object\.assign\(new Error\(".*?"\), \{ code: "stream_incomplete", textEmitted \}\)/);
  assert.match(lib, /if \(error\?\.code !== "stream_incomplete" \|\| error\.textEmitted\) throw error;/);
  assert.match(lib, /const data = await callAnthropic\(payload\);/);
});

test("1: resposta cortada a pergunta do CRM ganha UMA rodada extra pedindo a resposta completa", () => {
  assert.match(lib, /const crmQuestion = !greeting && isCrmQuestion\(text\);/);
  assert.match(lib, /if \(withTools && crmQuestion && !cutRetried && rounds < MAX_TOOL_ROUNDS && !toolUses\.length && isCutReply\(replyText\)\) \{\n\s+cutRetried = true;/);
  assert.match(lib, /messages\.push\(\{ role: "user", content: HENRY_CUT_REPLY_RETRY \}\);/);
  assert.match(HENRY_CUT_REPLY_RETRY, /ferramentas/);
});

// 2. "como tá o ranking da semana?" → "Então não dá pra trazer a semana por voz agora."
test("2: ranking de um período sai do mesmo overview do Desempenho, com números", () => {
  const range = resolveHenryPeriod({ periodo: "esta_semana" }, "2026-10-25");
  const overview = { ranking: [{ name: "Carol Souza", points: 120 }, { name: "Gabriel Lima", points: 90 }, { name: "Ketlin", points: 70 }, { name: "Zé", points: 0 }] };
  const report = buildHenryRankingReport({ range, overview });
  assert.equal(report.spoken, "Nesta semana, quem lidera o ranking é Carol, com 120 pontos; depois vêm Gabriel, com 90 e Ketlin, com 70.");
  assert.deepEqual(report.facts.ranking.map((row) => row.nome), ["Carol", "Gabriel", "Ketlin"]);
  assert.equal(report.detail.sections[0].rows.length, 3);
  assert.equal(buildHenryRankingReport({ range, overview: { ranking: [] } }).spoken, "Ninguém pontuou nesta semana.");
  assert.equal(buildHenryRankingReport({ range, overview: null }), null); // falha de leitura → "não consegui", nunca zero falso
});

test("2: ferramenta ranking_periodo (só leitura) e consultar_crm de ranking fora de hoje/ontem vai para ela", () => {
  assert.equal(HENRY_TOOL_ACCESS.ranking_periodo, "leitura");
  assert.match(lib, /name: "ranking_periodo"/);
  assert.match(lib, /const rankingPeriod = rankingPeriodFor\(query, context\.question\);\n\s+if \(rankingPeriod\) return await runRankingPeriod\(rankingPeriod, auth, context\);/);
  assert.match(lib, /if \(!periodo \|\| periodo === "hoje" \|\| periodo === "ontem"\) return null;/);
  const prompt = buildHenryStaticPrompt();
  assert.match(prompt, /Ranking\/pontuação da semana, do mês ou de outro período: ranking_periodo/);
});

test("2: conector \"então\" nunca abre a resposta", () => {
  assert.match(HENRY_STYLE_GUIDE, /só NO MEIO[^\n]*nunca para abrir a resposta/);
});

// 3. "Suspense: são 116 conversas…" — o rótulo da estrutura do guia vazava para a fala.
test("3: guia de estilo sem rótulo de estrutura e com a proibição de rótulo com dois-pontos", () => {
  assert.doesNotMatch(HENRY_STYLE_GUIDE, /Suspense curto \+ número/);
  assert.doesNotMatch(HENRY_STYLE_GUIDE, /\w+ \+ (número|resposta)/);
  assert.match(HENRY_STYLE_GUIDE, /nunca escreva o nome do jeito nem um rótulo com dois-pontos no começo da fala/);
});

// 4. "a Noemi, a Sem, a Leticia" — cliente "Sem nome" virava o nome "Sem".
test("4: cliente sem nome real não vira nome falado", () => {
  for (const value of ["Sem nome", "sem nome cadastrado", "Cliente", "", "  ", "(14) 99999-0000", "."]) assert.equal(clientFirstNameOf(value), "", value);
  assert.equal(clientFirstNameOf("Noemi Alves"), "Noemi");
  assert.equal(clientFirstNameOf("Lu"), "Lu");
  assert.equal(firstNameOf("Sem nome"), "Sem"); // a função de nome de CORRETOR continua igual
  const payload = { brokers: [{ name: "Ana", remaining: 3, clients: [{ name: "Noemi", days: 20 }, { name: "", days: 15 }, { name: "Leticia", days: 9 }] }] };
  const view = derivePendencias(payload, "sem_contato");
  assert.equal(view.count, 3); // a contagem continua a real
  assert.deepEqual(view.items.map((item) => item.name), ["Noemi", "Leticia"]);
  assert.deepEqual(derivePendencias(payload, "pendencias").items.map((item) => item.name), ["Noemi", "Leticia"]);
  assert.match(teamGoal, /name: clientFirstNameOf\(client\.fullName\)/);
  assert.doesNotMatch(teamGoal, /firstNameOf\(client\.fullName\) \|\| "Cliente"/);
});

test("4: ficha de cliente sem nome na voz = \"Cliente sem nome\"", () => {
  const report = buildHenryClientsReport({ results: [{ query: "x", rows: [{ id: "1", full_name: "Sem nome", status: "atendimento", responsible_user_id: "b" }], details: new Map() }], brokerName: () => "Ana" });
  assert.doesNotMatch(JSON.stringify(report), /"primeiro_nome":"Sem"/);
});

// 5. "Se quiser, eu já deixo a agenda de amanhã pronta pra você só olhar." — o Henry só consulta.
test("5: prompt proíbe oferecer ação que o Henry não faz", () => {
  assert.match(buildHenryStaticPrompt(), /Nunca ofereça nem prometa o que você não faz/);
  assert.equal(offersUndoableAction("Dia puxado, né? Se quiser, eu já deixo a agenda de amanhã pronta pra você só olhar."), true);
  assert.equal(offersUndoableAction("Quer que eu mande uma mensagem pro Gabriel?"), true);
  assert.equal(offersUndoableAction("Quer que eu abra a tela de Pontuação?"), false);
  assert.equal(offersUndoableAction("Pronto, deixei os detalhes na tela."), false);
  assert.equal(offersUndoableAction("Se quiser, toco alguma coisa mais calma."), false);
});

// 6. "é só chamar" em quase todo agradecimento.
test("6: fechamento parecido com um de hoje sai do fim da resposta", () => {
  const used = ["Qualquer coisa, é só chamar"];
  assert.equal(trimRepeatedClosing("De nada, chefe! Quando quiser, é só chamar.", used), "De nada, chefe!");
  assert.equal(trimRepeatedClosing("Tmj, chefe! Qualquer coisa é só chamar.", used), "Tmj, chefe!");
  assert.equal(trimRepeatedClosing("De nada, qualquer coisa é só chamar.", used), "De nada.");
  assert.equal(trimRepeatedClosing("De nada, chefe! Quando quiser, é só chamar.", []), "De nada, chefe! Quando quiser, é só chamar."); // sem final hoje
  assert.equal(trimRepeatedClosing("É só chamar.", used), "É só chamar."); // não sobra resposta: fica
  assert.equal(trimRepeatedClosing("Entraram 12 clientes novos. Quer que eu abra a lista?", used), "Entraram 12 clientes novos. Quer que eu abra a lista?");
  assert.equal(trimRepeatedClosing("A Carol lidera. O cliente Gabriel chamou no WhatsApp.", used), "A Carol lidera. O cliente Gabriel chamou no WhatsApp.");
  assert.match(lib, /replyText = trimRepeatedClosing\(replyText, promptExtras\.usedClosings\);/);
});

test("6: bancos de frases e prompt sem o bordão \"é só chamar\" como exemplo", () => {
  assert.ok(!HENRY_GOODBYES.some((text) => /é só chamar/i.test(text)));
  assert.ok(!Object.values(HENRY_LEXICON).some((category) => category.items.some((text) => /é só chamar/i.test(text))));
  assert.match(buildHenryStaticPrompt(), /Bordão de "estou à disposição"[^\n]*evite/);
});

// 7. O relatório do Treino não apontou 1, 3 e 4 (issueCounts quase vazio).
test("7: o relatório do Treino aponta fragmento, rótulo, nome suspeito e oferta indevida (falas reais da rodada)", () => {
  const report = analyzeHenryTraining([
    { owner: "Hoje eu tô meio esgotado, viu.", reply: "Dia puxado, né? Vai com calma, o resto a gente resolve por partes. Se quiser, eu já deixo a agenda de amanhã pronta pra você só olhar." },
    { owner: "Henry, me fala aí quem tá parado no CRM há mais tempo?", reply: "Os que estão há mais tempo sem contato são a Noemi, a Sem, a Leticia, a Lais e o Fabio, e mais uns 130 na lista. Os detalhes com as datas estão na tela." },
    { owner: "Ô Henry, tem alguma conversa no WhatsApp esperando resposta?", reply: "Suspense: são 116 conversas esperando resposta no WhatsApp. Você tem 23 delas, a Jennyfer tem 23 e a Ketlin tem 17." },
    { owner: "Ô Henry, e a meta do dia da equipe, como tá?", reply: "Nenhuma delas" }
  ]);
  const found = report.issues.map((issue) => `${issue.kind}#${issue.index}`);
  for (const expected of ["oferta_indevida#0", "nome_suspeito#1", "rotulo_inicio#2", "fragmento#3"]) assert.ok(found.includes(expected), `${expected} em ${found.join(" ")}`);
});

test("7: sem falso positivo nas respostas boas", () => {
  const report = analyzeHenryTraining([
    { owner: "quantos clientes novos entraram hoje?", reply: "Entraram 2 clientes novos hoje." },
    { owner: "e a meta da equipe?", reply: "Ninguém bateu a meta ainda." },
    { owner: "valeu, Henry", reply: "Imagina, parceiro!" },
    { owner: "que horas são?", reply: "São 10:30, dá tempo de muita coisa." },
    { owner: "quem tá esperando?", reply: "A Carol tem 3 clientes novos esperando e o Cliente da Vila Barros já foi atendido." }
  ]);
  for (const kind of ["fragmento", "rotulo_inicio", "nome_suspeito", "oferta_indevida"]) assert.ok(!kinds(report).includes(kind), `${kind}: ${JSON.stringify(report.issues)}`);
});
