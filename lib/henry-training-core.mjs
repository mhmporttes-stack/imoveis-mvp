// Modo treino do Henry (pedido do dono, 2026-10-24: "Montar um agente ou algo que fique conversando com Henry para treinar
// as respostas (use a voz gratuita para não gastar a ElevenLabs). A ideia é ver repetições, falas erradas, melhorar e
// deixar mais fluido." — docs/BUSINESS_RULES.md HENRY-1 "Modo treino", PENDENTE DE VALIDAÇÃO). Núcleo PURO (sem rede):
//   - HENRY_TRAINING_SCENARIOS: o roteiro de conversas (cumprimentos, papo, CRM, música, ambíguos, frustração,
//     interrupções, dia inteiro). Cada passo é uma fala fixa (`say`), uma fala a variar pelo "dono simulado" (`vary`) ou
//     uma continuação que o dono simulado escreve olhando a última resposta do Henry (`reply`); sem o dono simulado,
//     vale o texto-base (`say`) — a rodada roda igual, só sem variação.
//   - estimateHenryTrainingCostUsd: custo estimado ANTES de rodar (mostrado na tela).
//   - analyzeHenryTraining: o relatório da rodada (repetições, fala longa para voz, fala barrada, "não tenho acesso",
//     espera em cumprimento puro, tom errado). As regras de barreira são as MESMAS do Henry (safeHenryReply/isSafeToSpeak,
//     isHenryGreeting, openingsFrom/closingsFrom, HENRY_WAIT_PHRASES) — nada de critério paralelo.
// As respostas do Henry saem do MESMO cérebro (answerHenry em lib/henry-voice.js), com memória do dia isolada da rodada.

import { HENRY_FALLBACK_REPLY, HENRY_PRICE_INPUT_PER_MTOK, HENRY_PRICE_OUTPUT_PER_MTOK, HENRY_SCREEN_REPLY, normalizeSpeechText } from "./henry-voice-core.mjs";
import { isSafeToSpeak } from "./alexa-v2/sanitize.mjs";
import { closingsFrom, isHenryGreeting, openingsFrom } from "./henry-voice-persona.mjs";
import { HENRY_WAIT_PHRASES } from "./henry-voice-narration.mjs";
import { groupSimilar } from "./henry-repetition-core.mjs";

export const HENRY_TRAINING_FEATURE = "henry_training"; // origem em ai_usage_log ("Gastos de IA")
export const HENRY_TRAINING_MAX_EXCHANGES = 40; // teto de trocas por rodada (dono simulado + Henry)
export const HENRY_TRAINING_LINE_MAX = 200; // fala do dono simulado
export const HENRY_TRAINING_VOICE_MAX_CHARS = 300; // acima disso a resposta cansa na voz (pergunta comum)
export const HENRY_TRAINING_VOICE_MAX_SENTENCES = 3;
export const HENRY_TRAINING_REPORT_MAX_CHARS = 700; // relatório do dia (bom dia): 3 a 5 frases
export const HENRY_TRAINING_REPORT_MAX_SENTENCES = 5;

const step = (say, extra = {}) => Object.freeze({ say, ...extra });

