import "server-only";
import { acquireLock, markCacheError, readCache, releaseLock, writeCache } from "./cache";
import { fetchStatusCounts } from "./funnel-stock";
import { BROKER_STOCK_CACHE_KEY, computeBrokerStock } from "./broker-stock";
import { upsertSnapshots } from "./snapshots";
import { computePendencias, computeTeamGoal, rangeKeyFor, readPendencias } from "./team-goal";
import { closeRows, pendenciasRows } from "./snapshot-rows-core.mjs";
import { computeOverview, computeOverviewRange } from "./overview";
import { OVERVIEW_CACHE_KEYS, PREVIOUS_OVERVIEW_IDS, previousOverviewRange, rangeKeyOfRange } from "./overview-core.mjs";
import { addDaysToPlainDate, getTodayInSaoPaulo } from "../daily-report";

// Jobs de métricas (chamados pelo pg_cron via /api/cron/crm-snapshots).
//   refresh = atualiza o cache de "hoje" (uma tarefa por vez);
//   heavy   = semana, mês, períodos fechados e anteriores (job próprio);
//   stock   = retrato diário do ESTOQUE do dia (23:55 de Brasília);
//   close   = ajuste do dia anterior depois do fechamento da Meta (00:10).
// Cada tarefa tem orçamento de tempo e falha isolada: o último valor bom
// continua no cache. Logs só com nome da tarefa e tipo do erro.

const LOCK_NAME = "crm-refresh";
const HEAVY_LOCK_NAME = "crm-refresh-heavy";
const TASK_BUDGET_MS = 25000;
const MAX_HEAVY_PER_CYCLE = 2; // só na reserva do refresh (job dos pesados parado)
const JOB_BUDGET_MS = 38000; // não começa tarefa nova depois disso (o cron espera até 50 s)
const HEAVY_START_BUDGET_MS = 25000; // pesados: 25 s + 25 s da última tarefa < 55 s da rota

