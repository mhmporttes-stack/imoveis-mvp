// Achados do Treino 11 do Henry (rodada automática real de 2026-10-25T21:36:02Z, id 7d98c1a4 em crm_settings
// henry_training_reports), com as falas reais do dono. Ver docs/CHANGELOG_AI.md (2026-10-25, "Henry: achados do Treino 11")
// e docs/INCIDENTES.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  henryDeepenHint,
  henryDeepenRequest,
  henryDeepenSpeech,
  henryDirectRoute,
  henryScreenOpenRequest,
  henryTurnHint,
  isBareHenryComplaint
} from "../lib/henry-voice-turn.mjs";
import { HENRY_CASUAL_FALLBACK_REPLY, HENRY_FALLBACK_REPLY, HENRY_BARRED_CASUAL_RETRY, isBarredForSpeech, safeHenryReply } from "../lib/henry-voice-core.mjs";
import { classifyMorningMusicReply, dropNightClosing } from "../lib/henry-morning-core.mjs";
import { MORNING_SUGGESTIONS, morningSuggestionMatchesGenre, rememberMorningSuggestion, todaysMorningSuggestion } from "../lib/henry-morning-music-core.mjs";
import { henryBottleneckStageFromSpeech, henryFunnelBottleneck } from "../lib/henry-reports-core.mjs";
import { drawHenryRepertoire } from "../lib/henry-voice-lexicon.mjs";
import { buildReportRewritePrompt } from "../lib/henry-voice-persona.mjs";
import { CASUAL_HISTORY_TURNS, casualModelHistory } from "../lib/henry-memory-core.mjs";
import { appendTrainingScenario, analyzeHenryTraining } from "../lib/henry-training-core.mjs";
import { isAcceptance } from "../lib/henry-navigation-core.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const TODAY = "2026-10-25";
const route = (text, turns = []) => henryDirectRoute(text, { turns, today: TODAY });
const user = (text) => ({ role: "user", text });
const henry = (text) => ({ role: "assistant", text });

test("1: piada barrada (palavra sensível) → nova rodada; sem tela, nunca 'abra a tela correspondente'", () => {
  const joke = "Sabe por que o corretor foi ao banco? Pra ver se o financiamento saía do papel, haha.";
  assert.equal(isBarredForSpeech(joke), true);
  assert.equal(isBarredForSpeech("Sabe por que o corretor levou uma escada? Pra subir de nível, haha."), false);
  assert.equal(safeHenryReply(joke), HENRY_FALLBACK_REPLY);
  assert.equal(safeHenryReply(joke, { casualFallback: true }), HENRY_CASUAL_FALLBACK_REPLY);
  assert.doesNotMatch(HENRY_CASUAL_FALLBACK_REPLY, /tela/i);
  assert.equal(isBarredForSpeech(HENRY_CASUAL_FALLBACK_REPLY), false);
  assert.match(HENRY_BARRED_CASUAL_RETRY, /OUTRA piada/);
  // Com tela, continua a frase da tela.
  assert.equal(safeHenryReply(joke, { screenFallback: true, casualFallback: true }), "Pronto, deixei os detalhes na tela.");
  // Ligação no servidor: rodada única no papo e o fallback de papo na resposta final.
  assert.match(lib, /\(greeting \|\| personal\) && !image && !barredRetried && rounds < MAX_TOOL_ROUNDS && !toolUses\.length && isBarredForSpeech\(replyText\)/);
  assert.match(lib, /casualFallback: \(greeting \|\| personal\) && !detail && !context\.navigate/);
});

test("1b: a dica da piada avisa as palavras que a voz barra", () => {
  const hint = henryTurnHint({ text: "bora de piada rapidinho pra quebrar o gelo?" });
  assert.match(hint, /financiamento, renda, salário, saldo, FGTS, cartão e senha/);
});