// Roteiro. `vary` = o dono simulado reescreve `say` com outras palavras (mesma intenção); `reply` = intenção da
// continuação depois da resposta do Henry (o `say` é a reserva sem o dono simulado). mode "report" = "bom dia, Henry".
export const HENRY_TRAINING_SCENARIOS = Object.freeze([
  Object.freeze({
    id: "cumprimentos",
    label: "Cumprimentos e cortesia",
    steps: [
      step("Boa tarde, Henry", { vary: true }),
      step("Tudo bem com você?", { vary: true }),
      step("Valeu, Henry", { vary: true }),
      step("Boa noite", { vary: true }),
      step("Tchau, até amanhã", { vary: true })
    ]
  }),
  Object.freeze({
    id: "papo",
    label: "Papo casual",
    steps: [
      step("E aí, como foi teu dia?", { vary: true }),
      step("Me conta uma piada", { vary: true }),
      step("Haha, boa", { reply: "reage à piada de forma curta e natural" }),
      step("Tô cansado hoje", { vary: true }),
      step("Obrigado pela força", { reply: "agradece de forma curta" })
    ]
  }),
  Object.freeze({
    id: "crm",
    label: "Perguntas do CRM",
    steps: [
      step("Quantos clientes novos entraram hoje?", { vary: true }),
      step("E como está o ranking da semana?", { vary: true }),
      step("Quem está parado há mais tempo?", { vary: true }),
      step("Tem conversa esperando resposta no WhatsApp?", { vary: true }),
      step("E a Meta Diária da equipe?", { vary: true })
    ]
  }),
  Object.freeze({
    id: "musica",
    label: "Música",
    steps: [
      step("Toca um rock aí", { vary: true }),
      step("Abaixa um pouco o volume", { vary: true }),
      step("Passa pra Alexa", { vary: true }),
      step("Toca alguma coisa mais calma e depois me fala quantos clientes novos entraram", { vary: true }),
      step("Valeu", { reply: "agradece curto" })
    ]
  }),
  Object.freeze({
    id: "ambiguos",
    label: "Pedidos ambíguos",
    steps: [
      step("E aquele cliente?", { vary: true }),
      step("O da semana passada", { reply: "responde vago à pergunta dele, sem dar nome" }),
      step("Me mostra aquilo", { vary: true }),
      step("Como estão as coisas?", { vary: true }),
      step("E ela?", { vary: true })
    ]
  }),
  Object.freeze({
    id: "frustracao",
    label: "Frustração",
    steps: [
      step("Quantas vendas a gente fez esse mês?", { vary: true }),
      step("Não foi isso que eu perguntei", { reply: "reclama que a resposta não era o que pediu, irritado mas educado" }),
      step("Você tá repetindo a mesma coisa", { vary: true }),
      step("Fala mais curto, por favor", { vary: true }),
      step("Agora sim", { reply: "aprova curto se a resposta melhorou; senão reclama de novo, curto" })
    ]
  }),
  Object.freeze({
    id: "interrupcoes",
    label: "Interrupções e troca de assunto",
    steps: [
      step("Me fala do funil do mês", { vary: true }),
      step("Não, espera, me fala do ranking primeiro", { vary: true }),
      step("Esquece, abre a tela de clientes", { vary: true }),
      step("Sim, pode abrir", { reply: "aceita curto o que ele ofereceu; se ele não ofereceu nada, muda de assunto para o WhatsApp" }),
      step("Volta pro funil agora", { vary: true })
    ]
  }),
  Object.freeze({
    id: "dia",
    label: "Dia inteiro (manhã à noite)",
    steps: [
      step("Bom dia, Henry", { mode: "report" }),
      step("Pode", { reply: "responde à pergunta do bom dia (música ou aniversário) de forma curta" }),
      step("Quantos atendimentos a equipe fez até agora?", { vary: true }),
      step("Boa tarde, Henry", { vary: true }),
      step("Boa noite, fechando por hoje", { vary: true })
    ]
  })
]);

export function henryTrainingScenario(id) {
  return HENRY_TRAINING_SCENARIOS.find((scenario) => scenario.id === id) || null;
}

export function henryTrainingTotalSteps(ids = HENRY_TRAINING_SCENARIOS.map((scenario) => scenario.id)) {
  return ids.reduce((total, id) => total + (henryTrainingScenario(id)?.steps.length || 0), 0);
}

// Cabe mais um cenário na rodada sem passar do teto?
export function henryTrainingFits(usedExchanges, scenarioId) {
  const scenario = henryTrainingScenario(scenarioId);
  if (!scenario) return false;
  return (Number(usedExchanges) || 0) + scenario.steps.length <= HENRY_TRAINING_MAX_EXCHANGES;
}

