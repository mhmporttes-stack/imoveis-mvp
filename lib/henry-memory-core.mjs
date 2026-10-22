// Memória do Henry (núcleo PURO, testável). Duas memórias, separadas:
//   1) MEMÓRIA DO DIA [REGRA OFICIAL — dono, 2026-10-22: "Eu gostaria de deixar a memória dele no dia. Não toda vez que eu
//      entrar no chat zerar a memória."]: as trocas (só o TEXTO da pergunta e da resposta; nunca áudio nem imagem) do dia
//      de São Paulo ficam em crm_settings henry_day_memory = { date, turns }, no máximo 40 trocas e 200 caracteres por
//      texto (as mais antigas saem). Zera na virada do dia (a data é conferida a cada leitura). "Henry, esquece a conversa
//      de hoje" apaga. Texto sensível (CPF, telefone, e-mail, valores, renda...) é trocado antes de gravar.
//   2) LEMBRETES ("Henry, lembre que …"): texto curto do dono em crm_settings henry_notes (até 30), de longo prazo;
//      "esqueça …" apaga. É a única escrita do Henry e é sobre ele mesmo, nunca sobre o CRM.
import { isSafeToSpeak } from "./alexa-v2/sanitize.mjs";
import { normalizeSpeechText } from "./henry-voice-core.mjs";

export const HENRY_DAY_MEMORY_SETTING_ID = "henry_day_memory";
export const HENRY_NOTES_SETTING_ID = "henry_notes";
export const DAY_MEMORY_MAX_EXCHANGES = 40;
export const DAY_MEMORY_TEXT_MAX = 200;
export const DAY_MEMORY_MODEL_EXCHANGES = 8;
export const NOTES_MAX = 30;
export const NOTE_TEXT_MAX = 160;
export const SENSITIVE_PLACEHOLDER = "[trecho com dado sensível omitido]";

// Texto que vai para a memória: uma linha, cortado em 200 caracteres; com dado sensível vira o aviso (nunca grava CPF,
// telefone, e-mail, valores em reais, renda ou financiamento).
export function memoryText(text, max = DAY_MEMORY_TEXT_MAX) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  if (!isSafeToSpeak(value)) return SENSITIVE_PLACEHOLDER;
  return value.length > max ? `${value.slice(0, max - 1).trim()}…` : value;
}

