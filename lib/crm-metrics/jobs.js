import "server-only";
import { acquireLock, markCacheError, readCache, releaseLock, writeCache } from "./cache";
import { fetchStatusCounts } from "./funnel-stock";
import { upsertSnapshots } from "./snapshots";
import { computePendencias, computeTeamGoal, rangeKeyFor, readPendencias } from "./team-goal";
import { closeRows, pendenciasRows } from "./snapshot-rows-core.mjs";
import { computeOverview } from "./overview";
import { addDaysToPlainDate, getTodayInSaoPaulo } from "../daily-report";

// Jobs de métricas (chamados pelo pg_cron via /api/cron/crm-snapshots).
//   refresh = atualiza o cache recente (tarefas pesadas, uma por vez);
//   stock   = retrato diário do ESTOQUE do dia (23:55 de Brasília);
//   close   = ajuste do dia anterior depois do fechamento da Meta (00:10).
// Cada tarefa tem orçamento de tempo e falha isolada: o último valor bom
// continua no cache. Logs só com nome da tarefa e tipo do erro.

const LOCK_NAME = "crm-refresh";
const TASK_BUDGET_MS = 25000;
const MAX_HEAVY_PER_CYCLE = 2;
const JOB_BUDGET_MS = 38000; // não começa tarefa nova depois disso (o cron espera até 50 s)

function withBudget(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// everyMinutes: só recalcula se o cache estiver mais velho que isso.
// rangeKeyOf: período FECHADO — recalcula quando a data de referência muda.
// heavy: no máximo DUAS tarefas pesadas extras por ciclo (além das de hoje).
export const REFRESH_TASKS = [
  {
    key: "funil_estoque",
    cacheKey: "funil:estoque",
    run: async () => ({ ...(await fetchStatusCounts()), capturedAt: new Date().toISOString() })
  },
  { key: "meta_hoje", cacheKey: "meta:hoje", run: () => computeTeamGoal("hoje") },
  { key: "pendencias_hoje", cacheKey: "pendencias:hoje", run: () => computePendencias() },
  { key: "overview_hoje", cacheKey: "overview:hoje", run: () => computeOverview("hoje") },
  { key: "meta_ontem", cacheKey: "meta:ontem", everyMinutes: 120, heavy: true, run: () => computeTeamGoal("ontem") },
  { key: "meta_esta_semana", cacheKey: "meta:esta_semana", everyMinutes: 30, heavy: true, run: () => computeTeamGoal("esta_semana") },
  { key: "meta_este_mes", cacheKey: "meta:este_mes", everyMinutes: 30, heavy: true, run: () => computeTeamGoal("este_mes") },
  { key: "meta_semana_passada", cacheKey: "meta:semana_passada", rangeKeyOf: () => rangeKeyFor("semana_passada"), heavy: true, run: () => computeTeamGoal("semana_passada") },
  { key: "meta_mes_passado", cacheKey: "meta:mes_passado", rangeKeyOf: () => rangeKeyFor("mes_passado"), heavy: true, run: () => computeTeamGoal("mes_passado") },
  { key: "overview_ontem", cacheKey: "overview:ontem", everyMinutes: 120, heavy: true, run: () => computeOverview("ontem") },
  { key: "overview_esta_semana", cacheKey: "overview:esta_semana", everyMinutes: 30, heavy: true, run: () => computeOverview("esta_semana") },
  { key: "overview_este_mes", cacheKey: "overview:este_mes", everyMinutes: 30, heavy: true, run: () => computeOverview("este_mes") },
  { key: "overview_semana_passada", cacheKey: "overview:semana_passada", rangeKeyOf: () => rangeKeyFor("semana_passada"), heavy: true, run: () => computeOverview("semana_passada") },
  { key: "overview_mes_passado", cacheKey: "overview:mes_passado", rangeKeyOf: () => rangeKeyFor("mes_passado"), heavy: true, run: () => computeOverview("mes_passado") }
];

async function isDue(task) {
  if (!task.everyMinutes && !task.rangeKeyOf) return true;
  const entry = await readCache(task.cacheKey, task.everyMinutes || 100000);
  if (!entry || entry.status === "error") return true;
  if (task.rangeKeyOf) return entry.payload?.rangeKey !== task.rangeKeyOf();
  return (entry.ageMinutes ?? 99999) >= task.everyMinutes;
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
    let heavyRan = 0;
    for (const task of tasks) {
      if (Date.now() - started > JOB_BUDGET_MS) {
        results.push({ task: task.key, ok: true, skipped: "orcamento" });
        continue;
      }
      if (task.heavy && heavyRan >= MAX_HEAVY_PER_CYCLE) {
        results.push({ task: task.key, ok: true, skipped: "proximo_ciclo" });
        continue;
      }
      if (!(await isDue(task))) {
        results.push({ task: task.key, ok: true, skipped: "em_dia" });
        continue;
      }
      if (task.heavy) heavyRan += 1;
      results.push(await runTask(task));
    }
    return { ok: results.every((item) => item.ok), ms: Date.now() - started, results };
  } finally {
    await releaseLock(LOCK_NAME);
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
