// Agenda, limites e estados do publicador — lógica pura (sem chrome.*), testada em tests/agenda.test.js.
// Regras: verifica a fila a cada ~15 min, só das 08:00 às 20:00 (São Paulo); no máximo 3 publicações por dia;
// intervalo mínimo de 1 h entre publicações (60–80 min, com variação aleatória); checkpoint/verificação/limite do
// Facebook → pausa de 24 h; pausa manual pelo popup.

export const TIME_ZONE = "America/Sao_Paulo";
export const CHECK_EVERY_MINUTES = 15;
export const WINDOW_START_HOUR = 8;
export const WINDOW_END_HOUR = 20;
export const DAILY_LIMIT = 3;
export const MIN_INTERVAL_MS = 60 * 60 * 1000;
export const INTERVAL_JITTER_MS = 20 * 60 * 1000;
export const CHECKPOINT_PAUSE_MS = 24 * 60 * 60 * 1000;
export const STALE_RUN_MS = 20 * 60 * 1000;
export const HISTORY_LIMIT = 30;

export function initialState() {
  return { manualPause: false, pausedUntil: null, pauseReason: "", daily: { date: "", count: 0 }, nextAllowedAt: null, running: null, lastCheckAt: null, lastCheckResult: "", history: [] };
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

export function todayCount(state, now = new Date()) {
  return state?.daily?.date === saoPauloParts(now).dateKey ? Number(state.daily.count || 0) : 0;
}

// Intervalo até a próxima publicação: nunca menos de 1 h.
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
  if (!isWithinWindow(now)) return { action: "skip", reason: "fora_do_horario" };
  if (todayCount(s, now) >= DAILY_LIMIT) return { action: "skip", reason: "limite_diario" };
  if (s.nextAllowedAt && new Date(s.nextAllowedAt).getTime() > t) return { action: "skip", reason: "intervalo" };
  return { action: "check", reason: null };
}

export function startJob(state, listing, now = new Date()) {
  const s = { ...initialState(), ...(state || {}) };
  const { dateKey } = saoPauloParts(now);
  const count = todayCount(s, now);
  return { ...s, daily: { date: dateKey, count: count + 1 }, running: { listingId: listing.id, title: listing.title, startedAt: now.toISOString(), step: "início" } };
}

// Resultado do conteúdo (content.js) → corpo para o CRM. Só pede nova tentativa quando nada foi enviado ao
// Facebook (falha ANTES de clicar em Publicar). Depois do clique, nunca: duplicaria o anúncio.
export function buildResultBody(outcome = {}) {
  if (outcome.ok) return { status: "published", url: outcome.url || "" };
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
    error: outcome.ok ? "" : String(outcome.error || "").slice(0, 300),
    screenshot: outcome.screenshot || ""
  };
  const next = {
    ...s,
    running: null,
    nextAllowedAt: new Date(now.getTime() + nextIntervalMs(random)).toISOString(),
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

export function recordCheck(state, result, now = new Date()) {
  return { ...initialState(), ...(state || {}), lastCheckAt: now.toISOString(), lastCheckResult: result };
}

export const REASON_LABELS = {
  pausado: "Pausado por você",
  pausa_verificacao: "Pausado por verificação do Facebook",
  em_andamento: "Publicando agora",
  fora_do_horario: "Fora do horário (08:00–20:00)",
  limite_diario: "Limite de 3 publicações hoje atingido",
  intervalo: "Aguardando o intervalo mínimo entre publicações",
  fila_vazia: "Nenhum anúncio aprovado na fila",
  publicacao_em_andamento: "CRM: já há uma publicação em andamento",
  intervalo_minimo: "CRM: aguardando intervalo mínimo",
  sem_configuracao: "Configure a URL do CRM e a chave nas opções",
  chave_invalida: "Chave recusada pelo CRM — gere outra no CRM",
  erro_crm: "CRM indisponível — tenta de novo no próximo ciclo"
};
