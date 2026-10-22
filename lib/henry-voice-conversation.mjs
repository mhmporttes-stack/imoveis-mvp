// Conversa natural com o Henry (pedido do dono, 2026-10-22: "quero que pareça com uma conversa: se ele estiver falando e
// eu falar o nome dele, ele para" — docs/BUSINESS_RULES.md HENRY-1, "Modo conversa"). Núcleo PURO, usado pelo navegador
// (components/henry/HenryVoiceAssistant.jsx), pelo servidor (fala em partes) e pelos testes. Nada aqui grava nada: a
// memória da conversa vive só na página e é zerada ao sair do modo conversa.
import { detectWakeWord, looksLikeEcho, normalizeSpeechText, WAKE_WORDS_STRONG, HENRY_HISTORY_TURNS } from "./henry-voice-core.mjs";

export const CONVERSATION_IDLE_MS = 20000; // ~20 s de silêncio encerram o modo conversa
export const ACK_DELAY_MS = 1200; // resposta demorando mais que isso → confirmação curta ("Deixa eu ver…")
export const CONVERSATION_EXCHANGES = HENRY_HISTORY_TURNS / 2; // trocas (pergunta + resposta) mandadas ao modelo

// --- Interrupção ("barge-in") -----------------------------------------------------------------------------------------
// Enquanto o Henry fala ou pensa, SÓ o nome e as palavras de parada valem (o resto é a própria voz dele ou conversa da sala).
const STOP_WORDS = new Set(["para", "pare", "parar", "espera", "espere", "pera", "perai", "chega", "silencio", "stop"]);
const STOP_FILLER = new Set(["ai", "ei", "ok", "por", "favor", "agora", "so", "um", "pouco", "pode", "ta", "bom", ...WAKE_WORDS_STRONG]);

export function isStopCommand(text) {
  const tokens = normalizeSpeechText(text).split(" ").filter(Boolean);
  if (!tokens.length || tokens.length > 4) return false;
  return tokens.some((word) => STOP_WORDS.has(word)) && tokens.every((word) => STOP_WORDS.has(word) || STOP_FILLER.has(word));
}

// currentSpeech = o que o Henry está falando agora (filtro de eco: "para" dentro da própria fala dele não interrompe).
// Devolve { interrupt, kind: "question" | "report" | "wake" | "stop" | "", question }.
export function detectBargeIn(text, currentSpeech = "") {
  const wake = detectWakeWord(text);
  if (wake.called) return { interrupt: true, kind: wake.kind, question: wake.question };
  if (isStopCommand(text) && !looksLikeEcho(text, currentSpeech)) return { interrupt: true, kind: "stop", question: "" };
  return { interrupt: false, kind: "", question: "" };
}

// --- Fim do modo conversa ---------------------------------------------------------------------------------------------
const END_PHRASES = new Set([
  "obrigado", "obrigada", "obrigadao", "valeu", "pode parar", "tchau", "tchau tchau", "ate mais", "ate logo", "ate depois",
  "encerrar", "encerra", "pode ir", "so isso", "e so isso", "era so isso", "por hoje e so", "obrigado era so isso", "obrigado e so isso"
]);
const END_FILLER = new Set(["ok", "entao", "ta", "bom", "muito", "por", "favor", "ai", "beleza", ...WAKE_WORDS_STRONG]);

export function isConversationEnd(text) {
  const tokens = normalizeSpeechText(text).split(" ").filter(Boolean);
  if (!tokens.length || tokens.length > 7) return false;
  const core = tokens.filter((word) => !END_FILLER.has(word)).join(" ");
  if (END_PHRASES.has(core)) return true;
  return tokens.includes("tchau") && tokens.length <= 4;
}

export function isConversationExpired(lastActivityAt, now = Date.now(), idleMs = CONVERSATION_IDLE_MS) {
  return !lastActivityAt || now - lastActivityAt >= idleMs;
}

// --- Continuação sem o nome (modo conversa, Henry calado) -------------------------------------------------------------
const NOISE = new Set(["hum", "hmm", "humm", "ah", "ahn", "eh", "uhum", "aham", "ok", "ta", "e", "o", "a", "ne"]);

// spoken = o que o Henry falou por último (resposta e confirmação curta): frase igual é eco e é ignorada.
export function isEchoOf(text, spoken = []) {
  return (Array.isArray(spoken) ? spoken : [spoken]).some((item) => item && looksLikeEcho(text, item));
}

export function acceptFollowUp(text, spoken = []) {
  const tokens = normalizeSpeechText(text).split(" ").filter(Boolean);
  if (!tokens.length || tokens.every((word) => NOISE.has(word))) return false;
  if (isStopCommand(text)) return false;
  return !isEchoOf(text, spoken);
}

// Memória da conversa: só as trocas desde o início do modo conversa (startIndex), no máximo as últimas ~6.
export function conversationHistory(turns, startIndex = 0, exchanges = CONVERSATION_EXCHANGES) {
  const list = Array.isArray(turns) ? turns.slice(Math.max(0, Number(startIndex) || 0)) : [];
  return list.filter((turn) => turn && typeof turn.text === "string").slice(-exchanges * 2).map((turn) => ({ role: turn.role, text: turn.text }));
}

// Legenda do ícone do canto (cresce quando chamado): pensando → a pergunta; falando/em conversa → a última resposta.
export function henryCaption(phase, turns = []) {
  const list = Array.isArray(turns) ? turns : [];
  const last = (role) => [...list].reverse().find((turn) => turn?.role === role)?.text || "";
  if (phase === "thinking") return last("user");
  if (phase === "speaking" || phase === "armed") return last("assistant");
  return "";
}

// --- Ritmo -----------------------------------------------------------------------------------------------------------
// Confirmação curta enquanto a resposta não chega: voz do navegador, sem IA e sem chamada paga.
export const ACK_PHRASES = Object.freeze(["Deixa eu ver…", "Um segundo…", "Só um instante…", "Já vejo isso…", "Vou conferir…"]);

export function pickAcknowledgement(previous = "", random = Math.random) {
  const options = ACK_PHRASES.filter((phrase) => phrase !== previous);
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))];
}

// Primeira frase primeiro: a voz da 1ª frase fica pronta antes e já começa a tocar enquanto o resto é gerado.
export function splitForSpeech(text) {
  const value = String(text || "").trim();
  const match = value.match(/^(.{20,}?[.!?])\s+(\S[\s\S]*)$/);
  return match ? [match[1], match[2]] : value ? [value] : [];
}

// Escuta que caiu: religa com espera crescente (0,4 s, 0,8 s… até 30 s); volta ao rápido quando ouve algo.
export function nextRestartDelay(failures = 0) {
  return Math.min(30000, 400 * 2 ** Math.max(0, Math.min(10, Number(failures) || 0)));
}
