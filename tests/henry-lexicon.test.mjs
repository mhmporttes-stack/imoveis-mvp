import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_JOKES,
  HENRY_LEXICON,
  JOKE_GAP,
  REPERTOIRE_MAX,
  REPERTOIRE_MIN,
  detectJokeUse,
  detectLexiconUse,
  drawHenryRepertoire,
  greetingCategory,
  henryContextFor,
  jokeAllowedNow,
  lexiconKey,
  planHenryVocabulary,
  vocabularyUsage
} from "../lib/henry-voice-lexicon.mjs";
import { appendDayTurns, dayLexiconState, recordDayLexicon } from "../lib/henry-memory-core.mjs";
import { HENRY_CHAT_SCENES, HENRY_STYLE_GUIDE, HENRY_VARIATION_HINTS, henryNeedsTools, buildHenryDynamicPrompt, buildHenryStaticPrompt, buildHenrySystemBlocks, buildReportRewritePrompt, pickDayHint, reportNumbersMatch } from "../lib/henry-voice-persona.mjs";
import { laughForSpeech, pronounceForSpeech } from "../lib/henry-voice-providers.mjs";
import { detectBargeIn } from "../lib/henry-voice-conversation.mjs";
import { isSafeToSpeak } from "../lib/alexa-v2/sanitize.mjs";
import { HENRY_WAIT_PHRASES } from "../lib/henry-voice-narration.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const ALL = Object.values(HENRY_LEXICON).flatMap((category) => category.items);
const seeded = (seed = 1) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

// --- Tamanho e categorias ---------------------------------------------------------------------------------------------
test("banco: 800+ expressões únicas, todas as categorias pedidas, cada uma com tom; 40 a 60 piadas", () => {
  assert.ok(ALL.length >= 800, `só ${ALL.length}`);
  assert.equal(new Set(ALL.map(lexiconKey)).size, ALL.length, "expressão repetida (mesmo texto normalizado)");
  for (const name of ["abertura", "conector", "comemoracao", "puxao", "incentivo", "ironia", "risada", "despedida", "saudacao_manha", "saudacao_tarde", "saudacao_noite", "regional"]) {
    assert.ok(HENRY_LEXICON[name]?.items.length >= 20, name);
    assert.ok(HENRY_LEXICON[name].tone, name);
  }
  assert.ok(HENRY_JOKES.length >= 40 && HENRY_JOKES.length <= 60, `${HENRY_JOKES.length} piadas`);
  assert.equal(new Set(HENRY_JOKES.map(lexiconKey)).size, HENRY_JOKES.length);
});

// --- Regras do humor --------------------------------------------------------------------------------------------------
const FORBIDDEN = [
  /\b(porra|caralho|merda|bosta|puta|puto|foda\w*|cacete|droga|desgra\w*|cu|bunda|pinto|safad\w*|gostos[ao]s?|tesao|pelad\w*)\b/, // palavrão / duplo sentido
  /\b(lula|bolsonaro|presidente|eleica\w*|eleitor\w*|politic\w*|partido|esquerda|direita|petista|governo|deputad\w*|senador\w*|prefeit\w*|vereador\w*)\b/, // política
  /\b(deus|jesus|cristo|igreja|santo|santa|senhora|amem|reza\w*|oraca\w*|pastor|padre|biblia|credo|abencoa\w*|milagre|ave maria|vixe|virgem|diabo|inferno|demonio)\b/, // religião
  /\b(gord\w*|feio\w*|feia\w*|pobre\w*|pobreza|burr[ao]s?|idiota\w*|otari\w*|besta|lerd[ao]s?|velh[ao]s?|careca|baixinh\w*|caloteir\w*|mao de vaca|pao duro)\b/, // zombaria de aparência/condição
  /\bk{3,}\b|\brsrs\b/ // risada que a voz lê mal
];

