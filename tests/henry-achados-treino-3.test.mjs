// Achados do Treino 3 do Henry (rodada real de 2026-10-25T16:42:21Z em crm_settings henry_training_reports, depois do
// deploy de 206958b), com as falas reais do dono. Ver docs/CHANGELOG_AI.md (2026-10-25, "Henry: achados do Treino 3") e
// docs/INCIDENTES.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  henryDirectRoute,
  henryPromiseRetry,
  henryPromisedAction,
  henryTurnHint,
  isPersonalQuestion,
  mentionsProperName
} from "../lib/henry-voice-turn.mjs";
import { buildHenryStaticPrompt } from "../lib/henry-voice-persona.mjs";
import { musicQueryFromText } from "../lib/henry-voice-narration.mjs";
import { buildHenryNewClientsAnswer, resolveHenryPeriod } from "../lib/henry-reports-core.mjs";
import { HENRY_TRAINING_SLOW_MS, analyzeHenryTraining, appendTrainingScenario } from "../lib/henry-training-core.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const training = readFileSync(new URL("../lib/henry-training.js", import.meta.url), "utf8");
const TODAY = "2026-10-25";
const route = (text, turns = []) => henryDirectRoute(text, { turns, today: TODAY });
const kinds = (report) => report.issues.map((issue) => issue.kind);

// Conversa do dia antes das perguntas de ranking/funil (mesma ordem da rodada real).
const DAY = [
  { role: "user", text: "Henry, e aí, como tá o ranking dessa semana?" },
  { role: "assistant", text: "Boa! O Gabriel tá liderando a semana com 654 pontos, seguido de perto pela Bruna, com 400." },
  { role: "user", text: "Beleza, deixa eu só terminar aqui. Mas me conta, como tá o funil desse mês?" },
  { role: "assistant", text: "Este mês o funil tem 1162 clientes no total, com 445 atendimentos." }
];

// 1. "E aí, Henry, como tá a meta do dia pra equipe?" → "Ainda não tenho o número da meta de hoje…" (3º treino seguido).
test("1: meta do dia da equipe SEMPRE consulta a Meta Diária da equipe (rota direta, antes do modelo)", () => {
  for (const ask of ["E aí, Henry, como tá a meta do dia pra equipe?", "Henry, e aí, como tá a meta do dia da equipe?", "Ô Henry, e a meta do dia da equipe, como tá?", "E a Meta Diária da equipe?", "como tá a meta hoje?"]) {
    assert.deepEqual(route(ask), { name: "consultar_crm", input: { assunto: "meta_equipe", periodo: "hoje" }, topic: "meta", speak: true }, ask);
  }
  assert.equal(route("e a meta de ontem da equipe?")?.input.periodo, "ontem");
  // outras perguntas da meta (quem bateu, quanto falta, de um corretor) ficam com o modelo
  assert.equal(route("Quanto falta pra bater a meta hoje?"), null);
  assert.equal(route("Quem bateu a meta hoje?"), null);
  assert.equal(route("E a meta da Carol hoje?"), null);
  // servidor: a ferramenta roda antes do modelo; frase pronta do catálogo = resposta sem rodada do modelo
  assert.match(lib, /const direct = withTools && !image && !accepted && !locked \? henryDirectRoute\(text, \{ turns: previous, today: saoPauloDateKey\(\) \}\) : null;/);
  assert.match(lib, /if \(direct\) \{\n\s+const block = \{ type: "tool_use"[\s\S]*?const content = await runTool\(block\.name, block\.input, auth, context\);/);
  assert.match(lib, /messages\.push\(\{ role: "user", content: \[\{ type: "tool_result", tool_use_id: block\.id, content \}\] \}\);/);
  // a rodada extra da pergunta ignorada agora OBRIGA uma ferramenta (o modelo recusou de novo na rodada extra)
  assert.match(lib, /content: henryUnansweredRetry\(questionPart\) \}\);\n[\s\S]{0,300}forceTool = !context\.musicPlayed;/);
  assert.match(lib, /\.\.\.\(tools && toolChoice \? \{ tool_choice: toolChoice \} : \{\}\)/);
  assert.match(lib, /const toolChoice = forceTool \? \{ type: "any" \} : null;/);
});