test("2: bom dia — 'pode ser sertanejo mesmo' depois de 'Pense em Mim' toca a sugestão (sem MIROSMAR do Zezé)", () => {
  const suggestion = MORNING_SUGGESTIONS.find((item) => item.id === "musica-pense-em-mim");
  const stored = rememberMorningSuggestion(null, suggestion, TODAY);
  const reply = classifyMorningMusicReply("Bora, pode ser sertanejo mesmo.");
  assert.equal(reply.kind, "genre");
  assert.equal(morningSuggestionMatchesGenre(todaysMorningSuggestion(stored, TODAY), reply.genre), true);
  // Registro antigo (sem o gênero guardado) → o gênero do banco pelo id.
  assert.equal(morningSuggestionMatchesGenre({ id: "musica-pense-em-mim", say: "Pense em Mim, do Leandro e Leonardo", target: {} }, reply.genre), true);
  // Gênero diferente continua tocando o gênero pedido.
  assert.equal(morningSuggestionMatchesGenre(stored.recent[0], classifyMorningMusicReply("bota um rock").genre), false);
  // Sugestão sem gênero de MIROSMAR (choice vazio) → sem "TOOOCA, MIROSMAR!".
  assert.equal(suggestion.choice, "");
  // Rock nacional sugerido + "rock" pedido = rock clássico (regra do Treino 10 mantida); "rock nacional" pedido = a sugestão.
  const legiao = MORNING_SUGGESTIONS.find((item) => item.id === "artista-legiao");
  assert.equal(morningSuggestionMatchesGenre(legiao, classifyMorningMusicReply("pode ser rock").genre), false);
  assert.equal(morningSuggestionMatchesGenre(legiao, classifyMorningMusicReply("pode ser um rock nacional").genre), true);
  // Todo item de artista/música/estilo tem gênero (menos o acústico, que não é gênero da lista).
  for (const item of MORNING_SUGGESTIONS) if (item.id !== "estilo-acustico") assert.ok(item.genre, item.id);
});

test("2b: relatório do bom dia sem fechamento de fim de dia, a qualquer hora", () => {
  const real = "Vou começar daquele jeito: TOOOCA, MIROSMAR! Ô loco, hoje já entraram clientes novos, 3 no total. Caprichou! Bom descanso, e amanhã a gente segue com esse ritmo.";
  assert.equal(dropNightClosing(real), "Vou começar daquele jeito: TOOOCA, MIROSMAR! Ô loco, hoje já entraram clientes novos, 3 no total. Caprichou!");
  assert.equal(dropNightClosing("Bom descanso!"), "");
  assert.equal(dropNightClosing("Olha, 3 clientes novos hoje. Bora pra cima!"), "Olha, 3 clientes novos hoje. Bora pra cima!");
  // A saudação do repertório do relatório é sempre a da manhã (rodada às 18h36 sorteou "Boa noite, quase hora de descansar!").
  for (let seed = 0; seed < 20; seed += 1) {
    const drawn = drawHenryRepertoire({ context: "relatorio", hour: 18, random: () => (seed + 0.5) / 20 });
    assert.ok(!drawn.items.some((item) => item.category === "saudacao_noite" || item.category === "saudacao_tarde"));
    assert.ok(drawn.items.some((item) => item.category === "saudacao_manha"));
  }
  assert.match(buildReportRewritePrompt({}), /relatório do BOM DIA/);
  assert.match(lib, /dropNightClosing\(safe\) \|\| null/);
});

