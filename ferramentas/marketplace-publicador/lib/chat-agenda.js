// Chat do Marketplace (MKT-2) — agenda e escolha do que ler, lógica pura (sem chrome.*), testada em
// tests/chat-agenda.test.js. Sincroniza a cada ~2 min dentro do horário configurado no CRM (padrão 07–22h), nunca
// durante uma publicação, nunca com a extensão pausada, e só se o dono deixou a sincronização ligada.

import { saoPauloParts } from "./agenda.js";

export const CHAT_EVERY_MINUTES = 2;
export const MAX_THREADS_PER_ROUND = 5;
export const MAX_SENDS_PER_ROUND = 3;

export function decideChatTick({ state = {}, settings = {}, now = new Date() } = {}) {
  if (settings.syncEnabled === false) return { action: "skip", reason: "chat_desligado" };
  if (state.manualPause) return { action: "skip", reason: "pausado" };
  if (state.pausedUntil && new Date(state.pausedUntil).getTime() > now.getTime()) return { action: "skip", reason: "pausa_verificacao" };
  if (state.running) return { action: "skip", reason: "publicando" };
  if (state.chatRunning && now.getTime() - new Date(state.chatRunning).getTime() < 10 * 60 * 1000) return { action: "skip", reason: "chat_em_andamento" };
  const { hour } = saoPauloParts(now);
  const start = Number.isInteger(settings.startHour) ? settings.startHour : 7;
  const end = Number.isInteger(settings.endHour) ? settings.endHour : 22;
  if (hour < start || hour >= end) return { action: "skip", reason: "chat_fora_do_horario" };
  return { action: "sync", reason: null };
}

// Lê só as conversas que mudaram desde a última leitura (prévia diferente ou marcada como não lida), as mais novas
// primeiro (a lista já vem nessa ordem), no máximo 5 por rodada.
// Conversa nunca vista (sem prévia guardada) → full: importa o histórico inteiro (dono, 2026-10-20).
export function threadsToRead(threads = [], known = {}) {
  return threads
    .filter((thread) => thread.unread || known[thread.threadKey] !== thread.preview)
    .slice(0, MAX_THREADS_PER_ROUND)
    .map((thread) => ({ ...thread, full: !(thread.threadKey in known) }));
}

export function rememberPreviews(known = {}, threads = []) {
  const next = { ...known };
  for (const thread of threads) next[thread.threadKey] = thread.preview;
  // Guarda no máximo 300 conversas (armazenamento local limitado).
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - 300))) delete next[key];
  return next;
}

// Corpo do retorno de um envio: só pede nova tentativa se não chegou a apertar Enter (nada saiu no Facebook).
export function outboundResultBody(outcome = {}) {
  if (outcome.ok) return { status: "sent" };
  return { status: "failed", error: String(outcome.error || "Falha sem descrição.").slice(0, 500), retry: !outcome.sentAttempted && !outcome.checkpoint };
}