// Registro salvo → trocas de HOJE (outro dia ou formato estranho = vazio).
export function dayTurns(stored, today) {
  if (!stored || stored.date !== today || !Array.isArray(stored.turns)) return [];
  return stored.turns
    .filter((turn) => turn && (turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string" && turn.text)
    .map((turn) => ({ role: turn.role, text: memoryText(turn.text) }));
}

// Acrescenta trocas ao dia (virada do dia começa do zero); guarda as últimas 40 trocas (80 falas).
export function appendDayTurns(stored, today, turns = [], { maxExchanges = DAY_MEMORY_MAX_EXCHANGES } = {}) {
  const current = dayTurns(stored, today);
  const added = turns
    .filter((turn) => turn && (turn.role === "user" || turn.role === "assistant"))
    .map((turn) => ({ role: turn.role, text: memoryText(turn.text) }))
    .filter((turn) => turn.text);
  const lexicon = stored?.date === today && stored?.lexicon ? { lexicon: dayLexiconState(stored, today) } : {};
  return { date: today, turns: [...current, ...added].slice(-maxExchanges * 2), ...lexicon };
}

// --- Vocabulário usado hoje (dono, 2026-10-22: "para não repetir [...] o mesmo jeito de falar, mesmo que eu faça a mesma
// pergunta, pelo menos no mesmo dia") --------------------------------------------------------------------------------------
// Em henry_day_memory.lexicon, só chaves curtas normalizadas (nunca a fala): expressões do banco já usadas hoje (used),
// piadas usadas hoje (jokes), estruturas/dicas de variação usadas hoje (hints), quantas respostas o Henry deu hoje
// (replies) e em qual resposta saiu a última piada (lastJokeReply). Zera na virada do dia, junto com a memória.
export const LEXICON_USED_MAX = 600;
export const LEXICON_HINTS_MAX = 60;
const keyList = (list, max) => (Array.isArray(list) ? list : []).filter((item) => typeof item === "string" && item && item.length <= 200).slice(-max);

export function dayLexiconState(stored, today) {
  const value = stored?.date === today && stored?.lexicon && typeof stored.lexicon === "object" ? stored.lexicon : {};
  const replies = Math.max(0, Math.floor(Number(value.replies) || 0));
  const last = Number.isInteger(value.lastJokeReply) && value.lastJokeReply >= 0 && value.lastJokeReply <= replies ? value.lastJokeReply : null;
  return { used: keyList(value.used, LEXICON_USED_MAX), jokes: keyList(value.jokes, LEXICON_USED_MAX), hints: keyList(value.hints, LEXICON_HINTS_MAX), replies, lastJokeReply: last };
}

// Depois de UMA resposta: soma as expressões detectadas, a piada (se saiu) e a dica usada. Devolve o registro inteiro.
export function recordDayLexicon(stored, today, { used = [], joke = "", hint = "" } = {}) {
  const base = stored?.date === today ? stored : { date: today, turns: [] };
  const state = dayLexiconState(base, today);
  const replies = state.replies + 1;
  const merge = (list, extra, max) => [...list.filter((item) => !extra.includes(item)), ...extra].slice(-max);
  const lexicon = {
    used: merge(state.used, keyList(used, LEXICON_USED_MAX), LEXICON_USED_MAX),
    jokes: joke ? merge(state.jokes, [joke], LEXICON_USED_MAX) : state.jokes,
    hints: hint ? merge(state.hints, [hint], LEXICON_HINTS_MAX) : state.hints,
    replies,
    lastJokeReply: joke ? replies : state.lastJokeReply
  };
  return { date: today, turns: dayTurns(base, today), lexicon };
}

// O que vai ao modelo: as últimas ~8 trocas e um resumo curto das perguntas anteriores do dia.
export function modelHistoryFromDay(turns = [], exchanges = DAY_MEMORY_MODEL_EXCHANGES) {
  const recent = turns.slice(-exchanges * 2);
  while (recent.length && recent[0].role !== "user") recent.shift();
  const older = turns.slice(0, Math.max(0, turns.length - exchanges * 2)).filter((turn) => turn.role === "user" && turn.text !== SENSITIVE_PLACEHOLDER);
  const summary = older.length
    ? `vocês já falaram de ${older.slice(-10).map((turn) => `"${turn.text.slice(0, 60)}"`).join(", ")}.`
    : "";
  return { history: recent.map((turn) => ({ role: turn.role, text: turn.text })), summary };
}

// --- Comandos de memória (decididos no servidor, sem o modelo) -----------------------------------------------------------
const FORGET_TODAY = /\b(esquec\w*|apag\w*|limp\w*|zer\w*)\b.*\b(conversa|papo|memoria|historico)\b.*\b(hoje|do dia)\b|\b(esquec\w*|apag\w*)\b\s+(tudo\s+)?(o que|que)\s+(a gente|nos)\s+(conversou|falou)\s+hoje\b/;

// "Henry, lembre que a reunião com a Caixa é sexta" → { kind: "remember", note }; "esquece o lembrete da Caixa" /
// "esqueça que …" → { kind: "forget", term }; "esquece a conversa de hoje" → { kind: "forget_today" }; outro → null.
export function parseMemoryCommand(text) {
  const raw = String(text || "").trim();
  const plain = normalizeSpeechText(raw);
  if (!plain) return null;
  if (FORGET_TODAY.test(plain)) return { kind: "forget_today" };
  const remember = /^(?:por favor\s+)?(?:lembr[ae]|anot[ae]|guard[ae]|grav[ae])(?:-se)?\s+(?:que|de que|isso:?)\s+(.+)$/i.exec(raw.replace(/^henry[,\s]+/i, "").trim());
  if (remember) {
    const note = remember[1].replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
    return note ? { kind: "remember", note } : null;
  }
  const forget = /^(?:por favor\s+)?(?:esquec[ae]|apag[ae]|tir[ae])\s+(?:o lembrete\s+(?:d[aoe]s?\s+|sobre\s+|que\s+)?|que\s+|sobre\s+|d[aoe]s?\s+)(.+)$/i.exec(raw.replace(/^henry[,\s]+/i, "").trim());
  if (forget) {
    const term = forget[1].replace(/[.!?]+$/, "").trim();
    return term ? { kind: "forget", term } : null;
  }
  return null;
}

export function notesFrom(stored) {
  return (Array.isArray(stored?.items) ? stored.items : []).filter((item) => item && typeof item.text === "string" && item.text).slice(-NOTES_MAX);
}

// Lembrete novo: curto, sem dado sensível (recusado, não guardado), sem duplicar; guarda os 30 mais recentes.
export function addNote(stored, text, now = new Date().toISOString()) {
  const value = String(text || "").replace(/\s+/g, " ").trim().slice(0, NOTE_TEXT_MAX);
  const items = notesFrom(stored);
  if (!value) return { ok: false, reason: "empty", items };
  if (!isSafeToSpeak(value)) return { ok: false, reason: "sensitive", items };
  const key = normalizeSpeechText(value);
  const kept = items.filter((item) => normalizeSpeechText(item.text) !== key);
  return { ok: true, items: [...kept, { text: value, at: now }].slice(-NOTES_MAX) };
}

// Apaga os lembretes que contêm o termo (sem acento/caixa). Devolve quantos saíram.
export function removeNotes(stored, term) {
  const items = notesFrom(stored);
  const key = normalizeSpeechText(term).replace(/^(o|a|os|as)\s+/, "");
  if (!key) return { items, removed: 0 };
  const kept = items.filter((item) => !normalizeSpeechText(item.text).includes(key));
  return { items: kept, removed: items.length - kept.length };
}

// Respostas curtas dos comandos (sorteadas; o texto ainda passa pela barreira da fala).
export const MEMORY_REPLIES = Object.freeze({
  remember: ["Anotado! Vou lembrar disso.", "Beleza, guardei aqui.", "Fechou, tá anotado.", "Pode deixar, não esqueço.", "Combinado, anotei."],
  rememberSensitive: ["Esse eu prefiro não guardar, tem dado sensível. Me fala sem número de documento ou telefone."],
  forget: ["Pronto, esqueci.", "Feito, apaguei esse lembrete.", "Beleza, tirei daqui."],
  forgetNone: ["Não achei nenhum lembrete sobre isso.", "Hum, não tenho nada anotado sobre isso."],
  forgetToday: ["Pronto, apaguei nossa conversa de hoje.", "Feito, a conversa de hoje foi pro lixo.", "Limpei tudo de hoje, começamos do zero."]
});
