// Achados do Treino 2 do Henry (rodada real de 2026-10-25T16:11:25Z em crm_settings henry_training_reports), com as falas
// reais do dono. Cada correção com a sua trava. Ver docs/CHANGELOG_AI.md (2026-10-25, "Henry: achados do Treino 2") e
// docs/INCIDENTES.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HENRY_TOOL_ACCESS, isCrmQuestion } from "../lib/henry-voice-core.mjs";
import { isMusicRequest, musicPlayingLine, musicRequestPhrase, henryProgressFor } from "../lib/henry-voice-narration.mjs";
import {
  henryQuestionPart,
  henryRepeatedAfterComplaint,
  henryResumeTopic,
  henryTurnHint,
  henryUnansweredRetry,
  isHenryComplaint,
  musicRequestRest,
  pickComplaintReply,
  replyAnswersQuestion
} from "../lib/henry-voice-turn.mjs";
import { HENRY_COMPLAINT_REPLIES, buildHenryStaticPrompt, isHenryGreeting } from "../lib/henry-voice-persona.mjs";
import { buildHenryFunnelReport, buildHenryPropertiesReport, henryPeriodFromText, resolveHenryPeriod } from "../lib/henry-reports-core.mjs";
import { analyzeHenryTraining } from "../lib/henry-training-core.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const reports = readFileSync(new URL("../lib/henry-reports.js", import.meta.url), "utf8");
const TODAY = "2026-10-25";
const kinds = (report) => report.issues.map((issue) => issue.kind);

// 1. "Coloca um rock aí" → "Prontinho, já começou! rock."; "bota alguma coisa mais tranquila" → "Lá vai! música tranquila."
test("1: sem o nome da faixa, o pedido entra dentro da frase (nunca colado cru no fim)", () => {
  assert.equal(musicPlayingLine({ query: "rock" }, { opener: "Prontinho, já começou!" }), "Pronto, tocando rock.");
  assert.equal(musicPlayingLine({ query: "música tranquila" }, { opener: "Lá vai!" }), "Lá vai uma música tranquila.");
  assert.equal(musicPlayingLine({ query: "alguma coisa mais tranquila" }, { opener: "Lá vai!" }), "Lá vai uma música mais tranquila.");
  assert.equal(musicRequestPhrase("músicas animadas"), "umas músicas animadas");
  for (const opener of ["Pronto, tá tocando!", "Som na caixa!", "Tá na mão!", "Prontinho, já começou!", "Lá vai!", "Feito, já tá rolando!", "Começou!", "Música no ar!"]) {
    const line = musicPlayingLine({ query: "rock" }, { opener });
    assert.doesNotMatch(line, /[!?]\s+rock\.$/, line);
    assert.match(line, /rock\.$/);
  }
  // faixa de verdade continua igual
  assert.equal(musicPlayingLine({ name: "Evidências", artists: "Chitãozinho & Xororó" }), "Pronto, tá tocando! Evidências, de Chitãozinho & Xororó.");
  // treino e reserva do play guardam o PEDIDO como query (não como nome de faixa)
  assert.match(lib, /\? \{ query: command\.query \} : null;/);
  assert.match(lib, /context\.musicPlayed = result\.result\.playing \|\| \{ query: result\.command\.query \};/);
});

// 2. "bota alguma coisa mais tranquila aí e depois me diz quantos cliente novo entrou hoje" → só tocou a música.
test("2: pedido composto é música E pergunta (o 'cliente' da 2ª parte não desfaz a música)", () => {
  const ask = "bota alguma coisa mais tranquila aí e depois me diz quantos cliente novo entrou hoje";
  assert.equal(isMusicRequest(ask), true);
  assert.equal(musicRequestRest(ask), "me diz quantos cliente novo entrou hoje");
  assert.equal(henryQuestionPart(ask), "me diz quantos cliente novo entrou hoje");
  assert.match(henryTurnHint({ text: ask }), /DUAS partes/);
  // trava antiga continua: "coloca o cliente na tela" não é música; música sozinha não tem parte-pergunta
  assert.equal(isMusicRequest("coloca o cliente na tela"), false);
  assert.equal(henryQuestionPart("Coloca um rock aí"), "");
  assert.equal(henryQuestionPart("toca uma música pra equipe"), "");
});

