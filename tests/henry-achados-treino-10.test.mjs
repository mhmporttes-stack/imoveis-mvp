// Achados do Treino 10 do Henry (rodada automática real de 2026-10-25T21:17:03Z, id c329d7d9 em crm_settings
// henry_training_reports), com as falas reais do dono. Ver docs/CHANGELOG_AI.md (2026-10-25, "Henry: achados do Treino 10")
// e docs/INCIDENTES.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_BARE_COMPLAINT_REPLIES,
  HENRY_NO_SUMMARY_REPLY,
  henryComplaintFallbackHint,
  henryComplaintFallbackRequest,
  henryDirectRoute,
  henryRepeatSummaryReply,
  henryTurnHint,
  isBareHenryComplaint,
  isHenryBareComplaintReply,
  isHenryShortenRequest,
  isRepeatSummaryRequest,
  stripSpeechLabel
} from "../lib/henry-voice-turn.mjs";
import { classifyMorningMusicReply, morningGenreOf } from "../lib/henry-morning-core.mjs";
import { morningSuggestionMatchesGenre } from "../lib/henry-morning-music-core.mjs";
import { analyzeHenryTraining, appendTrainingScenario } from "../lib/henry-training-core.mjs";
import { buildHenryVisionNote, isVisualQuestion } from "../lib/henry-voice-core.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const TODAY = "2026-10-25";
const route = (text, turns = []) => henryDirectRoute(text, { turns, today: TODAY });
const user = (text) => ({ role: "user", text });
const henry = (text) => ({ role: "assistant", text });

const SALES = "Mas quantas vendas a gente fechou esse mês, hein?";
const SALES_REPLY = "Esse mês a gente fechou 3 vendas. No período, 20 clientes foram aprovados, então o gargalo tá entre aprovação e venda.";
const CLUE = "Henry, não era isso que eu perguntei. Quero saber o que eu faço pra fechar mais, não só onde trava.";
const AGAIN = "Cara, você tá falando a mesma coisa de novo.";

test("1a: reclamação COM pedido depois = plano (gargalo + 2 ações), nunca a pergunta genérica", () => {
  assert.equal(isBareHenryComplaint(CLUE), false);
  assert.deepEqual(route(CLUE, [user(SALES), henry(SALES_REPLY)]), { name: "funil_periodo", input: { periodo: "este_mes" }, topic: "plano", speak: "fixed" });
  // Pedido depois da reclamação = pista; sem objeto continua sem pista.
  assert.equal(isBareHenryComplaint("Não foi isso, me fala o que tá travando a venda."), false);
  assert.equal(isBareHenryComplaint("Não era isso que eu queria saber, quero saber como a gente vende mais."), false);
  for (const bare of ["Não foi isso que eu perguntei.", "Entendi, mas não foi isso que eu perguntei.", "Não era isso que eu queria saber.", AGAIN]) {
    assert.equal(isBareHenryComplaint(bare), true, bare);
  }
});