// 2. "Não era isso… quero saber onde a gente tá errando" → "Se quiser, eu puxo o funil…"; depois "Vou puxar o funil deste
//    mês agora e te mostrar…" (1,1 s, sem ferramenta).
test("2: diagnóstico vai direto ao funil; promessa sem ação vira rodada com ferramenta obrigatória", () => {
  const ask = "Não era isso que eu perguntei, Henry. Eu quero saber onde a gente tá errando.";
  assert.deepEqual(route(ask, DAY), { name: "funil_periodo", input: { periodo: "este_mes" }, topic: "diagnostico" });
  assert.deepEqual(route("qual o gargalo da semana passada?"), { name: "funil_periodo", input: { periodo: "semana_passada" }, topic: "diagnostico" });
  const hint = henryTurnHint({ text: ask, lastAssistant: "Este mês já são 3 vendas fechadas, bora pra mais!", turns: DAY, direct: route(ask, DAY) });
  assert.match(hint, /gargalo/);
  assert.match(hint, /não diga que vai buscar nem ofereça buscar/);
  assert.match(hint, /desculpa/);
  assert.doesNotMatch(hint, /pergunte o que ele queria saber/);
  for (const reply of [
    "Tem razão, desculpa. Vou puxar o funil deste mês agora e te mostrar onde os clientes estão emperrando.",
    "Foi mal, eu errei a leitura, desculpa. Você quer saber onde está o gargalo no funil do mês? Se quiser, eu puxo o funil deste mês pra ver em qual etapa os clientes estão parando.",
    "Ainda não tenho o número da meta de hoje aqui na conversa, e prefiro não chutar. Pergunta de novo que eu busco agora."
  ]) assert.equal(henryPromisedAction(reply), true, reply);
  // pedir um dado dele não é promessa; resposta com número também não
  assert.equal(henryPromisedAction("Sem o nome do cliente eu não consigo achar de qual você tá falando. Me diz o nome, ou o nome do corretor responsável, que eu verifico a conversa dele no WhatsApp."), false);
  assert.equal(henryPromisedAction("Este mês são 445 atendimentos e 3 vendas; vou te mostrar o resto na tela."), false);
  assert.match(henryPromiseRetry(), /Busque AGORA com a ferramenta/);
  assert.match(lib, /if \(withTools && !promiseRetried && rounds < MAX_TOOL_ROUNDS && !toolUses\.length && henryPromisedAction\(replyText\)\) \{[\s\S]*?content: henryPromiseRetry\(\) \}\);\n\s+forceTool = !context\.musicPlayed;/);
  assert.match(buildHenryStaticPrompt(), /Nunca prometa nem ofereça buscar/);
});

