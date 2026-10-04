// Poller local da Central de Comando (fase 1). Sem IA, sem tokens: com a fila vazia so faz uma chamada barata.
// Sem porta aberta: apenas conexoes de saida. Encerramento limpo com SIGINT/SIGTERM.
// Instancia unica por usuario (trava com PID em %USERPROFILE%\.central-bridge.poller.lock; ver poller-lock.mjs e poller-ctl.mjs).
import { existsSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { acquireLock, defaultLockPath, describeRunning, EXIT_CODE_ALREADY_RUNNING, releaseLock, resolveHeartbeatMs, stopRequestPath, touchLock } from "./poller-lock.mjs";
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

// Os parametros existem para teste (config/cliente/exit falsos); em producao usa os padroes.
export async function main({
  loadConfigFn = loadConfig,
  createClient = createHttpClient,
  selectExec = selectExecutor,
  lockPath = defaultLockPath(),
  lockDeps = {},
  heartbeatMs = resolveHeartbeatMs(),
  argv = process.argv,
  exit = (code) => process.exit(code),
  installHandlers = true
} = {}) {
  const config = loadConfigFn();
  if (!config.executorSecret) {
    console.error("CENTRAL_EXECUTOR_SECRET ausente (veja docs/CENTRAL_PONTE.md).");
    exit(1);
    return;
  }
  // Trava de instancia unica (por usuario). Antes de qualquer consulta a fila.
  const lock = acquireLock(lockPath, lockDeps);
  if (!lock.ok) {
    console.error(`${describeRunning(lock.running)}. Nao iniciei outra. Use: node scripts\\central-bridge\\poller-ctl.mjs status|stop`);
    exit(EXIT_CODE_ALREADY_RUNNING);
    return;
  }
  let token = lock.token;
  const releaseOnExit = () => releaseLock(lockPath, token);
  if (installHandlers) process.once("exit", releaseOnExit); // cobre exit normal, process.exit e excecao nao tratada
  let beat = null;
  try {
    rmStopRequest(lockPath); // pedido de parada velho nao vale para esta instancia
    const client = createClient({ baseUrl: config.baseUrl, secret: config.executorSecret, workerId: config.workerId });
    const executor = selectExec({ ...config, log: defaultLog });
    const once = argv.includes("--once");
    let stopping = false;
    let wake = null;
    const stop = (sig) => {
      defaultLog(`${sig}: encerrando apos a tarefa atual`);
      stopping = true;
      wake?.();
    };
    if (installHandlers) {
      process.on("SIGINT", () => stop("SIGINT"));
      process.on("SIGTERM", () => stop("SIGTERM"));
    }
    // Batimento da trava + pedido de parada graciosa (poller-ctl stop). Nao segura o processo vivo.
    beat = setInterval(() => {
      try {
        if (!stopping && consumeStopRequest(lockPath)) return stop("STOP");
        const st = touchLock(lockPath, token, lockDeps);
        if (st === "foreign") return stop("trava assumida por outra instancia");
        if (st === "missing") {
          const again = acquireLock(lockPath, lockDeps);
          if (again.ok) token = again.token;
          else stop("trava perdida");
        }
      } catch (e) {
        defaultLog(`batimento da trava falhou: ${String(e?.message || e).slice(0, 120)}`);
      }
    }, heartbeatMs);
    beat.unref?.();

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
        setTimeout(resolve, config.pollSeconds * 1000); // sem unref: e este timer que mantem o processo vivo
      });
      wake = null;
    }
    defaultLog("poller encerrado");
  } finally {
    if (beat) clearInterval(beat);
    releaseOnExit();
  }
}

function rmStopRequest(lockPath) {
  try {
    unlinkSync(stopRequestPath(lockPath));
  } catch {
    // nao existe: normal
  }
}

function consumeStopRequest(lockPath) {
  if (!existsSync(stopRequestPath(lockPath))) return false;
  rmStopRequest(lockPath);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