test("3: 'mesma coisa de novo' depois de uma resposta boa do gargalo = os aprovados parados (nomes e dias), nunca 'você queria o quê?'", () => {
  const ask = "Onde a gente tá errando no funil esse mês?";
  const good = "Foi mal. Neste mês, o gargalo tá entre aprovação e venda: de 20 aprovados saíram só 3 vendas, uma queda de 85%.";
  const again = "Cara, você tá falando a mesma coisa de novo.";
  assert.equal(isBareHenryComplaint(again), true);
  const deepen = henryDeepenRequest(again, [user(ask), henry("Neste mês, o gargalo tá entre aprovação e venda."), user("não foi isso"), henry(good)]);
  assert.deepEqual(deepen.route, { name: "consultar_crm", input: { assunto: "etapa", etapa: "aprovados", formato: "lista" }, topic: "aprofundar", speak: "fixed" });
  assert.equal(henryDeepenSpeech("Hoje 9 clientes continuam na etapa aprovado, esperando; os mais antigos na etapa são Ana há 12 dias e Rui há 9 dias."), "Indo mais fundo no gargalo: hoje 9 clientes continuam na etapa aprovado, esperando; os mais antigos na etapa são Ana há 12 dias e Rui há 9 dias.");
  // A frase do gargalo de cada etapa vira a etapa de cima (mesma tabela do plano).
  const frase = henryFunnelBottleneck({ atendimento: 10, simulacao: 9, documentacao: 8, enviadosAprovacao: 7, aprovados: 20, vendas: 3 }).frase;
  assert.equal(henryBottleneckStageFromSpeech(frase), "aprovados");
  assert.equal(henryBottleneckStageFromSpeech("O gargalo tá entre envio para aprovação e aprovação."), "aprovacao");
  assert.equal(henryBottleneckStageFromSpeech("O gargalo tá entre documentação e envio para aprovação."), "documentacao");
  assert.equal(henryBottleneckStageFromSpeech("3 vendas no mês."), "");
  // Resposta anterior com número mas sem gargalo → o modelo aprofunda o último pedido (sem rota que repetiria a frase).
  const sales = henryDeepenRequest(again, [user("quantas vendas esse mês?"), henry("Foram 3 vendas este mês.")]);
  assert.deepEqual(sales, { route: null, request: "quantas vendas esse mês?" });
  assert.match(henryDeepenHint(sales.request, "Foram 3 vendas este mês."), /NÃO pergunte o que ele quer/);
  // Depois da pergunta genérica continua a releitura do Treino 10; resposta sem conteúdo ou com pergunta → caminho de sempre.
  assert.equal(henryDeepenRequest(again, [user("x"), henry("Foi mal. Você queria o quê: vendas, funil ou ranking?")]), null);
  assert.equal(henryDeepenRequest(again, [user("x"), henry("Quer que eu abra o funil?")]), null);
  assert.equal(henryDeepenRequest("não foi isso que eu perguntei", [user(ask), henry(good)]), null);
  assert.match(lib, /deepen \? deepen\.route : henryDirectRoute/);
  assert.match(lib, /reinterpreted \|\| deepen \? "" : \(lastAssistant && isBareHenryComplaint/);
});

test("4: 'pode abrir. Depois me mostra o WhatsApp também.' = abre o Chat na hora (abrir_tela), sem perguntar", () => {
  const real = "Beleza, pode abrir. Depois me mostra o WhatsApp também.";
  assert.equal(henryScreenOpenRequest(real), "chat");
  assert.deepEqual(route(real, [user("me fala do funil"), henry("Quer que eu abra a tela de Desempenho?")]), { name: "abrir_tela", input: { destino: "chat" }, topic: "tela" });
  assert.equal(henryScreenOpenRequest("abre o chat do marketplace"), "chat_marketplace");
  assert.equal(henryScreenOpenRequest("me mostra o zap"), "chat");
  // Resumo das conversas, pergunta e WhatsApp de alguém continuam como antes.
  assert.equal(henryScreenOpenRequest("olha o WhatsApp"), "");
  assert.equal(henryScreenOpenRequest("me fala do WhatsApp"), "");
  assert.equal(henryScreenOpenRequest("me mostra as conversas do WhatsApp esperando resposta"), "");
  assert.equal(henryScreenOpenRequest("me mostra o WhatsApp?"), "");
  assert.equal(henryScreenOpenRequest("me mostra o WhatsApp da Joana"), "");
  assert.equal(isAcceptance(real), false);
  assert.match(lib, /if \(step\.name === "abrir_tela"\) return context\.navigate \? "" : null;/);
  assert.match(lib, /const personal = !image && !greeting && !accepted && !screenOpen/);
});

test("5: papo leva só as 2 últimas trocas, sem resumo do dia nem lembretes", () => {
  const turns = [user("a"), henry("b"), user("c"), henry("d"), user("e"), henry("f")];
  assert.equal(CASUAL_HISTORY_TURNS, 4);
  assert.deepEqual(casualModelHistory(turns), [user("c"), henry("d"), user("e"), henry("f")]);
  assert.deepEqual(casualModelHistory([henry("x"), user("y"), henry("z")], 3), [user("y"), henry("z")]);
  assert.match(lib, /notes: casual \? \[\] : notes, daySummary: casual \? "" : day\.summary/);
});

test("5b: o Treino guarda o 1º texto do modelo e mostra no achado de lentidão", () => {
  const { round } = appendTrainingScenario([], { roundId: "rodada-teste-11", scenarioLabel: "Papo", exchanges: [{ scenarioId: "papo", owner: "como que foi teu dia?", reply: "Foi tranquilo por aqui!", ms: 9600, rounds: 1, modelMs: 9400, toolsMs: 0, firstTokenMs: 9100 }] });
  assert.equal(round.exchanges[0].firstTokenMs, 9100);
  const issues = analyzeHenryTraining([{ owner: "como que foi teu dia?", reply: "Foi tranquilo por aqui!", ms: 9600, rounds: 1, modelMs: 9400, toolsMs: 0, firstTokenMs: 9100 }]);
  assert.ok(issues.issues.some((issue) => /1º texto em 9\.1 s/.test(issue.label)));
});
