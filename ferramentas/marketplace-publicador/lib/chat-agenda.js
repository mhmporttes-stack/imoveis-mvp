// Chat do Marketplace (MKT-2) — agenda e escolha do que ler, lógica pura (sem chrome.*), testada em
// tests/chat-agenda.test.js. Sincroniza a cada ~2 min dentro do horário configurado no CRM (padrão 07–22h), nunca
// durante uma publicação, nunca com a extensão pausada, e só se o dono deixou a sincronização ligada.

import { saoPauloParts } from "./agenda.js";

export const CHAT_EVERY_MINUTES = 2;
export const MAX_THREADS_PER_ROUND = 5;
export const MAX_SENDS_PER_ROUND = 3;

// Trava da sincronização (1.8.7). Na 1.8.6 a trava era `state.chatRunning` (sem dono, sem batimento): o service
// worker do MV3 era encerrado no meio da rodada (leitura longa da caixa/histórico sem nenhuma chamada à API da
// extensão), o finally nunca rodava e toda rodada seguinte desistia com "sincronizando". Agora a trava fica em
// chrome.storage (`chatLock`) com dono (token + instância do worker) e batimento a cada etapa/20 s:
// - morta se o worker que a criou não existe mais (instância diferente — o Chrome só roda um worker por extensão);
// - morta se ficou CHAT_LOCK_TTL_MS sem batimento (etapa travada além do próprio timeout);
// - morta se a rodada passou de CHAT_LOCK_MAX_MS no total.
export const CHAT_LOCK_TTL_MS = 4 * 60 * 1000;
export const CHAT_LOCK_MAX_MS = 12 * 60 * 1000;
// Orçamento de uma rodada: depois disso não começa conversa/envio novo (o resto fica para a próxima, em 2 min).
export const ROUND_BUDGET_MS = 4 * 60 * 1000;
// Conversas nunca vistas (histórico completo) por rodada — as demais nas próximas rodadas.
export const MAX_FULL_THREADS_PER_ROUND = 5;

export function chatLockAlive(lock, { now = new Date(), instance = "" } = {}) {
  if (!lock?.token || !lock.startedAt) return false;
  const t = now.getTime();
  if (instance && lock.instance && lock.instance !== instance) return false;
  const beat = new Date(lock.heartbeatAt || lock.stepAt || lock.startedAt).getTime();
  if (!Number.isFinite(beat) || t - beat > CHAT_LOCK_TTL_MS) return false;
  if (t - new Date(lock.startedAt).getTime() > CHAT_LOCK_MAX_MS) return false;
  return true;
}

// Texto do popup: etapa atual e há quanto tempo (ex.: "lendo conversa 2/5 (Ana) há 35 s").
export function describeChatLock(lock, now = new Date()) {
  if (!lock?.token) return "";
  const ago = (iso) => {
    const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
    return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
  };
  return `${lock.step || "iniciando"} há ${ago(lock.stepAt || lock.startedAt)} (rodada começou há ${ago(lock.startedAt)})`;
}

export function decideChatTick({ state = {}, settings = {}, now = new Date(), lock = null, instance = "" } = {}) {
  if (settings.syncEnabled === false) return { action: "skip", reason: "chat_desligado" };
  if (state.manualPause) return { action: "skip", reason: "pausado" };
  if (state.pausedUntil && new Date(state.pausedUntil).getTime() > now.getTime()) return { action: "skip", reason: "pausa_verificacao" };
  if (state.running) return { action: "skip", reason: "publicando" };
  if (chatLockAlive(lock, { now, instance })) return { action: "skip", reason: "chat_em_andamento" };
  const { hour } = saoPauloParts(now);
  const start = Number.isInteger(settings.startHour) ? settings.startHour : 7;
  const end = Number.isInteger(settings.endHour) ? settings.endHour : 22;
  if (hour < start || hour >= end) return { action: "skip", reason: "chat_fora_do_horario" };
  return { action: "sync", reason: null };
}

// Lê só as conversas que mudaram desde a última leitura (prévia diferente ou marcada como não lida), as mais novas
// primeiro (a lista já vem nessa ordem), no máximo 5 por rodada (das quais no máximo MAX_FULL_THREADS_PER_ROUND
// nunca vistas). Conversa nunca vista (sem prévia guardada) → full: importa o histórico inteiro (dono, 2026-10-20).
// As que ficarem de fora continuam "mudadas" (prévia não guardada) e entram nas próximas rodadas.
export function threadsToRead(threads = [], known = {}) {
  let full = 0;
  return threads
    .filter((thread) => thread.unread || known[thread.threadKey] !== thread.preview)
    .map((thread) => ({ ...thread, full: !(thread.threadKey in known) }))
    .filter((thread) => !thread.full || (full += 1) <= MAX_FULL_THREADS_PER_ROUND)
    .slice(0, MAX_THREADS_PER_ROUND);
}

