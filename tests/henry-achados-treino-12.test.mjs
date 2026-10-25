// Achados do Treino 12 do Henry (rodada automática real de 2026-10-25T21:57:47Z, id 07115a45 em crm_settings
// henry_training_reports), com as falas reais do dono. Ver docs/CHANGELOG_AI.md (2026-10-25, "Henry: achados do Treino 12").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  henryComplaintFallbackRequest,
  henryDeepenRequest,
  henryDiagnosisDeepenRequest,
  henryDirectRoute,
  henryShortenedReply,
  henrySpokenPeriod,
  henryTurnHint,
  isBareHenryComplaint,
  isHenryDiagnosisQuestion,
  isHenryShortenRequest
} from "../lib/henry-voice-turn.mjs";
import { classifyMorningMusicReply, morningMusicChangeLine } from "../lib/henry-morning-core.mjs";
import { MORNING_SUGGESTIONS, morningGenreTarget, morningSuggestionMatchesGenre } from "../lib/henry-morning-music-core.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const TODAY = "2026-10-25";
const user = (text) => ({ role: "user", text });
const henry = (text) => ({ role: "assistant", text });

const ASK = "Cadê o número das vendas desse mês?";
const SALES = "Neste mês foram 30 atendimentos, 20 aprovados e 3 vendas. O gargalo tá entre aprovação e venda, uma queda de 85%.";
const COMPLAINT = "Eu não perguntei isso, Henry. Quero saber onde a gente perde o cliente, não o número cheio.";
const PROMISE = "Foi mal, eu errei a leitura. Quer dizer, em qual etapa do funil a gente mais perde cliente? Me deixa conferir isso no período certo.";
const AGAIN = "Cara, você tá falando a mesma coisa de novo.";
const DEEPEN_ROUTE = { name: "consultar_crm", input: { assunto: "etapa", etapa: "aprovados", formato: "lista" }, topic: "aprofundar", speak: "fixed" };