test("1b: 2ª reclamação logo depois da pergunta genérica = o último pedido com conteúdo", () => {
  const turns = [user(SALES), henry(SALES_REPLY), user(CLUE), henry(HENRY_BARE_COMPLAINT_REPLIES[0])];
  assert.equal(isHenryBareComplaintReply(HENRY_BARE_COMPLAINT_REPLIES[0]), true);
  assert.equal(isHenryBareComplaintReply(SALES_REPLY), false);
  assert.equal(henryComplaintFallbackRequest(AGAIN, turns), CLUE);
  assert.equal(route(henryComplaintFallbackRequest(AGAIN, turns), turns).topic, "plano");
  // Depois de uma resposta com conteúdo, a reclamação sem pista segue o caminho de sempre (pergunta genérica).
  assert.equal(henryComplaintFallbackRequest(AGAIN, [user(SALES), henry(SALES_REPLY)]), "");
  // Sem pedido real antes (só cumprimento): nada a reler.
  assert.equal(henryComplaintFallbackRequest(AGAIN, [user("Bom dia, Henry"), henry(HENRY_BARE_COMPLAINT_REPLIES[0])]), "");
  assert.match(henryComplaintFallbackHint(CLUE), /NÃO pergunte de novo/);
  // Ligação no servidor: releitura antes da resposta fixa e da rota direta.
  assert.match(lib, /henryComplaintFallbackRequest\(text, memoryTurns\.length \? memoryTurns : previous\)/);
  // Treino 11: a releitura e o aprofundamento (henryDeepenRequest) pulam a pergunta genérica.
  assert.match(lib, /\(reinterpreted \|\| deepen \? "" : \(lastAssistant && isBareHenryComplaint\(text\)/);
  assert.match(lib, /reinterpreted && !direct \? henryComplaintFallbackHint\(reinterpreted\)/);
  assert.match(lib, /henryDirectRoute\(reinterpreted \|\| text,/);
});

test("2: \"pode ser um <gênero> mesmo, tanto faz o cantor\" = o gênero (a sugestão, se for do mesmo gênero)", () => {
  const real = classifyMorningMusicReply("Pode ser um sertanejo mesmo, Henry, tanto faz o cantor.");
  assert.equal(real.kind, "genre");
  assert.equal(real.genre.id, "sertanejo");
  assert.equal(classifyMorningMusicReply("pode ser um pagode mesmo, qualquer um").genre.id, "pagode");
  assert.equal(classifyMorningMusicReply("um rock, você escolhe").genre.id, "rock");
  // Sem gênero, "tanto faz"/"qualquer um" continua aceite da sugestão.
  for (const accept of ["tanto faz o cantor", "qualquer um", "tanto faz"]) assert.equal(classifyMorningMusicReply(accept).kind, "yes", accept);
  const suggestion = { id: "estilo-sertanejo-raiz", kind: "style", say: "um sertanejo raiz de respeito", target: { query: "sertanejo raiz", type: "playlist" } };
  assert.equal(morningSuggestionMatchesGenre(suggestion, real.genre), true);
  assert.equal(morningSuggestionMatchesGenre(suggestion, classifyMorningMusicReply("pode ser um pagode mesmo").genre), false);
  // Rock nacional sugerido, "um rock" pedido = rock clássico (o gênero mais específico decide).
  assert.equal(morningGenreOf("um rock nacional das antigas rock nacional anos 80").id, "rock-nacional");
  assert.equal(morningSuggestionMatchesGenre({ say: "um rock nacional das antigas", target: { query: "rock nacional anos 80" } }, classifyMorningMusicReply("um rock").genre), false);
  assert.match(lib, /answer === "genre" && morningSuggestionMatchesGenre\(todays, reply\.genre\)/);
  // O relatório do Treino guarda a música tocada (antes sumia e parecia "não tocou").
  const { round } = appendTrainingScenario([], { roundId: "c329d7d9-1074-4e4d-b65b-e8394d15533e", scenarioLabel: "Dia inteiro", exchanges: [{ owner: "Pode ser um sertanejo mesmo", reply: "Já tô com o dia na mão.", mode: "report", music: "sertanejo raiz" }] });
  assert.equal(round.exchanges[0].music, "sertanejo raiz");
});

test("3: \"Vendas de agora: 3.\" vira frase de gente; resumo pedido = uma frase, sem consulta nova", () => {
  const real = "Vendas de agora: 3. Dá pra fechar mais agindo na etapa entre aprovação e venda, que é onde o funil mais perde gente.";
  assert.equal(stripSpeechLabel(real), "3 vendas até agora. Dá pra fechar mais agindo na etapa entre aprovação e venda, que é onde o funil mais perde gente.");
  assert.equal(stripSpeechLabel("Vendas do mês: 3."), "3 vendas no mês.");
  assert.equal(stripSpeechLabel("Feito: são 3 vendas."), "São 3 vendas."); // regra do Treino 5 intacta
  assert.equal(stripSpeechLabel("Às 10:30 tem visita."), "Às 10:30 tem visita.");
  const report = analyzeHenryTraining([{ owner: "Cara, tá longo demais. Resume aí pra mim.", reply: real }]);
  assert.ok(report.issues.some((issue) => issue.kind === "rotulo_inicio"));
  const shorten = "Cara, tá longo demais. Resume aí pra mim.";
  assert.equal(isHenryShortenRequest(shorten), true);
  assert.equal(isHenryShortenRequest("me dá o resumo do dia"), false);
  assert.match(henryTurnHint({ text: shorten, lastAssistant: SALES_REPLY, turns: [user(SALES)] }), /UMA frase natural/);
  assert.match(lib, /isHenryShortenRequest\(text\) && Boolean\(lastAssistant\)/);
});

test("4: \"me dá aquela visão de novo\" = o último resumo falado hoje, nunca a câmera", () => {
  const text = "Bora, Henry, me dá aquela visão de novo.";
  assert.equal(isVisualQuestion(text), false);
  assert.equal(isRepeatSummaryRequest(text), true);
  for (const same of ["repete aquele resumo", "aquele panorama de novo", "me dá aquele resumo de novo, Henry"]) assert.equal(isRepeatSummaryRequest(same), true, same);
  for (const camera of ["olha isso aqui", "você me vê?", "liga a câmera e me dá aquela visão de novo"]) assert.equal(isRepeatSummaryRequest(camera), false, camera);
  const funnel = "Esse mês o funil passou por 445 atendimentos, 147 simulações e 45 enviados para aprovação.";
  const turns = [user("como anda o funil desse mês?"), henry(funnel), user("O Eduardo fez quantas?"), henry("O Eduardo fez 23 simulações."), user("Aquele da semana passada"), henry("Me fala o primeiro nome.")];
  assert.equal(henryRepeatSummaryReply(text, turns), `Claro, de novo. ${funnel}`);
  assert.equal(henryRepeatSummaryReply(text, [user("oi"), henry("Oi!")]), HENRY_NO_SUMMARY_REPLY);
  assert.equal(route(text, turns), null);
  assert.match(buildHenryVisionNote({ vision: false }), /nunca a câmera/);
  assert.match(lib, /henryRepeatSummaryReply\(text, memoryTurns\.length \? memoryTurns : previous\)/);
});