// 1ª carga (dono, 2026-10-21: "os anteriores não carregue"): conversa cuja última atividade na lista (hora/data
// relativa da caixa: "18:34" = hoje, "Ontem"/"1 d" = ontem…) é anterior a ignoreBefore (dia, São Paulo) nem é aberta.
// A última atividade é >= a última mensagem do cliente, então nada recente é pulado. Sem data reconhecida → lê
// (o CRM decide). As ignoradas têm a prévia guardada: só voltam se aparecer mensagem nova.
export function splitIgnored(threads = [], ignoreBefore = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ignoreBefore || ""))) return { keep: threads, ignored: [] };
  const keep = [];
  const ignored = [];
  for (const thread of threads) {
    const at = thread.lastActivityAt ? new Date(thread.lastActivityAt) : null;
    if (at && Number.isFinite(at.getTime()) && saoPauloParts(at).dateKey < ignoreBefore) ignored.push(thread);
    else keep.push(thread);
  }
  return { keep, ignored };
}

export function rememberPreviews(known = {}, threads = []) {
  const next = { ...known };
  for (const thread of threads) next[thread.threadKey] = thread.preview;
  // Guarda no máximo 300 conversas (armazenamento local limitado).
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - 300))) delete next[key];
  return next;
}

// Corpo do retorno de um envio: retry=true só se não chegou a apertar Enter (nada saiu no Facebook). 1.9.6: verified =
// a conferência achou a resposta já na conversa (nada foi digitado); closed = o Facebook não deixa responder (o CRM para
// de reenviar).
export function outboundResultBody(outcome = {}) {
  if (outcome.ok) return outcome.verified ? { status: "sent", verified: true } : { status: "sent" };
  const body = { status: "failed", error: String(outcome.error || "Falha sem descrição.").slice(0, 500), retry: !outcome.sentAttempted && !outcome.checkpoint && !outcome.closed, unconfirmed: Boolean(outcome.unconfirmed) };
  if (outcome.closed) body.closed = true;
  // 1.9.7 (MKT-2l): resposta automática não digitada porque havia texto no campo do Facebook.
  if (outcome.humanTyping) body.humanTyping = true;
  return body;
}

// 1.9.6 (dono, 2026-10-24): resultado da conferência antes do reenvio → o que fazer. null = pode digitar (não houve
// conferência, ou a resposta não está na conversa). Não deu para conferir → NÃO digita (unconfirmed: o CRM pede de novo
// em 30 s e confere outra vez) — nunca reenvia no escuro.
export function verifyOutcome(check) {
  if (!check) return null;
  if (check.ok && check.present) return { ok: true, verified: true, sentAttempted: false };
  if (check.ok) return null;
  if (check.closed) return { ok: false, sentAttempted: false, closed: true, error: check.error || "Conversa bloqueada ou encerrada pelo Facebook." };
  if (check.checkpoint) return { ok: false, sentAttempted: false, checkpoint: true, error: check.error || "O Facebook mostrou verificação/limite." };
  return { ok: false, sentAttempted: true, unconfirmed: true, error: check.error || "Não consegui conferir a conversa antes de reenviar." };
}

// 1.9.6: depois de uma falha, espera isto antes de tentar de novo na mesma rodada (dono: "você espera 30 segundos e
// tenta enviar de novo"). O CRM só devolve a mesma resposta 30 s depois da falha (SEND_RETRY_INTERVAL_MS).
export const SEND_RETRY_WAIT_MS = 30 * 1000;

// Nova tentativa espaçada por conversa (1.9.3). Diagnóstico real de 21–22/10: a mesma conversa que não abria era
// tentada de novo a cada rodada (2 min), gastando 25 s a 3,5 min, trocando a aba do Facebook na frente e travando as
// outras. Agora, depois de uma falha, a conversa espera 4 → 8 → 15 → 30 min (teto) antes de nova tentativa; leitura
// bem-sucedida zera. Falha por aba oculta (Chrome sem mostrar a página) não conta: não é culpa da conversa.
export const THREAD_RETRY_STEPS_MIN = [4, 8, 15, 30];

export function threadRetryBlocked(backoff = {}, threadKey, now = new Date()) {
  const entry = backoff?.[threadKey];
  return Boolean(entry?.nextAt && new Date(entry.nextAt).getTime() > now.getTime());
}

export function recordThreadFailure(backoff = {}, threadKey, now = new Date()) {
  const fails = Number(backoff?.[threadKey]?.fails || 0) + 1;
  const minutes = THREAD_RETRY_STEPS_MIN[Math.min(fails, THREAD_RETRY_STEPS_MIN.length) - 1];
  const next = { ...backoff, [threadKey]: { fails, nextAt: new Date(now.getTime() + minutes * 60 * 1000).toISOString() } };
  // Guarda no máximo 100 conversas (as mais antigas saem).
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - 100))) delete next[key];
  return next;
}

export function clearThreadFailure(backoff = {}, threadKey) {
  if (!backoff?.[threadKey]) return backoff || {};
  const next = { ...backoff };
  delete next[threadKey];
  return next;
}

// Diagnóstico de conversa que não abriu (1.9.3): no máximo 1 a cada 30 min POR TIPO de falha (antes era 1 a cada
// 30 min no total — uma falha nova ficava escondida atrás da repetida); "aba_oculta" (causa já conhecida) 1 a cada 2 h.
export function diagnosticDue(sentAt = {}, result = "", now = new Date()) {
  const every = result === "aba_oculta" ? 2 * 60 * 60 * 1000 : 30 * 60 * 1000;
  const last = new Date(sentAt?.[result] || 0).getTime();
  return !Number.isFinite(last) || now.getTime() - last >= every;
}
