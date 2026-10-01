import "server-only";
import { acquireLock, markCacheError, releaseLock, writeCache } from "./cache";
import { fetchStatusCounts } from "./funnel-stock";
import { upsertSnapshots } from "./snapshots";
import { addDaysToPlainDate, getTodayInSaoPaulo } from "../daily-report";

// Jobs de métricas (chamados pelo pg_cron via /api/cron/crm-snapshots).
//   refresh = atualiza o cache recente (tarefas pesadas, uma por vez);
//   stock   = retrato diário do ESTOQUE do dia (23:55 de Brasília);
//   close   = ajuste do dia anterior depois do fechamento da Meta (00:10).
// Cada tarefa tem orçamento de tempo e falha isolada: o último valor bom
// continua no cache. Logs só com nome da tarefa e tipo do erro.

const LOCK_NAME = "crm-refresh";
const TASK_BUDGET_MS = 25000;

function withBudget(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const REFRESH_TASKS = [
  {
    key: "funil_estoque",
    cacheKey: "funil:estoque",
    run: async () => ({ ...(await fetchStatusCounts()), capturedAt: new Date().toISOString() })
  }
];

async function runTask(task) {
  const started = Date.now();
  try {
    const payload = await withBudget(task.run(), TASK_BUDGET_MS);
    await writeCache(task.cacheKey, payload, { computeMs: Date.now() - started });
    return { task: task.key, ok: true, ms: Date.now() - started };
  } catch (error) {
    const code = error?.message === "timeout" ? "timeout" : error?.name || "erro";
    console.warn(`[crm-metrics] tarefa ${task.key} falhou: ${code}.`);
    await markCacheError(task.cacheKey, code);
    return { task: task.key, ok: false, ms: Date.now() - started, error: code };
  }
}

export async function runRefresh(tasks = REFRESH_TASKS) {
  if (!(await acquireLock(LOCK_NAME, 120))) return { skipped: "ja_em_execucao" };
  const started = Date.now();
  try {
    const results = [];
    for (const task of tasks) results.push(await runTask(task));
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
  const { written } = await upsertSnapshots(rows, "cron");
  return { date, written };
}

// Ajuste do dia anterior (depois do daily-goal-close das 00:01). As métricas
// baseadas em eventos entram aqui nas próximas etapas.
export async function runCloseSnapshot(date = addDaysToPlainDate(getTodayInSaoPaulo(), -1)) {
  return { date, written: 0 };
}
