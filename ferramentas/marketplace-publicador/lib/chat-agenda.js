// Chat do Marketplace (MKT-2) — agenda e escolha do que ler, lógica pura (sem chrome.*), testada em
// tests/chat-agenda.test.js. Sincroniza a cada ~1 min (1.9.9; era 2 min) dentro do horário configurado no CRM (padrão 07–22h), nunca
// durante uma publicação, nunca com a extensão pausada, e só se o dono deixou a sincronização ligada.

import { saoPauloParts } from "./agenda.js";

// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-26, 1.9.9] "Diminua esse tempo para 1 minuto e deixe cada rodada durando até
// 10 minutos, caso haja necessidade. Se não, pode voltar e aguardar mais 1 minuto para a próxima rodada". Rodada a cada
// 1 min, contado do FIM da anterior (o background recria o alarme no fim de cada rodada); alarme com rodada em andamento
// pula ("chat_em_andamento"). Era 2 min / 5 conversas / 3 envios até a 1.9.8.
export const CHAT_EVERY_MINUTES = 1;
export const MAX_THREADS_PER_ROUND = 15;
// Teto de segurança por rodada = limite por hora (40). Quem limita de fato: o orçamento de 10 min, as pausas humanas entre
// envios (4–10 s), o ritmo de 30 s das automáticas e o limite por hora conferido no CRM.
export const MAX_SENDS_PER_ROUND = 40;
// Resposta automática com hora marcada até isto à frente (CRM devolve `nextAt`): a rodada espera por ela em vez de
// encerrar — é o que faz as automáticas acumuladas saírem uma a cada 30 s (dono, 2026-10-26).
export const OUTBOX_WAIT_MAX_MS = 60 * 1000;

// Trava da sincronização (1.8.7). Na 1.8.6 a trava era `state.chatRunning` (sem dono, sem batimento): o service
// worker do MV3 era encerrado no meio da rodada (leitura longa da caixa/histórico sem nenhuma chamada à API da
// extensão), o finally nunca rodava e toda rodada seguinte desistia com "sincronizando". Agora a trava fica em
// chrome.storage (`chatLock`) com dono (token + instância do worker) e batimento a cada etapa/20 s:
// - morta se o worker que a criou não existe mais (instância diferente — o Chrome só roda um worker por extensão);
// - morta se ficou CHAT_LOCK_TTL_MS sem batimento (etapa travada além do próprio timeout);
// - morta se a rodada passou de CHAT_LOCK_MAX_MS no total.
// TTL: o batimento roda a cada 20 s mesmo durante uma etapa longa, então 4 min sem batimento = worker travado.
// MAX (1.9.9): orçamento de 10 min + a etapa mais longa que pode começar no último instante (envio, 330 s) + sinal ao
// CRM e fechamento (~1,5 min) = 17 min; 18 min de teto, para não matar uma rodada longa viva.
export const CHAT_LOCK_TTL_MS = 4 * 60 * 1000;
export const CHAT_LOCK_MAX_MS = 18 * 60 * 1000;
// Orçamento de uma rodada: depois disso não começa conversa/envio novo (o resto fica para a próxima, 1 min depois).
// 1.9.9 (dono, 2026-10-26): até 10 min "caso haja necessidade"; sem trabalho a rodada termina em segundos. Era 4 min.
export const ROUND_BUDGET_MS = 10 * 60 * 1000;
// Conversas nunca vistas (histórico completo) por rodada — as demais nas próximas rodadas.
export const MAX_FULL_THREADS_PER_ROUND = 5;

// Fila sem resposta pronta agora (1.9.9): se o CRM avisou a próxima automática (`nextAt`) para daqui a até 60 s e ela cabe
// no orçamento da rodada, devolve quantos ms esperar (com 1 s de folga); senão 0 (a rodada encerra e a próxima pega).
// Limite por hora ou fila vazia de verdade: o CRM não manda `nextAt` → 0.
export function outboxWaitMs(next, { now = Date.now(), elapsedMs = 0, budgetMs = ROUND_BUDGET_MS } = {}) {
  if (next?.message || !next?.nextAt) return 0;
  const at = new Date(next.nextAt).getTime();
  if (!Number.isFinite(at)) return 0;
  const wait = Math.max(0, at - now) + 1000;
  if (wait > OUTBOX_WAIT_MAX_MS + 1000 || elapsedMs + wait > budgetMs) return 0;
  return wait;
}

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
// primeiro (a lista já vem nessa ordem), no máximo MAX_THREADS_PER_ROUND (15 desde a 1.9.9) por rodada (das quais no máximo MAX_FULL_THREADS_PER_ROUND
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
