// Poller local da Central de Comando (fase 1). Sem IA, sem tokens: com a fila vazia so faz uma chamada barata.
// Sem porta aberta: apenas conexoes de saida. Encerramento limpo com SIGINT/SIGTERM.
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { createHttpClient } from "./client.mjs";
import { selectExecutor } from "./executors/index.mjs";

const stamp = () => new Date().toISOString().slice(11, 19);
export const defaultLog = (msg) => console.log(`[${stamp()}] ${msg}`);

// Processa no maximo UMA tarefa. Retorna "idle" | "done" | "error" | "lease_lost".
export async function runOnce({ client, executor, log = defaultLog, heartbeatMs = 40000 }) {
  const task = await client.claim();
  if (!task) return "idle";
  log(`tarefa ${task.task_id} recebida (tipo ${task.tipo})`);
  const timer = setInterval(() => client.renew(task.task_id).catch(() => {}), heartbeatMs);
  timer.unref?.();
  try {
    let outcome;
    try {
      const resultado = await executor.execute(task);
      outcome = { status: "CONCLUIDA", resultado: String(resultado ?? "") };
    } catch (e) {
      outcome = { status: "ERRO", erro: String(e?.message || "falha na execucao").slice(0, 300) };
    }
    const saved = await client.complete(task.task_id, outcome);
    if (!saved) {
      log(`tarefa ${task.task_id}: lease perdido, resultado descartado`);
      return "lease_lost";
    }
    log(`tarefa ${task.task_id}: ${outcome.status}`);
    return outcome.status === "ERRO" ? "error" : "done";
  } finally {
    clearInterval(timer);
  }
}

export async function main() {
  const config = loadConfig();
  if (!config.executorSecret) {
    console.error("CENTRAL_EXECUTOR_SECRET ausente (veja docs/CENTRAL_PONTE.md).");
    process.exit(1);
  }
  const client = createHttpClient({ baseUrl: config.baseUrl, secret: config.executorSecret, workerId: config.workerId });
  const executor = selectExecutor(config);
  const once = process.argv.includes("--once");
  let stopping = false;
  let wake = null;
  const stop = (sig) => {
    defaultLog(`${sig}: encerrando apos a tarefa atual`);
    stopping = true;
    wake?.();
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  defaultLog(`poller iniciado (worker ${config.workerId}, executor ${executor.name}, a cada ${config.pollSeconds}s)`);
  try {
    const n = await client.requeue();
    if (n) defaultLog(`${n} tarefa(s) propria(s) com lease expirado devolvida(s) a fila`);
  } catch (e) {
    defaultLog(`requeue falhou: ${e.message}`);
  }
  while (!stopping) {
    let result = "error";
    try {
      result = await runOnce({ client, executor });
    } catch (e) {
      defaultLog(`erro: ${String(e?.message || e).slice(0, 200)}`);
    }
    if (stopping || (once && result === "idle")) break;
    if (result !== "idle" && result !== "error") continue; // pode haver mais tarefas na fila
    await new Promise((resolve) => {
      wake = resolve;
      setTimeout(resolve, config.pollSeconds * 1000).unref?.();
    });
    wake = null;
  }
  defaultLog("poller encerrado");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
