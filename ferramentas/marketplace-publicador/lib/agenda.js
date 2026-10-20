// Agenda, limites e estados do publicador — lógica pura (sem chrome.*), testada em tests/agenda.test.js.
// Regras: verifica a fila a cada ~15 min, só das 08:00 às 20:00 (São Paulo); no máximo 3 publicações BEM-SUCEDIDAS
// por dia (falha não conta); entre uma publicação e a próxima só 2–5 min (decisão do dono, 2026-10-20: sem o
// intervalo de 1 h — "sempre que eu enviar o imóvel, ele já posta");
// depois de uma falha, nova tentativa em 15–20 min; no máximo 6 tentativas no dia (freio contra rajada);
// checkpoint/verificação/limite do Facebook → pausa de 24 h; pausa manual pelo popup.

export const TIME_ZONE = "America/Sao_Paulo";
export const CHECK_EVERY_MINUTES = 15;
export const WINDOW_START_HOUR = 8;
export const WINDOW_END_HOUR = 20;
export const DAILY_LIMIT = 3;
export const MIN_INTERVAL_MS = 2 * 60 * 1000;
export const INTERVAL_JITTER_MS = 3 * 60 * 1000;
export const RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;
export const RETRY_JITTER_MS = 5 * 60 * 1000;
export const DAILY_ATTEMPT_LIMIT = 6;
export const CHECKPOINT_PAUSE_MS = 24 * 60 * 60 * 1000;
export const STALE_RUN_MS = 20 * 60 * 1000;
export const HISTORY_LIMIT = 30;

export function initialState() {
  return { manualPause: false, pausedUntil: null, pauseReason: "", daily: { date: "", count: 0, attempts: 0 }, nextAllowedAt: null, running: null, lastCheckAt: null, lastCheckResult: "", history: [] };
}