test("1: 'onde a gente perde o cliente' é pergunta do gargalo; com o gargalo já dito = aprofundar (quem está parado)", () => {
  assert.equal(isHenryDiagnosisQuestion(COMPLAINT), true);
  assert.equal(isHenryDiagnosisQuestion("onde a gente mais perde cliente?"), true);
  assert.equal(isHenryDiagnosisQuestion("onde a gente erra?"), true);
  assert.equal(isHenryDiagnosisQuestion("quantas vendas no mês?"), false);
  assert.equal(isBareHenryComplaint(COMPLAINT), false);
  // Resposta anterior com o gargalo → aprofundar, nunca o mesmo gargalo de novo.
  assert.deepEqual(henryDeepenRequest(COMPLAINT, [user(ASK), henry(SALES)]), { route: DEEPEN_ROUTE, request: "" });
  // Sem gargalo dito antes → a pergunta do gargalo, direta (funil do mês).
  assert.equal(henryDeepenRequest(COMPLAINT, [user(ASK), henry("Foram 3 vendas no mês.")]), null);
  assert.deepEqual(henryDirectRoute(COMPLAINT, { turns: [user(ASK), henry("Foram 3 vendas no mês.")], today: TODAY }), { name: "funil_periodo", input: { periodo: "este_mes" }, topic: "diagnostico", speak: "fixed" });
  assert.match(lib, /reinterpreted \? henryDiagnosisDeepenRequest\(reinterpreted, /);
});

test("1b: 2ª reclamação depois de resposta sem conteúdo relê o pedido de diagnóstico, nunca 'você queria o quê?'", () => {
  const turns = [user(ASK), henry(SALES), user(COMPLAINT), henry(PROMISE)];
  assert.equal(isBareHenryComplaint(AGAIN), true);
  const request = henryComplaintFallbackRequest(AGAIN, turns);
  assert.equal(request, COMPLAINT);
  // O gargalo já foi dito 2 respostas atrás → aprofundar.
  assert.deepEqual(henryDiagnosisDeepenRequest(request, turns), { route: DEEPEN_ROUTE, request: "" });
  // 1ª reclamação (sem reclamação antes) continua com a pergunta curta; resposta com número continua no Treino 11.
  assert.equal(henryComplaintFallbackRequest(AGAIN, [user("quantas vendas?"), henry("Quer que eu veja o funil?")]), "");
  assert.equal(henryComplaintFallbackRequest(AGAIN, [user(COMPLAINT), henry("Foram 3 vendas no mês.")]), "");
  // Treino 10 continua: depois da pergunta genérica.
  assert.equal(henryComplaintFallbackRequest(AGAIN, [user("quero saber o que eu faço pra fechar mais"), henry("Foi mal. Você queria o quê: vendas, funil ou ranking?")]), "quero saber o que eu faço pra fechar mais");
});

test("2: resumo curto mantém o período da resposta e não começa com 'Vendas?'", () => {
  const ask = "Henry, dá pra resumir mais? Tá longo demais.";
  assert.equal(isHenryShortenRequest(ask), true);
  assert.equal(henrySpokenPeriod(SALES), "este_mes");
  assert.equal(henryShortenedReply("Vendas? Hoje tem três, e o gargalo é depois da aprovação.", SALES), "No mês tem três vendas, e o gargalo é depois da aprovação.");
  assert.equal(henryShortenedReply("Três vendas no mês; o ponto fraco é depois da aprovação.", SALES), "Três vendas no mês; o ponto fraco é depois da aprovação.");
  assert.equal(henryShortenedReply("Três vendas; o ponto fraco é a aprovação.", SALES), "No mês, três vendas; o ponto fraco é a aprovação.");
  // Período certo fica; resposta de hoje continua de hoje.
  assert.equal(henryShortenedReply("Vendas? Hoje tem três.", "Hoje foram 3 vendas."), "Hoje tem três vendas.");
  const hint = henryTurnHint({ text: ask, lastAssistant: SALES, turns: [user(ASK), henry(SALES)] });
  assert.match(hint, /MESMO período \("no mês"/);
  assert.match(hint, /nunca comece com uma pergunta/);
  assert.match(lib, /if \(!direct && lastAssistant && isHenryShortenRequest\(text\)\) replyText = henryShortenedReply\(replyText, lastAssistant[,)]/);
});

test("3: 'Pode, mas … um sertanejo mais animado' depois de 'Pense em Mim' = trocar: busca 'sertanejo animado'", () => {
  const suggestion = MORNING_SUGGESTIONS.find((item) => item.id === "musica-pense-em-mim");
  const reply = classifyMorningMusicReply("Pode, mas hoje tô na vibe de um sertanejo mais animado.");
  assert.equal(reply.kind, "genre");
  assert.equal(reply.genre.id, "sertanejo");
  assert.equal(reply.mood, "animado");
  assert.equal(reply.change, true);
  // O gênero é o da sugestão, mas o "mas" e o qualificador anulam o aceite (servidor).
  assert.equal(morningSuggestionMatchesGenre(suggestion, reply.genre), true);
  assert.match(lib, /answer === "genre" && !reply\.mood && !reply\.change && morningSuggestionMatchesGenre/);
  assert.deepEqual(morningGenreTarget(reply.genre, { style: { sertanejoMusic: "Zezé Di Camargo" }, mood: reply.mood }), { target: { query: "sertanejo animado", type: "playlist" }, choice: "genero", query: "sertanejo animado" });
  // Treino 11 mantido: aceite com o gênero da sugestão, sem "mas" nem qualificador.
  const plain = classifyMorningMusicReply("Bora, pode ser sertanejo mesmo.");
  assert.equal(plain.mood, undefined);
  assert.equal(plain.change, undefined);
  assert.equal(classifyMorningMusicReply("um rock bem animado").mood, "animado");
});

test("4: pediu outra música → confirma curto o que vai tocar antes do relatório", () => {
  const reply = classifyMorningMusicReply("Pode, mas hoje tô na vibe de um sertanejo mais animado.");
  assert.equal(morningMusicChangeLine({ genre: reply.genre, mood: reply.mood }), "Lá vai um sertanejo animado.");
  assert.equal(morningMusicChangeLine({ genre: classifyMorningMusicReply("bota uma MPB").genre }), "Lá vai uma MPB.");
  assert.equal(morningMusicChangeLine({ artist: "Henrique e Juliano" }), "Lá vai Henrique e Juliano.");
  assert.equal(morningMusicChangeLine({}), "");
  assert.match(lib, /const changeLine = !suggested && music\.ok \? morningMusicChangeLine/);
  assert.match(lib, /\[changeLine, morningMusicPrefix\(choice, music\)\]\.filter\(Boolean\)\.join\(" "\)/);
});