function withBudget(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// everyMinutes: só recalcula se o cache estiver mais velho que isso.
// rangeKeyOf: período FECHADO — recalcula quando a data de referência muda.
// REFRESH_TASKS = contas de "hoje" (job refresh, a cada 10 min no expediente).
export const REFRESH_TASKS = [
  {
    key: "funil_estoque",
    cacheKey: "funil:estoque",
    run: async () => ({ ...(await fetchStatusCounts()), capturedAt: new Date().toISOString() })
  },
  { key: "funil_corretores", cacheKey: BROKER_STOCK_CACHE_KEY, run: () => computeBrokerStock() },
  { key: "meta_hoje", cacheKey: "meta:hoje", run: () => computeTeamGoal("hoje") },
  { key: "pendencias_hoje", cacheKey: "pendencias:hoje", run: () => computePendencias() },
  { key: "overview_hoje", cacheKey: "overview:hoje", run: () => computeOverview("hoje") }
];

// Pesados (semana, mês, meta do mês, períodos fechados e o período anterior que o
// Henry usa na comparação) — job próprio ?mode=heavy (2026-10-23, aprovado pelo
// dono): no job refresh as contas de "hoje" gastavam todo o orçamento e estes
// quase nunca rodavam (cache do mês com 3 h). everyMinutes 25 + job de 10 em 10
// min = recalculado a cada ~30 min, dentro da validade de 45 min das telas/voz.
export const HEAVY_REFRESH_TASKS = [
  { key: "overview_este_mes", cacheKey: "overview:este_mes", everyMinutes: 25, run: () => computeOverview("este_mes") },
  { key: "meta_este_mes", cacheKey: "meta:este_mes", everyMinutes: 25, run: () => computeTeamGoal("este_mes") },
  { key: "overview_esta_semana", cacheKey: "overview:esta_semana", everyMinutes: 25, run: () => computeOverview("esta_semana") },
  { key: "meta_esta_semana", cacheKey: "meta:esta_semana", everyMinutes: 25, run: () => computeTeamGoal("esta_semana") },
  { key: "meta_ontem", cacheKey: "meta:ontem", everyMinutes: 120, run: () => computeTeamGoal("ontem") },
  { key: "overview_ontem", cacheKey: "overview:ontem", everyMinutes: 120, run: () => computeOverview("ontem") },
  { key: "meta_semana_passada", cacheKey: "meta:semana_passada", rangeKeyOf: () => rangeKeyFor("semana_passada"), run: () => computeTeamGoal("semana_passada") },
  { key: "meta_mes_passado", cacheKey: "meta:mes_passado", rangeKeyOf: () => rangeKeyFor("mes_passado"), run: () => computeTeamGoal("mes_passado") },
  { key: "overview_semana_passada", cacheKey: "overview:semana_passada", rangeKeyOf: () => rangeKeyFor("semana_passada"), run: () => computeOverview("semana_passada") },
  { key: "overview_mes_passado", cacheKey: "overview:mes_passado", rangeKeyOf: () => rangeKeyFor("mes_passado"), run: () => computeOverview("mes_passado") },
  ...PREVIOUS_OVERVIEW_IDS.map((id) => ({
    key: `overview_${id}`,
    cacheKey: OVERVIEW_CACHE_KEYS[id],
    rangeKeyOf: () => rangeKeyOfRange(previousOverviewRange(id, getTodayInSaoPaulo())),
    run: () => computeOverviewRange(id, previousOverviewRange(id, getTodayInSaoPaulo()))
  }))
];

// Prioridade de uma tarefa (null = em dia). Sem valor, com erro ou de outro
// período = primeiro; depois a mais atrasada em relação ao próprio intervalo.
async function duePriority(task) {
  if (!task.everyMinutes && !task.rangeKeyOf) return 1;
  const entry = await readCache(task.cacheKey, task.everyMinutes || 100000);
  if (!entry || entry.status === "error") return Infinity;
  if (task.rangeKeyOf) return entry.payload?.rangeKey !== task.rangeKeyOf() ? Infinity : null;
  const age = entry.ageMinutes ?? 99999;
  return age >= task.everyMinutes ? age / task.everyMinutes : null;
}

// Conta as requisições ao Supabase feitas durante a tarefa (aproximado: o job
// roda sozinho sob trava, mas o processo pode atender outras rotas ao mesmo tempo).
function countSupabaseCalls() {
  const original = globalThis.fetch;
  const state = { calls: 0 };
  globalThis.fetch = (...args) => {
    if (String(args[0]?.url || args[0] || "").includes("supabase")) state.calls += 1;
    return original(...args);
  };
  return { state, restore: () => { globalThis.fetch = original; } };
}

async function runTask(task) {
  const started = Date.now();
  const counter = countSupabaseCalls();
  try {
    const payload = await withBudget(task.run(), TASK_BUDGET_MS);
    await writeCache(task.cacheKey, payload, { computeMs: Date.now() - started });
    counter.restore();
    return { task: task.key, ok: true, ms: Date.now() - started, calls: counter.state.calls };
  } catch (error) {
    counter.restore();
    const code = error?.message === "timeout" ? "timeout" : error?.name || "erro";
    console.warn(`[crm-metrics] tarefa ${task.key} falhou: ${code}.`);
    await markCacheError(task.cacheKey, code);
    return { task: task.key, ok: false, ms: Date.now() - started, calls: counter.state.calls, error: code };
  }
}

export async function runRefresh(tasks = REFRESH_TASKS) {
  if (!(await acquireLock(LOCK_NAME, 120))) return { skipped: "ja_em_execucao" };
  const started = Date.now();
  try {
    const results = [];
    for (const task of tasks) {
      if (Date.now() - started > JOB_BUDGET_MS) {
        results.push({ task: task.key, ok: true, skipped: "orcamento" });
        continue;
      }
      if ((await duePriority(task)) === null) {
        results.push({ task: task.key, ok: true, skipped: "em_dia" });
        continue;
      }
      results.push(await runTask(task));
    }
    // Reserva: se o job dos pesados não rodou na última meia hora (job parado ou
    // ainda não criado), o refresh volta a puxar até 2 pesados com a sobra.
    if (!(await heavyJobRecentlyRan())) results.push(...(await runHeavyTasks(HEAVY_REFRESH_TASKS, started, JOB_BUDGET_MS, MAX_HEAVY_PER_CYCLE)));
    return { ok: results.every((item) => item.ok), ms: Date.now() - started, results };
  } finally {
    await releaseLock(LOCK_NAME);
  }
}

// Roda os pesados vencidos, do mais atrasado para o menos, até o orçamento.
async function runHeavyTasks(tasks, started, startBudgetMs, maxTasks = Infinity) {
  const priorities = await Promise.all(tasks.map((task) => duePriority(task).catch(() => Infinity)));
  const due = tasks.map((task, index) => ({ task, priority: priorities[index] })).filter((item) => item.priority !== null).sort((a, b) => b.priority - a.priority);
  const results = [];
  let ran = 0;
  for (const { task } of due) {
    if (Date.now() - started > startBudgetMs || ran >= maxTasks) {
      results.push({ task: task.key, ok: true, skipped: ran >= maxTasks ? "proximo_ciclo" : "orcamento" });
      continue;
    }
    ran += 1;
    results.push(await runTask(task));
  }
  return results;
}

async function heavyJobRecentlyRan() {
  const entry = await readCache(`lock:${HEAVY_LOCK_NAME}`, 30).catch(() => null);
  if (!entry) return false;
  const lastRun = new Date(entry.updatedAt || 0).getTime();
  return Number.isFinite(lastRun) && Date.now() - lastRun < 30 * 60 * 1000;
}

// Job dos pesados (?mode=heavy). Trava própria: não espera o refresh de hoje.
export async function runHeavyRefresh(tasks = HEAVY_REFRESH_TASKS) {
  if (!(await acquireLock(HEAVY_LOCK_NAME, 120))) return { skipped: "ja_em_execucao" };
  const started = Date.now();
  try {
    const results = await runHeavyTasks(tasks, started, HEAVY_START_BUDGET_MS);
    return { ok: results.every((item) => item.ok), ms: Date.now() - started, results };
  } finally {
    await releaseLock(HEAVY_LOCK_NAME);
  }
}

// Retrato do estoque: clientes por status, por grupo da tela Clientes e total.
export async function runStockSnapshot(date = getTodayInSaoPaulo()) {
  const counts = await fetchStatusCounts();
  const rows = [
    { date, metric: "clientes_total", dimensionType: "team", dimensionKey: "all", valueNum: counts.total },
    ...Object.entries(counts.byStatus).map(([status, total]) => ({ date, metric: "clientes_por_status", dimensionType: "status", dimensionKey: status, valueNum: total })),
    ...Object.entries(counts.byGroup).map(([group, total]) => ({ date, metric: "clientes_por_grupo", dimensionType: "stage", dimensionKey: group, valueNum: total }))
  ];
  // Pendências do dia (lidas do cache da Meta Diária; sem cálculo novo).
  const pend = await readPendencias();
  rows.push(...pendenciasRows(date, pend?.payload));
  const { written } = await upsertSnapshots(rows, "cron");
  return { date, written };
}

// Fechamento do dia anterior (depois do daily-goal-close das 00:01): grava as
// métricas de EVENTOS (clientes novos, prospecção, vendas, aprovações, pontos,
// Meta) com as mesmas funções das telas.
export async function runCloseSnapshot(date = addDaysToPlainDate(getTodayInSaoPaulo(), -1)) {
  const [overview, goal] = await Promise.all([withBudget(computeOverview("ontem"), TASK_BUDGET_MS), withBudget(computeTeamGoal("ontem"), TASK_BUDGET_MS)]);
  const { written } = await upsertSnapshots(closeRows(date, overview, goal), "cron");
  return { date, written };
}