export function saoPauloParts(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );
  return { dateKey: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

export function isWithinWindow(now = new Date()) {
  const { hour } = saoPauloParts(now);
  return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

// Publicações bem-sucedidas hoje.
export function todayCount(state, now = new Date()) {
  return state?.daily?.date === saoPauloParts(now).dateKey ? Number(state.daily.count || 0) : 0;
}

// Tentativas (sucesso + falha) hoje.
export function todayAttempts(state, now = new Date()) {
  return state?.daily?.date === saoPauloParts(now).dateKey ? Number(state.daily.attempts || 0) : 0;
}

export function retryDelayMs(random = Math.random) {
  return RETRY_AFTER_FAILURE_MS + Math.floor(Math.max(0, Math.min(1, random())) * RETRY_JITTER_MS);
}

// Intervalo até a próxima publicação: 2–5 min (só para não rajar).
export function nextIntervalMs(random = Math.random) {
  return MIN_INTERVAL_MS + Math.floor(Math.max(0, Math.min(1, random())) * INTERVAL_JITTER_MS);
}

// Decide se este "tique" (alarme de 15 min ou botão "Verificar agora") pode consultar a fila.
export function decideTick(state, now = new Date()) {
  const s = { ...initialState(), ...(state || {}) };
  const t = now.getTime();
  if (s.manualPause) return { action: "skip", reason: "pausado" };
  if (s.pausedUntil && new Date(s.pausedUntil).getTime() > t) return { action: "skip", reason: "pausa_verificacao" };
  if (s.running && t - new Date(s.running.startedAt).getTime() < STALE_RUN_MS) return { action: "skip", reason: "em_andamento" };
  // Chat do Marketplace lendo/enviando agora: a publicação espera (uma automação no Facebook por vez).
  if (s.chatRunning && t - new Date(s.chatRunning).getTime() < 10 * 60 * 1000) return { action: "skip", reason: "chat_em_andamento" };
  if (!isWithinWindow(now)) return { action: "skip", reason: "fora_do_horario" };
  if (todayCount(s, now) >= DAILY_LIMIT) return { action: "skip", reason: "limite_diario" };
  if (todayAttempts(s, now) >= DAILY_ATTEMPT_LIMIT) return { action: "skip", reason: "limite_tentativas" };
  if (s.nextAllowedAt && new Date(s.nextAllowedAt).getTime() > t) return { action: "skip", reason: "intervalo" };
  return { action: "check", reason: null };
}

export function startJob(state, listing, now = new Date()) {
  const s = { ...initialState(), ...(state || {}) };
  const { dateKey } = saoPauloParts(now);
  return { ...s, daily: { date: dateKey, count: todayCount(s, now), attempts: todayAttempts(s, now) + 1 }, running: { listingId: listing.id, title: listing.title, startedAt: now.toISOString(), step: "início" } };
}

// Resultado do conteúdo (content.js) → corpo para o CRM. Só pede nova tentativa quando nada foi enviado ao
// Facebook (falha ANTES de clicar em Publicar). Depois do clique, nunca: duplicaria o anúncio.
export function buildResultBody(outcome = {}) {
  if (outcome.ok) return { status: "published", url: outcome.url || "", ...(outcome.groups ? { groups: { selected: outcome.groups.selected || [], missing: outcome.groups.missing || [] } } : {}) };
  const step = outcome.step ? `Passo: ${outcome.step}. ` : "";
  const detail = outcome.error || "falha sem descrição";
  const prefix = outcome.checkpoint ? "Facebook pediu verificação/limite — extensão pausada 24 h. " : "";
  return { status: "failed", error: `${prefix}${step}${detail}`.slice(0, 1000), retry: !outcome.clickedPublish };
}

export function finishJob(state, outcome = {}, now = new Date(), random = Math.random) {
  const s = { ...initialState(), ...(state || {}) };
  const entry = {
    at: now.toISOString(),
    listingId: s.running?.listingId || outcome.listingId || "",
    title: s.running?.title || outcome.title || "",
    status: outcome.ok ? "published" : "failed",
    url: outcome.url || "",
    step: outcome.step || "",
    error: outcome.ok ? "" : String(outcome.error || "").slice(0, 1000),
    screenshot: outcome.screenshot || ""
  };
  const { dateKey } = saoPauloParts(now);
  const next = {
    ...s,
    running: null,
    // Só publicação bem-sucedida conta no limite do dia e abre o intervalo de 1 h; falha → nova tentativa em 15–20 min.
    daily: { date: dateKey, count: todayCount(s, now) + (outcome.ok ? 1 : 0), attempts: Math.max(todayAttempts(s, now), 1) },
    nextAllowedAt: new Date(now.getTime() + (outcome.ok ? nextIntervalMs(random) : retryDelayMs(random))).toISOString(),
    history: [entry, ...(s.history || [])].slice(0, HISTORY_LIMIT)
  };
  if (outcome.checkpoint) {
    next.pausedUntil = new Date(now.getTime() + CHECKPOINT_PAUSE_MS).toISOString();
    next.pauseReason = "O Facebook pediu verificação ou avisou de limite. Resolva no Facebook; a extensão volta sozinha em 24 h.";
  }
  // Prints só no histórico local, e só dos 5 mais recentes (armazenamento limitado).
  next.history = next.history.map((item, index) => (index < 5 ? item : { ...item, screenshot: "" }));
  return next;
}

export function setManualPause(state, paused) {
  const s = { ...initialState(), ...(state || {}) };
  return paused ? { ...s, manualPause: true } : { ...s, manualPause: false, pausedUntil: null, pauseReason: "" };
}

// Ao atualizar a extensão: recalcula o dia pelo histórico (versões antigas contavam falha como publicação e
// abriam o intervalo de 1 h depois de falha).
export function recomputeFromHistory(state, now = new Date()) {
  const s = { ...initialState(), ...(state || {}) };
  const { dateKey } = saoPauloParts(now);
  const today = (s.history || []).filter((item) => item.at && saoPauloParts(new Date(item.at)).dateKey === dateKey);
  const published = today.filter((item) => item.status === "published");
  const lastPublished = published.map((item) => new Date(item.at).getTime()).sort((a, b) => b - a)[0];
  const nextAllowed = lastPublished ? lastPublished + MIN_INTERVAL_MS : 0;
  return {
    ...s,
    daily: { date: dateKey, count: published.length, attempts: today.length },
    nextAllowedAt: nextAllowed > now.getTime() ? new Date(nextAllowed).toISOString() : null
  };
}

export function recordCheck(state, result, now = new Date(), waitUntil = null) {
  return { ...initialState(), ...(state || {}), lastCheckAt: now.toISOString(), lastCheckResult: result, lastCheckWaitUntil: waitUntil || null };
}

// Até quando um bloqueio LOCAL segura a próxima tentativa (para mostrar "até HH:MM").
export function localWaitUntil(state, reason) {
  if (reason === "intervalo") return state?.nextAllowedAt || null;
  if (reason === "pausa_verificacao") return state?.pausedUntil || null;
  return null;
}

// Texto curto para o popup: motivo + horário de liberação (São Paulo), quando houver.
export function describeCheck(reason, waitUntil = null) {
  const label = REASON_LABELS[reason] || reason || "—";
  if (!waitUntil) return label;
  const time = new Date(waitUntil).toLocaleTimeString("pt-BR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
  return `${label} até ${time}`;
}

export const REASON_LABELS = {
  pausado: "Pausado por você",
  pausa_verificacao: "Pausado por verificação do Facebook",
  em_andamento: "Publicando agora",
  fora_do_horario: "Fora do horário (08:00–20:00)",
  limite_diario: "Limite de 3 publicações hoje atingido",
  limite_tentativas: "Muitas tentativas hoje — volta amanhã",
  intervalo_tentativa: "CRM: aguardando alguns minutos desde a última tentativa",
  intervalo: "Aguardando o intervalo (2–5 min depois de publicar; 15–20 min depois de falha)",
  fila_vazia: "Nenhum anúncio aprovado na fila",
  publicacao_em_andamento: "CRM: já há uma publicação em andamento",
  intervalo_minimo: "CRM: aguardando intervalo mínimo",
  intervalo_seguranca: "Aguardando intervalo de segurança",
  verificando: "Verificando…",
  chat_em_andamento: "Chat do Marketplace sincronizando — tenta de novo em instantes",
  chat_desligado: "Sincronização do chat desligada no CRM",
  chat_fora_do_horario: "Chat fora do horário configurado",
  publicando: "Publicando agora — acompanhe pela aba do Facebook",
  publicado: "Publicado",
  falhou: "Falhou — veja o histórico",
  sem_configuracao: "Configure a URL do CRM e a chave nas opções",
  chave_invalida: "Chave recusada pelo CRM — gere outra no CRM",
  erro_crm: "CRM indisponível — tenta de novo no próximo ciclo"
};