test("humor: nenhuma expressão ou piada com palavrão, política, religião, duplo sentido ou zombaria", () => {
  for (const text of [...ALL, ...HENRY_JOKES]) {
    const plain = lexiconKey(text);
    for (const pattern of FORBIDDEN) assert.doesNotMatch(plain, pattern, text);
    // Nunca zomba de cliente nem de alguém da equipe pelo nome do papel.
    assert.doesNotMatch(plain, /\bcliente (chato|enrolad|pao|sem noca)|\bcorretor(a)? (preguic|lerd|enrolad)/, text);
  }
});

test("banco seguro para a voz e para a trava de números: sem número, sem palavra sensível, sem 'Henry'", () => {
  for (const text of [...ALL, ...HENRY_JOKES]) {
    assert.ok(isSafeToSpeak(text), `barreira da fala: ${text}`);
    assert.doesNotMatch(text, /\d/, text);
    assert.ok(reportNumbersMatch("", text), `número por extenso: ${text}`); // relatório reescrito continuaria passando
    assert.doesNotMatch(lexiconKey(text), /\bhenry\b|\brenri\b/, text); // é a palavra de chamada
  }
  // As despedidas não contêm palavra de parada (a própria fala não interrompe o Henry).
  for (const text of HENRY_LEXICON.despedida.items) assert.equal(detectBargeIn(text, "").interrupt, false, text);
});

// Frases de espera (dono, 2026-10-23: "repete muito 'Tô passando os olhos nos números'"): mesmas travas do banco, únicas e
// sem palavra de parada (a fala dele nunca interrompe a si mesma).
test("frases de espera: seguras, sem número, sem 'Henry', sem palavra de parada, sem repetir texto; 8+ novas de números", () => {
  assert.equal(new Set(HENRY_WAIT_PHRASES.map((phrase) => lexiconKey(phrase.text))).size, HENRY_WAIT_PHRASES.length);
  for (const { text } of HENRY_WAIT_PHRASES) {
    assert.ok(isSafeToSpeak(text), `barreira da fala: ${text}`);
    assert.doesNotMatch(text, /\d/, text);
    assert.ok(reportNumbersMatch("", text), `número por extenso: ${text}`);
    assert.doesNotMatch(lexiconKey(text), /\bhenry\b|\brenri\b/, text);
    for (const pattern of FORBIDDEN) assert.doesNotMatch(lexiconKey(text), pattern, text);
    assert.equal(detectBargeIn(text, "").interrupt, false, text);
  }
  const numbers = ["w41", "w42", "w43", "w44", "w45", "w46", "w47", "w48"].map((id) => HENRY_WAIT_PHRASES.find((phrase) => phrase.id === id));
  for (const phrase of numbers) {
    assert.ok(phrase?.topics.includes("relatorio"), phrase?.id);
    assert.ok(phrase.text.split(/\s+/).length <= 8, phrase.text); // curtas
  }
});