// --- Custo estimado (antes de rodar) ------------------------------------------------------------------------------------
// Por troca, com folga: Henry ~1,6 rodada (ferramentas) × (parte fixa ~6 mil tokens lida do cache a 10% + ~2,5 mil sem
// cache) + ~150 de saída por rodada; dono simulado ~700 de entrada e ~40 de saída. Primeira chamada grava o cache (×1,25).
export const HENRY_TRAINING_TOKENS = Object.freeze({ cachedPrompt: 6000, uncachedPrompt: 2500, rounds: 1.6, replyOut: 150, ownerIn: 700, ownerOut: 40 });
export function estimateHenryTrainingCostUsd(exchanges, { simulateOwner = true } = {}) {
  const count = Math.max(0, Math.min(HENRY_TRAINING_MAX_EXCHANGES, Number(exchanges) || 0));
  if (!count) return 0;
  const t = HENRY_TRAINING_TOKENS;
  const perRoundIn = t.cachedPrompt * 0.1 + t.uncachedPrompt;
  const henryIn = count * t.rounds * perRoundIn + t.cachedPrompt * 1.25;
  const henryOut = count * t.rounds * t.replyOut;
  const ownerIn = simulateOwner ? count * t.ownerIn : 0;
  const ownerOut = simulateOwner ? count * t.ownerOut : 0;
  return ((henryIn + ownerIn) / 1e6) * HENRY_PRICE_INPUT_PER_MTOK + ((henryOut + ownerOut) / 1e6) * HENRY_PRICE_OUTPUT_PER_MTOK;
}

// --- Dono simulado ------------------------------------------------------------------------------------------------------
// Prompt do modelo barato que faz o papel do Matheus. Não é o prompt do Henry (esse continua só em henry-voice-persona.mjs).
export function buildTrainingOwnerPrompt({ scenarioLabel = "", step: current = {}, lastReply = "" } = {}) {
  const system = [
    "Você faz o papel do Matheus, corretor de imóveis dono de uma imobiliária em Marília (SP), falando por VOZ com o assistente dele, o Henry.",
    "Escreva SÓ a próxima fala do Matheus, como sairia transcrita do microfone: português do Brasil coloquial, curta (2 a 15 palavras), sem aspas, sem emoji, sem explicação.",
    "Nunca invente telefone, CPF, e-mail ou valor em dinheiro. Pode citar primeiro nome genérico de corretor ou cliente só se a intenção pedir.",
    "Não chame o assistente de outro nome. Não responda pelo Henry."
  ].join(" ");
  const parts = [`Cena do treino: ${scenarioLabel || "conversa"}.`];
  if (current.reply) {
    parts.push(`Última fala do Henry: "${String(lastReply || "").slice(0, 400)}".`);
    parts.push(`Intenção da sua próxima fala: ${current.reply}. Exemplo do jeito: "${current.say}".`);
  } else {
    parts.push(`Diga isto com OUTRAS palavras, mesma intenção, natural como na vida real: "${current.say}".`);
  }
  return { system, user: parts.join("\n") };
}

