import { loadConfig } from "./config/index.js";
import { createContext } from "./context.js";
import { createApp } from "./app.js";
import { startSendWorker } from "./workers/send-worker.js";
import { startScheduler } from "./scheduler/index.js";
import { logger } from "./utils/logger.js";

// Papéis: --role=api | worker | scheduler | all (padrão). Em produção, um processo por papel (docker-compose.yml).
const role = (process.argv.find((a) => a.startsWith("--role=")) || "--role=all").split("=")[1];
if (!["api", "worker", "scheduler", "all"].includes(role)) {
  logger.fatal({ role }, "papel inválido");
  process.exit(1);
}

const config = loadConfig();
if (config.PORT !== 3031) logger.warn({ port: config.PORT }, "PORT diferente de 3031 (porta exigida pela especificação)");
const ctx = createContext({ config, logger });
const closers = [];

if (role === "api" || role === "all") {
  const server = createApp(ctx).listen(config.PORT, () => logger.info({ port: config.PORT, role }, "API ouvindo"));
  server.on("error", (error) => {
    logger.fatal({ err: error.message, port: config.PORT }, "não foi possível abrir a porta");
    process.exit(1);
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  closers.push(() => new Promise((resolve) => server.close(resolve)));
}
if (role === "worker" || role === "all") {
  if (!config.REDIS_URL) throw new Error("REDIS_URL é obrigatória para o worker.");
  const w = startSendWorker(ctx, { redisUrl: config.REDIS_URL, prefix: config.QUEUE_PREFIX, concurrency: config.WORKER_CONCURRENCY });
  closers.push(() => w.close());
  logger.info({ concurrency: config.WORKER_CONCURRENCY }, "worker iniciado");
}
if (role === "scheduler" || role === "all") {
  const s = startScheduler(ctx);
  closers.push(() => s.close());
  logger.info({ intervalMs: config.SCHEDULER_INTERVAL_MS }, "agendador iniciado");
}

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, "encerrando");
  for (const close of closers.reverse()) await close().catch(() => {});
  await ctx.close();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (error) => logger.error({ err: String(error?.message || error) }, "promessa rejeitada sem tratamento"));