// Situações de papo (dono, 2026-10-24, itens 1-4 de docs/scout/henry-conversa-2026-10-24.md): mesmas travas do banco.
test("papo do dia a dia: 15+ situações, falas seguras, sem número, sem 'Henry', sem palavra de parada; no guia fixo", () => {
  assert.ok(HENRY_CHAT_SCENES.length >= 15, `${HENRY_CHAT_SCENES.length}`);
  assert.equal(new Set(HENRY_CHAT_SCENES.map((scene) => scene.id)).size, HENRY_CHAT_SCENES.length);
  const replies = HENRY_CHAT_SCENES.flatMap((scene) => scene.replies);
  assert.equal(new Set(replies.map(lexiconKey)).size, replies.length);
  for (const text of replies) {
    assert.ok(isSafeToSpeak(text), `barreira da fala: ${text}`);
    assert.doesNotMatch(text, /\d/, text);
    assert.ok(reportNumbersMatch("", text), `número por extenso: ${text}`);
    assert.doesNotMatch(lexiconKey(text), /\bhenry\b|\brenri\b/, text);
    for (const pattern of FORBIDDEN) assert.doesNotMatch(lexiconKey(text), pattern, text);
    assert.equal(detectBargeIn(text, "").interrupt, false, text);
    assert.ok(text.split(/\s+/).length <= 14, `longa demais para um fôlego: ${text}`);
    assert.ok(HENRY_STYLE_GUIDE.includes(text), text);
  }
  // Frustração: calma, com conserto, sem ironia.
  const frustration = HENRY_CHAT_SCENES.find((scene) => scene.id === "frustracao");
  assert.ok(frustration.replies.some((text) => /tentar de novo/.test(text)));
  assert.match(HENRY_STYLE_GUIDE, /Se ele se irritar ou xingar[\s\S]*sem ironia[\s\S]*Foi mal, deixa eu tentar de novo/);
  assert.match(HENRY_STYLE_GUIDE, /Vez de falar\n- Uma pergunta por vez/);
  assert.match(HENRY_STYLE_GUIDE, /sem perguntar de novo/);
  assert.match(HENRY_STYLE_GUIDE, /"então", "aliás", "falando nisso"/);
  assert.match(HENRY_STYLE_GUIDE, /fôlego/);
  assert.match(HENRY_STYLE_GUIDE, /Dado longo .* vai para a tela/);
});

test("papo do dia a dia: sem ferramentas; frustração e pedido continuam com ferramentas", () => {
  for (const text of ["Henry, tá aí?", "tá me ouvindo?", "que horas são?", "que dia é hoje?", "tô cansado hoje", "tô meio estressado", "que dia puxado", "você tá cansado?", "você é humano?", "você é um robô?", "quem te criou?", "quantos anos você tem?", "bom trabalho", "desculpa", "vou almoçar", "você dorme?", "você é meu amigo?"]) {
    assert.equal(henryNeedsTools(text), false, text);
  }
  for (const text of ["você é burro", "errou de novo", "que horas é a reunião do Gabriel?", "tô cansado, me fala os leads de hoje", "quem atendeu a Ana?"]) {
    assert.equal(henryNeedsTools(text), true, text);
  }
});

// --- Contexto e sorteio -----------------------------------------------------------------------------------------------
test("contexto: sério > relatório > comemoração > conversa > pergunta", () => {
  assert.equal(henryContextFor({ question: "perdi aquele cliente da Vila Barros" }), "serio");
  assert.equal(henryContextFor({ question: "o cliente reclamou do atendimento" }), "serio");
  assert.equal(henryContextFor({ mode: "report", question: "bom dia" }), "relatorio");
  assert.equal(henryContextFor({ question: "a Carol vendeu hoje?" }), "comemoracao");
  assert.equal(henryContextFor({ question: "me conta uma piada" }), "conversa");
  assert.equal(henryContextFor({ question: "quantos leads entraram hoje?" }), "pergunta");
  assert.equal(greetingCategory(8), "saudacao_manha");
  assert.equal(greetingCategory(14), "saudacao_tarde");
  assert.equal(greetingCategory(21), "saudacao_noite");
});

test("sorteio: 20 a 30 itens do contexto; assunto sério sem piada, ironia nem risada", () => {
  for (const context of ["relatorio", "pergunta", "comemoracao", "conversa", "serio"]) {
    for (let seed = 1; seed < 30; seed += 1) {
      const { items, joke } = drawHenryRepertoire({ context, jokeAllowed: true, random: seeded(seed), hour: 9 });
      assert.ok(items.length >= REPERTOIRE_MIN && items.length <= REPERTOIRE_MAX, `${context}: ${items.length}`);
      assert.equal(new Set(items.map((item) => item.text)).size, items.length);
      if (context === "serio") {
        assert.equal(joke, "");
        assert.ok(items.every((item) => HENRY_LEXICON[item.category].serious), JSON.stringify(items));
      }
      if (context === "relatorio") assert.ok(items.some((item) => item.category === "saudacao_manha"));
    }
  }
});