// 3. Lentidão: rota direta poupa a 1ª rodada do modelo; frase pronta poupa a 2ª; o Treino guarda onde foi o tempo.
test("3: rota direta sem rodada do modelo quando a ferramenta já traz a frase; Treino guarda os tempos", () => {
  assert.match(lib, /if \(spoken \|\| \(direct\.name === "spotify" && \(context\.musicPlayed \|\| context\.spotify\)\)\) \{\n\s+skipModel = true;/);
  assert.match(lib, /for \(; !skipModel && rounds <= MAX_TOOL_ROUNDS; rounds \+= 1\)/);
  assert.match(lib, /const spoken = direct\.speak && !complaint && !context\.providerFailed \? henryDirectSpeech\(content\) : "";/);
  assert.match(lib, /if \(timing\.rounds\) logModelUsage\(auth, feature, usage\);/);
  assert.match(lib, /timing\.toolNames = context\.tools\.map\(\(tool\) => tool\.name\);/);
  assert.match(training, /toolNames: Array\.isArray\(answer\.timing\?\.toolNames\)/);
  const { round } = appendTrainingScenario([], {
    roundId: "rodada-teste-3",
    scenarioLabel: "Perguntas do CRM",
    exchanges: [{ owner: "quantos clientes novos hoje?", reply: "Hoje entraram 2 clientes novos.", ms: 900, toolNames: ["consultar_crm", "rm -rf"], rounds: 0, modelMs: 0, toolsMs: 310 }]
  });
  assert.deepEqual(round.exchanges[0].toolNames, ["consultar_crm"]);
  assert.equal(round.exchanges[0].toolsMs, 310);
  assert.equal(round.exchanges[0].rounds, 0);
});

// 4. "Entraram 12 clientes novos hoje" (16:11Z) × "2" (15:22Z e 16:42Z), no mesmo dia.
test("4: clientes novos = um caminho só, a contagem do Início (leads = clientes novos)", () => {
  for (const ask of ["Henry, me fala aí, quantos cliente novo caiu no CRM hoje?", "Ô Henry, e aí, quantos cliente novo entrou hoje?", "Quantos clientes novos entraram hoje?", "tem lead novo hoje?"]) {
    assert.deepEqual(route(ask), { name: "consultar_crm", input: { assunto: "clientes_novos", periodo: "hoje" }, topic: "clientes_novos", speak: true }, ask);
  }
  assert.equal(route("quantos clientes novos entraram ontem?")?.input.periodo, "ontem");
  assert.equal(route("Quantos clientes novos a Carol recebeu hoje?"), null); // de um corretor: o modelo decide
  assert.equal(route("quais clientes novos entraram hoje?"), null); // lista de nomes: catálogo pelo modelo
  const today = resolveHenryPeriod({ periodo: "hoje" }, TODAY);
  assert.equal(buildHenryNewClientsAnswer({ range: today, leads: { total: 2, ad: 1, marketplace: 0, other: 1 } }), "Hoje entraram 2 clientes novos, 1 de anúncio.");
  assert.equal(buildHenryNewClientsAnswer({ range: today, leads: { total: 1, ad: 0, marketplace: 0, other: 1 } }), "Hoje entrou 1 cliente novo.");
  assert.equal(buildHenryNewClientsAnswer({ range: today, leads: { total: 0, ad: 0, marketplace: 0, other: 0 } }), "Hoje não entrou nenhum cliente novo.");
  assert.equal(buildHenryNewClientsAnswer({ range: today, leads: null }), null); // leitura falhou: nunca um zero falso
  // consultar_crm clientes_novos (equipe) lê a MESMA contagem do Início (loadHenryLeadOrigins), não a do catálogo
  assert.match(lib, /if \(query\.assunto === "clientes_novos" && !query\.corretor && query\.formato !== "lista"[\s\S]*?buildHenryNewClientsAnswer\(\{ range, leads: await softRead\("clientes novos", readLeadsFor\(auth, range\)\) \}\)/);
});

// 5. "ranking dessa semana" → semana; depois "Me fala do ranking primeiro." → respondeu o MÊS.
test("5: ranking sem período na fala = o último período falado sobre o ranking (senão hoje)", () => {
  const ask = "Peraí, peraí, deixa isso pra depois. Me fala do ranking primeiro.";
  assert.deepEqual(route(ask, DAY), { name: "ranking_periodo", input: { periodo: "esta_semana" }, topic: "ranking", speak: true });
  assert.deepEqual(route(ask, []), { name: "consultar_crm", input: { assunto: "ranking", periodo: "hoje" }, topic: "ranking", speak: true });
  assert.deepEqual(route("e o ranking do mês?", DAY), { name: "ranking_periodo", input: { periodo: "este_mes" }, topic: "ranking", speak: true });
  // o funil segue a mesma regra ("volta pro funil" = o mês que ele tinha pedido)
  assert.deepEqual(route("Beleza, Henry, deixa isso pra depois e volta pro funil, vamos lá.", DAY), { name: "funil_periodo", input: { periodo: "este_mes" }, topic: "funil" });
  assert.match(buildHenryStaticPrompt(), /Ranking ou funil sem período na fala: use o último período que ele falou sobre o MESMO assunto hoje/);
});

// 6. "E aí, como é que foi teu dia hoje?" → "…Entraram 2 clientes novos hoje…".
test("6: pergunta pessoal ao Henry é papo — sem ferramentas e sem número do CRM", () => {
  for (const ask of ["E aí, como é que foi teu dia hoje?", "Fala, Henry! Como foi teu dia hoje?", "e você, tá bem?", "como você tá, Henry?"]) {
    assert.equal(isPersonalQuestion(ask), true, ask);
    assert.equal(route(ask), null, ask);
    assert.match(henryTurnHint({ text: ask }), /papo de amigo, não pergunta do CRM/, ask);
  }
  // o "movimento"/"como tá o dia" do CRM continua sendo do CRM
  assert.equal(isPersonalQuestion("E aí, Henry, como é que tá o movimento hoje?"), false);
  assert.deepEqual(route("E aí, Henry, como é que tá o movimento hoje?"), { name: "relatorio_do_dia", input: {}, topic: "movimento" });
  assert.equal(isPersonalQuestion("como você tá e como tá a meta?"), false);
  assert.match(lib, /const personal = !image && !greeting && !accepted && isPersonalQuestion\(text\);/);
  assert.match(lib, /const withTools = Boolean\(image\) \|\| \(!greeting && !personal && \(/);
  assert.match(buildHenryStaticPrompt(), /Pergunta sobre VOCÊ \("como foi o teu dia\?"/);
});

// 7. "Põe um rock aí, Henry." → "Tocando rock aí! Me diz o artista ou a banda que você quer ouvir…" (sem ferramenta).
test("7: estilo pedido toca direto e só confirma (nunca pede o artista)", () => {
  assert.equal(musicQueryFromText("Põe um rock aí, Henry."), "rock");
  assert.deepEqual(route("Põe um rock aí, Henry."), { name: "spotify", input: { acao: "tocar", busca: "rock" }, topic: "musica" });
  assert.deepEqual(route("Henry, toca Legião Urbana"), { name: "spotify", input: { acao: "tocar", busca: "Legião Urbana" }, topic: "musica" });
  // volume, aparelho, "bota uma aí" e pedido composto ficam com o modelo
  assert.equal(route("Baixa um pouco o som aí, Henry."), null);
  assert.equal(route("Henry, transfere essa ligação pra Alexa."), null);
  assert.equal(route("Valeu, Henry. Bota uma aí."), null);
  assert.equal(route("Ei Henry, coloca uma coisa mais tranquila aí e depois me diz quantos clientes novos apareceram hoje."), null);
  assert.match(buildHenryStaticPrompt(), /estilo ou clima \("um rock", "algo tranquilo"\) já basta para tocar — toque e só confirme, nunca peça o artista/);
});

test("nome próprio no meio da fala = pergunta de alguém específico (fica com o modelo)", () => {
  assert.equal(mentionsProperName("Quantos clientes novos a Carol recebeu hoje?"), true);
  assert.equal(mentionsProperName("E aí, Henry, como tá a meta do dia pra equipe?"), false);
  assert.equal(mentionsProperName("Henry, me fala aí, quantos cliente novo caiu no CRM hoje?"), false);
  assert.equal(mentionsProperName("Peraí, peraí, deixa isso pra depois. Me fala do ranking primeiro."), false);
});

// 8. Detector do Treino: promessa sem ação e resposta lenta.
test("8: relatório do Treino aponta promessa sem ação e resposta lenta (> 6 s), com onde foi o tempo", () => {
  assert.equal(HENRY_TRAINING_SLOW_MS, 6000);
  const report = analyzeHenryTraining([
    { owner: "Cara, você já falou isso três vezes, tá no disco arranhado.", reply: "Tem razão, desculpa. Vou puxar o funil deste mês agora e te mostrar onde os clientes estão emperrando.", ms: 1126 },
    { owner: "Henry, me fala aí, quantos cliente novo caiu no CRM hoje?", reply: "Entraram 2 clientes novos hoje.", ms: 9786, rounds: 2, modelMs: 2400, toolsMs: 7300, toolNames: ["relatorio_do_dia"] },
    { owner: "Quantos clientes novos entraram hoje?", reply: "Hoje entraram 2 clientes novos.", ms: 900 }
  ]);
  assert.ok(kinds(report).includes("promessa_sem_acao"));
  const slow = report.issues.filter((issue) => issue.kind === "resposta_lenta");
  assert.equal(slow.length, 1);
  assert.match(slow[0].label, /9\.8 s[\s\S]*modelo 2\.4 s em 2 rodada\(s\), ferramentas 7\.3 s \(relatorio_do_dia\)/);
});