test("2/3: parte-pergunta sem ferramenta do CRM e sem conteúdo ganha UMA rodada extra; música vai na frente", () => {
  assert.match(lib, /const questionPart = greeting \|\| complaint \|\| locked \? "" : henryQuestionPart\(text\);/);
  assert.match(lib, /if \(withTools && questionPart && !unansweredRetried && rounds < MAX_TOOL_ROUNDS && !toolUses\.length && !crmToolUsed && !replyAnswersQuestion\(replyText\)\) \{\n\s+unansweredRetried = true;/);
  assert.match(lib, /messages\.push\(\{ role: "user", content: henryUnansweredRetry\(questionPart\) \}\);/);
  assert.match(lib, /if \(unansweredRetried && context\.musicPlayed && replyText\) \{/);
  assert.match(henryUnansweredRetry("me diz quantos cliente novo entrou hoje"), /me diz quantos cliente novo entrou hoje[\s\S]*ferramenta/);
  // conteúdo = número, "ninguém/nenhum", detalhes na tela, falha dita ou pergunta de qual
  assert.equal(replyAnswersQuestion("Lá vai uma música mais tranquila."), false);
  assert.equal(replyAnswersQuestion("Fala, chefe! Tô bem, e você?"), false);
  assert.equal(replyAnswersQuestion("Hoje entraram 7 clientes novos."), true);
  assert.equal(replyAnswersQuestion("Ninguém bateu a meta ainda."), true);
  assert.equal(replyAnswersQuestion("Pronto, deixei os detalhes na tela."), true);
  assert.equal(replyAnswersQuestion("Não consegui buscar essa informação agora."), true);
  assert.equal(replyAnswersQuestion("Qual imóvel? Tenho o Vila Real e o Jardim das Flores."), true);
  assert.equal(replyAnswersQuestion("Ainda não batemos a meta. Quer que eu traga o número exato?"), false);
});

// 3. "E aí, Henry, beleza? Como é que tá o movimento hoje?" → "Fala, chefe! Tô bem, e você?"
test("3: cumprimento + pergunta → responde a pergunta (relatório do dia), não só o cumprimento", () => {
  const ask = "E aí, Henry, beleza? Como é que tá o movimento hoje?";
  assert.equal(isHenryGreeting(ask), false);
  assert.equal(isCrmQuestion(ask), true); // "movimento"
  assert.equal(henryQuestionPart(ask), "como e que ta o movimento hoje");
  assert.match(henryTurnHint({ text: ask }), /cumprimentou E fez uma pergunta[\s\S]*relatorio_do_dia/);
  // saudação pura continua só saudação
  for (const pure of ["Boa noite", "Valeu, Henry", "E aí, beleza?", "Oi Henry, tudo bem?"]) {
    assert.equal(henryQuestionPart(pure), "", pure);
    assert.equal(henryTurnHint({ text: pure }), "", pure);
  }
  const prompt = buildHenryStaticPrompt();
  assert.match(prompt, /Saudação JUNTO de uma pergunta[\s\S]*Nunca responda só o cumprimento/);
});

// 4. "dá uma olhada naquele imóvel que a gente falou ontem" → "Não tenho acesso aos imóveis pela voz".
test("4: imóveis e empreendimentos pela lista das telas (só leitura), preço só na tela, ambíguo pergunta qual", () => {
  assert.equal(HENRY_TOOL_ACCESS.buscar_imoveis, "leitura");
  assert.match(lib, /name: "buscar_imoveis"/);
  assert.match(reports, /buildHenryPropertiesReport\(\{ properties: await listProperties\(\), query, tipo \}\)/);
  assert.equal(isCrmQuestion("dá uma olhada naquele imóvel que a gente falou ontem"), true);
  const properties = [
    { id: "1", name: "Residencial Vila Real", builder: "Pacaembu", location: "Zona Sul", bedrooms: "2", delivery: "2027", price: "R$ 230.000", isDevelopment: true },
    { id: "2", name: "Jardim das Flores", location: "Zona Norte", bedrooms: "2", price: "R$ 199.000", isDevelopment: true },
    { id: "3", name: "Casa no Palmital", location: "Palmital", bedrooms: "3", price: "R$ 320.000", isDevelopment: false }
  ];
  const vague = buildHenryPropertiesReport({ properties, query: "naquele imóvel que a gente falou ontem" });
  assert.equal(vague.ambiguous, true);
  assert.match(vague.spoken, /Qual deles\?$/);
  assert.equal(vague.facts.opcoes.length, 3);
  const one = buildHenryPropertiesReport({ properties, query: "vila real" });
  assert.equal(one.found, true);
  assert.equal(one.spoken, "Residencial Vila Real é um empreendimento da Pacaembu, em Zona Sul, 2 quartos, entrega 2027.");
  assert.doesNotMatch(JSON.stringify(one.facts), /R\$|230/); // preço nunca vai para o modelo/voz
  assert.match(JSON.stringify(one.detail), /R\$ 230\.000/); // só na tela
  assert.equal(buildHenryPropertiesReport({ properties, query: "", tipo: "imovel" }).facts.total, 1);
  assert.match(buildHenryPropertiesReport({ properties, query: "xyz123" }).spoken, /^Não achei imóvel com esse nome\./);
  assert.match(buildHenryStaticPrompt(), /buscar_imoveis/);
});

// 5. "como tá a meta do dia pra equipe?" → "ainda não batemos a meta… Quer que eu traga o número exato?"
test("5: meta da equipe sai com o percentual E quantos bateram (catálogo da Alexa), sem oferecer o número", () => {
  // Treino 4: os mesmos dados do catálogo (percentual + quem bateu), a fala é a do Henry (buildHenryTeamGoalSpeech).
  assert.match(lib, /consultCatalog\(\{ assunto: "meta_bateram", periodo \}, context, \{ full: true \}\)[\s\S]*?buildHenryTeamGoalSpeech\(/);
  assert.match(buildHenryStaticPrompt(), /Nunca pergunte se ele quer o número/);
  const report = analyzeHenryTraining([{ owner: "como tá a meta do dia pra equipe?", reply: "Ainda não batemos a meta. Quer que eu traga o número exato?" }]);
  assert.ok(kinds(report).includes("pergunta_ignorada"));
});

// 6. "não foi isso que eu perguntei" → repetiu "Foram 3 vendas".
test("6: reclamação nunca recebe a mesma resposta: reconhece e pergunta o que ele queria", () => {
  for (const said of ["não foi isso que eu perguntei", "Não era isso", "você tá repetindo a mesma coisa", "não foi bem isso"]) assert.equal(isHenryComplaint(said), true, said);
  for (const said of ["fala de novo", "repete por favor", "isso mesmo", "não, espera, me fala do ranking primeiro"]) assert.equal(isHenryComplaint(said), false, said);
  assert.equal(henryRepeatedAfterComplaint("Foram 3 vendas.", "Foram 3 vendas."), true);
  assert.equal(henryRepeatedAfterComplaint("Foram 3 vendas este mês, chefe.", "Foram 3 vendas."), true);
  assert.equal(henryRepeatedAfterComplaint("Foi mal, entendi errado. O que você queria saber?", "Foram 3 vendas."), false);
  assert.equal(henryRepeatedAfterComplaint("Você quis dizer as aprovações? Foram 5.", "Foram 3 vendas."), false);
  const replacement = pickComplaintReply(["Foi mal, entendi errado. O que você queria saber?"], () => 0);
  assert.ok(HENRY_COMPLAINT_REPLIES.includes(replacement));
  assert.notEqual(replacement, "Foi mal, entendi errado. O que você queria saber?");
  assert.match(henryTurnHint({ text: "não foi isso que eu perguntei", lastAssistant: "Foram 3 vendas.", turns: [{ role: "user", text: "Quantas vendas a gente fez esse mês?" }, { role: "assistant", text: "Foram 3 vendas." }] }), /NÃO era o que ele perguntou[\s\S]*Quantas vendas/);
  assert.match(lib, /if \(complaint && !direct && henryRepeatedAfterComplaint\(replyText, lastAssistant\)\) \{\n\s+replyText = pickComplaintReply\(/); // Treino 5: rota direta = pergunta nova
});

// 7. "como tá o funil desse mês?" → "só consigo ver de hoje ou de ontem por voz".
test("7: funil de um período = FUNIL-PAINEL do Desempenho (getPerformanceOverview), e 'desse mês' é este mês", () => {
  assert.deepEqual(henryPeriodFromText("como tá o funil desse mês?", TODAY), { periodo: "este_mes" });
  assert.deepEqual(henryPeriodFromText("Me fala do funil do mês", TODAY), { periodo: "este_mes" });
  assert.deepEqual(henryPeriodFromText("como tá o ranking da semana?", TODAY), { periodo: "esta_semana" });
  assert.deepEqual(henryPeriodFromText("e no mês passado?", TODAY), { periodo: "mes_passado" });
  assert.equal(HENRY_TOOL_ACCESS.funil_periodo, "leitura");
  assert.match(lib, /const funnelPeriod = funnelPeriodFor\(query, context\.question\);\n\s+if \(funnelPeriod\) return await runFunnelPeriod\(funnelPeriod, auth, context\);/);
  assert.equal(henryProgressFor("funil_periodo", {}).topic, "funil");
  const range = resolveHenryPeriod({ periodo: "este_mes" }, TODAY);
  const overview = { metrics: { prospecting: 120, service: 80, simulation: 40, approvalPending: 10, approval: 8, sale: 3 }, funnel: { documentation: 15 } };
  const direct = buildHenryFunnelReport({ range, overview });
  assert.equal(direct.spoken, "Neste mês, o funil teve 120 clientes no funil, 80 atendimentos, 40 simulações, 15 em documentação, 10 enviados para aprovação, 8 aprovados e 3 vendas.");
  const positive = buildHenryFunnelReport({ range, overview: { metrics: { prospecting: 20, service: 5, simulation: 0, approvalPending: 0, approval: 0, sale: 0 }, funnel: { documentation: 0 } }, positive: true });
  assert.doesNotMatch(positive.spoken, /\b0\b|nenhum/);
  const weak = buildHenryFunnelReport({ range, overview: { metrics: {}, funnel: {} }, positive: true, slowDayPhrase: "Bora pra cima!" });
  assert.equal(weak.weak, true);
  assert.equal(weak.spoken, "Bora pra cima!");
  assert.equal(buildHenryFunnelReport({ range, overview: null }), null);
});

// 8. "Bora voltar pro funil, Henry." → respondeu sobre a tela de Clientes.
test("8: 'voltar pro funil' retoma o assunto e a pergunta dele de antes", () => {
  const turns = [
    { role: "user", text: "Me fala do funil do mês" },
    { role: "assistant", text: "Neste mês, o funil teve 120 clientes no funil." },
    { role: "user", text: "Esquece, abre a tela de clientes" },
    { role: "assistant", text: "Abrindo Clientes." }
  ];
  assert.deepEqual(henryResumeTopic("Bora voltar pro funil, Henry.", turns), { topic: "funil", previous: "Me fala do funil do mês" });
  assert.deepEqual(henryResumeTopic("Volta pro funil agora", turns), { topic: "funil", previous: "Me fala do funil do mês" });
  assert.equal(henryResumeTopic("volta pro computador", turns), null);
  assert.equal(henryResumeTopic("volta a tocar", turns), null);
  assert.match(henryTurnHint({ text: "Bora voltar pro funil, Henry.", turns }), /VOLTAR ao assunto "funil"[\s\S]*Me fala do funil do mês[\s\S]*não abra tela/);
  assert.match(lib, /const turnHint = greeting \|\| accepted \? "" : henryTurnHint\(\{ text, lastAssistant, turns: previous, direct \}\);/);
});

// 9. Detector do Treino: pergunta ignorada e resposta repetida depois da reclamação.
test("9: relatório do Treino aponta pergunta ignorada e repetição depois de 'não foi isso'", () => {
  const report = analyzeHenryTraining([
    { owner: "bota alguma coisa mais tranquila aí e depois me diz quantos cliente novo entrou hoje", reply: "Lá vai! música tranquila." },
    { owner: "E aí, Henry, beleza? Como é que tá o movimento hoje?", reply: "Fala, chefe! Tô bem, e você?" },
    { owner: "Quantas vendas a gente fez esse mês?", reply: "Foram 3 vendas." },
    { owner: "não foi isso que eu perguntei", reply: "Foram 3 vendas." },
    { owner: "Quantos clientes novos entraram hoje?", reply: "Entraram 12 clientes novos hoje." },
    { owner: "Boa noite", reply: "Boa noite! Tudo certo por aqui." }
  ]);
  const ignored = report.issues.filter((issue) => issue.kind === "pergunta_ignorada").map((issue) => issue.index);
  assert.deepEqual(ignored, [0, 1]);
  const repeated = report.issues.filter((issue) => issue.kind === "repetiu_apos_reclamacao").map((issue) => issue.index);
  assert.deepEqual(repeated, [3]);
  // reconhecer e perguntar não é repetição
  const fixed = analyzeHenryTraining([
    { owner: "Quantas vendas a gente fez esse mês?", reply: "Foram 3 vendas." },
    { owner: "não foi isso que eu perguntei", reply: "Foi mal, entendi errado. O que você queria saber?" }
  ]);
  assert.ok(!kinds(fixed).includes("repetiu_apos_reclamacao"));
  assert.ok(!kinds(fixed).includes("pergunta_ignorada"));
});