test("mesma pergunta duas vezes no dia: o 2º sorteio não repete nada do 1º (memória do dia)", () => {
  const today = "2026-10-22";
  let stored = null;
  const question = "quantos leads entraram hoje?";
  const random = seeded(7);
  const first = planHenryVocabulary({ question, state: dayLexiconState(stored, today), random });
  // Simula a resposta usando TODO o repertório e a piada; a memória marca tudo como usado.
  const reply1 = [...first.repertoire.items.map((item) => item.text), first.repertoire.joke].join(" ");
  stored = appendDayTurns(stored, today, [{ role: "user", text: question }, { role: "assistant", text: reply1 }]);
  stored = recordDayLexicon(stored, today, { ...vocabularyUsage(reply1, first), hint: pickDayHint([]) });
  const state = dayLexiconState(stored, today);
  for (const item of first.repertoire.items) assert.ok(state.used.includes(lexiconKey(item.text)), item.text);
  const second = planHenryVocabulary({ question, state, random });
  const firstKeys = new Set(first.repertoire.items.map((item) => lexiconKey(item.text)));
  const overlap = second.repertoire.items.filter((item) => firstKeys.has(lexiconKey(item.text)));
  assert.deepEqual(overlap, []);
  assert.notEqual(second.repertoire.joke, first.repertoire.joke);
  // Expressões usadas vão ao prompt como proibidas.
  assert.ok(second.usedExpressions.length > 0);
  assert.match(buildHenryDynamicPrompt({ usedExpressions: second.usedExpressions, repertoire: second.promptText }), /JÁ usou hoje \(proibidas/);
  // Virada do dia: tudo liberado de novo.
  assert.deepEqual(dayLexiconState(stored, "2026-10-23").used, []);
});

test("estrutura do dia: nunca repete uma dica já usada hoje", () => {
  const used = [];
  for (let index = 0; index < HENRY_VARIATION_HINTS.length; index += 1) {
    const hint = pickDayHint(used, seeded(index + 3));
    assert.ok(!used.includes(hint), hint);
    used.push(hint);
  }
  assert.ok(HENRY_VARIATION_HINTS.length >= 30);
});

// --- Piadas: 1 vez por dia e no máximo 1 a cada 3–4 respostas ---------------------------------------------------------
test("piada: no máximo 1 a cada 3–4 respostas e cada piada no máximo 1 vez por dia", () => {
  const today = "2026-10-22";
  let stored = null;
  const told = [];
  const jokeReplies = [];
  const random = seeded(11);
  for (let reply = 1; reply <= 60; reply += 1) {
    const state = dayLexiconState(stored, today);
    const plan = planHenryVocabulary({ question: "me conta uma piada", state, random });
    const text = plan.repertoire.joke || "Sem piada agora.";
    if (plan.repertoire.joke) {
      assert.ok(!told.includes(plan.repertoire.joke), `piada repetida: ${plan.repertoire.joke}`);
      told.push(plan.repertoire.joke);
      jokeReplies.push(reply);
    }
    stored = recordDayLexicon(stored, today, vocabularyUsage(text, plan));
  }
  for (let index = 1; index < jokeReplies.length; index += 1) assert.ok(jokeReplies[index] - jokeReplies[index - 1] >= JOKE_GAP, jokeReplies.join(","));
  assert.ok(jokeReplies.length >= 10, `poucas piadas: ${jokeReplies.length}`);
  assert.equal(jokeAllowedNow({ replies: 0, lastJokeReply: null }), true);
  assert.equal(jokeAllowedNow({ replies: 1, lastJokeReply: 1 }), false);
  assert.equal(jokeAllowedNow({ replies: 4, lastJokeReply: 1 }), true);
});

test("detecção: expressões do banco e piada adaptada viram 'usadas hoje'", () => {
  const used = detectLexiconUse("Opa! Entraram 12 leads hoje, ô loco, tá rendendo.");
  assert.ok(used.includes("opa"));
  assert.ok(used.includes("o loco"));
  assert.ok(used.includes("ta rendendo"));
  assert.equal(detectJokeUse("Haha, lá vai: a Caixa não demora, só gosta de criar um suspense.", "A Caixa não demora, ela só gosta de criar suspense."), true);
  assert.equal(detectJokeUse("Entraram 12 leads.", "A Caixa não demora, ela só gosta de criar suspense."), false);
});

// --- Prompt: travas mantidas + guia em cache --------------------------------------------------------------------------
test("prompt: guia de estilo longo no bloco com cache_control, travas mantidas, repertório na parte variável", () => {
  const fixed = buildHenryStaticPrompt();
  assert.ok(fixed.includes(HENRY_STYLE_GUIDE));
  assert.ok(HENRY_STYLE_GUIDE.length > 3000);
  assert.match(fixed, /Responda SÓ o que foi perguntado, em 1 frase/);
  assert.match(fixed, /No CRM você só CONSULTA/);
  assert.match(fixed, /Nunca fale CPF, renda, salário, FGTS, telefone, e-mail/);
  assert.match(fixed, /Todo número ou nome do CRM vem SEMPRE de uma ferramenta/);
  assert.match(fixed, /Assunto sério .*zero piada/);
  assert.match(fixed, /Nada de política, religião, palavrão ou duplo sentido/);
  const blocks = buildHenrySystemBlocks("dinâmico");
  assert.deepEqual(blocks[0].cache_control, { type: "ephemeral" });
  assert.equal(blocks[0].text, fixed);
  assert.equal(blocks[1].cache_control, undefined); // o repertório muda a cada pedido: fora do cache
  const plan = planHenryVocabulary({ question: "quantos leads hoje?", state: {}, random: seeded(3) });
  assert.match(plan.promptText, /Repertório desta resposta/);
  const serious = planHenryVocabulary({ question: "perdi um cliente", state: {}, random: seeded(3) });
  assert.match(serious.promptText, /sem piada, sem ironia e sem risada/);
  assert.match(buildReportRewritePrompt({ repertoire: plan.promptText, usedExpressions: ["opa"] }), /Repertório desta resposta[\s\S]*|"opa"/);
  // Servidor: plano por resposta, resposta segue pela barreira e o uso vai para a memória do dia.
  assert.match(lib, /const plan = planVocabulary\("question", text, lexicon\)/);
  assert.match(lib, /repertoire: plan\.promptText, usedExpressions: plan\.usedExpressions/);
  assert.match(lib, /recordDayLexicon\(next, today, \{ \.\.\.vocabularyUsage\(reply, plan\), hint: plan\.hint \}\)/);
  assert.match(lib, /const reply = safeHenryReply\(stripUrls\(replyText\) \|\| fallback[,)]/); // screenFallback (dono, 2026-10-23) não troca a barreira
});

// --- Risada na voz ---------------------------------------------------------------------------------------------------
test("risada na voz: 'haha' vira 'rárá' (R inicial do português soa como risada); a tela continua 'haha'", () => {
  assert.equal(laughForSpeech("Haha, essa foi boa."), "rárá, essa foi boa.");
  assert.equal(laughForSpeech("Hahaha! Boa."), "rarará! Boa.");
  assert.equal(laughForSpeech("kkkk e rsrs"), "rarará e rarará");
  assert.equal(laughForSpeech("Hahahahaha"), "rarará");
  assert.equal(laughForSpeech("Haja paciência, Hamburgo"), "Haja paciência, Hamburgo");
  assert.equal(pronounceForSpeech("Haha, Henry!"), "rárá, Rênri!");
});