// Limpa a fala do dono simulado: uma linha, sem aspas, ≤ HENRY_TRAINING_LINE_MAX. Vazia/estranha → o texto-base.
export function cleanTrainingOwnerLine(text, fallback = "") {
  const line = String(text || "")
    .split(/\n+/)
    .map((part) => part.trim())
    .find(Boolean) || "";
  const clean = line.replace(/^(matheus|dono|eu)\s*:\s*/i, "").replace(/^["'“”]+|["'“”]+$/g, "").replace(/\s+/g, " ").trim().slice(0, HENRY_TRAINING_LINE_MAX);
  return clean.length >= 2 ? clean : String(fallback || "").trim();
}

// --- Memória isolada da rodada (sandbox) --------------------------------------------------------------------------------
// O que pode voltar do navegador entre um cenário e outro: só as chaves de memória do Henry, cada uma objeto JSON pequeno.
export const HENRY_TRAINING_SANDBOX_KEYS = Object.freeze(["henry_day_memory", "henry_notes", "henry_morning_music", "henry_voice_compliments"]);
export const HENRY_TRAINING_SANDBOX_MAX_CHARS = 60000;
export function parseTrainingSandbox(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const key of HENRY_TRAINING_SANDBOX_KEYS) {
    const value = raw[key];
    if (value && typeof value === "object" && !Array.isArray(value)) out[key] = value;
  }
  try {
    if (JSON.stringify(out).length > HENRY_TRAINING_SANDBOX_MAX_CHARS) return {};
  } catch {
    return {};
  }
  return out;
}

// --- Relatório da rodada ------------------------------------------------------------------------------------------------
const sentencesOf = (text) => String(text || "").split(/(?<=[.!?…])\s+/).map((part) => part.trim()).filter(Boolean);
const wordsOf = (text) => normalizeSpeechText(text).split(" ").filter(Boolean);
const NO_ACCESS = /\b(nao tenho acesso|nao consigo acessar|sem acesso a|nao tenho como (ver|acessar|saber)|nao consigo ver (isso|esse|essa|os|as))\b/;
const WAIT_TALK = /\b(vou (verificar|analisar|conferir|checar|olhar|puxar)|deixa eu (ver|conferir|olhar|checar|puxar)|so um (instante|minutinho|segundo)|(to|estou) (analisando|verificando|conferindo|puxando))\b/;
const WAIT_TEXTS = new Set(HENRY_WAIT_PHRASES.map((phrase) => normalizeSpeechText(phrase.text)));
const TONE_RULES = Object.freeze([
  { id: "markdown", label: "formatação de texto (markdown/lista) numa fala", test: (raw) => /[*#`_]{1,}|^\s*[-•]\s|\n\s*\d+[.)]\s/m.test(raw) },
  { id: "emoji", label: "emoji numa fala", test: (raw) => /\p{Extended_Pictographic}/u.test(raw) },
  { id: "risada", label: "risada que a voz lê mal (kkk/rsrs)", test: (_raw, plain) => /\bk{3,}\b|\brsrs\b/.test(plain) },
  { id: "robo", label: "fala de robô (\"como assistente/IA\")", test: (_raw, plain) => /\bcomo (uma |um )?(ia|inteligencia artificial|assistente virtual|modelo de linguagem)\b/.test(plain) },
  { id: "desculpa", label: "pedido de desculpas em excesso", test: (_raw, plain) => (plain.match(/\b(desculp\w*|perdao)\b/g) || []).length >= 2 }
]);

function ngramsOf(text, size) {
  const words = wordsOf(text);
  const grams = new Set();
  for (let index = 0; index + size <= words.length; index += 1) grams.add(words.slice(index, index + size).join(" "));
  return grams;
}

// Repetição por SEMELHANÇA (dono, 2026-10-25: "muda uma palavra e fala a mesma frase"): a mesma medida do Henry ao vivo
// (groupSimilar, lib/henry-repetition-core.mjs) — "Ok, vou olhar" e "Beleza, vou olhar" contam como a mesma abertura.
function countRepeats(items) {
  return groupSimilar(items.filter((item) => normalizeSpeechText(item)))
    .filter((entry) => entry.count >= 2)
    .map(({ text, count }) => ({ text, count }))
    .sort((a, b) => b.count - a.count);
}

// exchanges = [{ owner, reply, mode?, scenarioId?, error? }] na ordem da rodada (a rodada é "um dia").
// Devolve { exchanges, issues: [{ kind, label, index?, text? }], repeats: { replies, openings, closings, ngrams }, totals }.
export function analyzeHenryTraining(exchanges = [], { ngramSize = 4, ngramMin = 3 } = {}) {
  const list = (Array.isArray(exchanges) ? exchanges : []).filter((item) => item && typeof item === "object");
  const issues = [];
  const push = (kind, label, index, text = "") => issues.push({ kind, label, index, ...(text ? { text } : {}) });
  list.forEach((item, index) => {
    const reply = String(item.reply || "");
    const plain = normalizeSpeechText(reply);
    if (item.error) {
      push("erro", "a pergunta falhou (erro do servidor)", index, String(item.error).slice(0, 120));
      return;
    }
    if (!reply.trim()) {
      push("vazia", "resposta vazia", index);
      return;
    }
    if (reply === HENRY_FALLBACK_REPLY || !isSafeToSpeak(reply)) push("barrada", "fala barrada pela barreira da voz (número/palavra sensível)", index);
    else if (reply === HENRY_SCREEN_REPLY) push("so_tela", "resposta barrada na voz; só os detalhes na tela", index);
    if (/^nao consegui responder agora/.test(plain)) push("sem_resposta", "o Henry não conseguiu responder", index);
    if (NO_ACCESS.test(plain)) push("sem_acesso", "disse que não tem acesso (regra: lê todo o CRM)", index, reply);
    const report = item.mode === "report";
    const maxChars = report ? HENRY_TRAINING_REPORT_MAX_CHARS : HENRY_TRAINING_VOICE_MAX_CHARS;
    const maxSentences = report ? HENRY_TRAINING_REPORT_MAX_SENTENCES : HENRY_TRAINING_VOICE_MAX_SENTENCES;
    const sentences = sentencesOf(reply).length;
    if (reply.length > maxChars || sentences > maxSentences) push("longa", `longa demais para voz (${reply.length} caracteres, ${sentences} frases)`, index);
    if (isHenryGreeting(item.owner)) {
      if (WAIT_TEXTS.has(plain) || WAIT_TALK.test(plain)) push("espera_cumprimento", "cumprimento puro virou \"vou verificar\"", index, reply);
      if (/\d/.test(reply)) push("numero_cumprimento", "cumprimento puro respondido com números do CRM", index, reply);
    }
    for (const rule of TONE_RULES) if (rule.test(reply, plain)) push(`tom_${rule.id}`, rule.label, index);
  });

  const replies = list.map((item) => String(item.reply || "")).filter((reply) => reply && reply !== HENRY_FALLBACK_REPLY);
  const turns = replies.map((text) => ({ role: "assistant", text }));
  const repeatedReplies = countRepeats(replies);
  const repeatedOpenings = countRepeats(openingsFrom(turns, Infinity));
  const repeatedClosings = countRepeats(closingsFrom(turns, Infinity));
  const gramCounts = new Map();
  for (const reply of replies) for (const gram of ngramsOf(reply, ngramSize)) gramCounts.set(gram, (gramCounts.get(gram) || 0) + 1);
  const repeatedNgrams = [...gramCounts.entries()].filter(([, count]) => count >= ngramMin).map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count).slice(0, 15);
  for (const entry of repeatedReplies) push("repeticao_resposta", `mesma resposta ${entry.count}x no dia`, undefined, entry.text);
  for (const entry of repeatedOpenings) push("repeticao_abertura", `mesma abertura ${entry.count}x no dia`, undefined, entry.text);
  for (const entry of repeatedClosings) push("repeticao_fechamento", `mesmo fechamento ${entry.count}x no dia`, undefined, entry.text);
  for (const entry of repeatedNgrams) push("repeticao_trecho", `mesmo trecho em ${entry.count} respostas`, undefined, entry.text);

  const lengths = replies.map((reply) => reply.length);
  return {
    issues,
    repeats: { replies: repeatedReplies, openings: repeatedOpenings, closings: repeatedClosings, ngrams: repeatedNgrams },
    totals: {
      exchanges: list.length,
      issues: issues.length,
      averageChars: lengths.length ? Math.round(lengths.reduce((sum, value) => sum + value, 0) / lengths.length) : 0,
      longest: lengths.length ? Math.max(...lengths) : 0
    }
  };
}
