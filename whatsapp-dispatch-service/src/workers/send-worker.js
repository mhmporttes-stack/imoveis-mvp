import { Worker } from "bullmq";
import { hostname } from "node:os";
import { createRedisConnection, SEND_QUEUE } from "../queue/index.js";
import { processMessage } from "../services/dispatch.js";
import { sanitizeText } from "../utils/logger.js";

// Worker de envio. Concorrência configurável (WORKER_CONCURRENCY). Toda decisão de estado está no Postgres:
// trabalho repetido/entregue duas vezes pela fila é ignorado (processMessage só age em status 'queued').
export function startSendWorker(ctx, { redisUrl, prefix, concurrency }) {
  const connection = createRedisConnection(redisUrl, { forWorker: true });
  connection.on("error", () => {});
  const workerId = `${hostname()}:${process.pid}`;
  const worker = new Worker(
    SEND_QUEUE,
    async (job) => processMessage(ctx, job.data.messageId, workerId),
    { connection, prefix, concurrency, lockDuration: Math.max(30000, ctx.config.SEND_TIMEOUT_MS * 2) }
  );
  worker.on("failed", (job, error) => ctx.logger.error({ jobId: job?.id, err: sanitizeText(error?.message) }, "trabalho falhou no worker"));
  worker.on("error", (error) => ctx.logger.warn({ err: sanitizeText(error?.message) }, "worker: erro de conexão"));
  return {
    worker,
    async close() {
      await worker.close().catch(() => {});
      connection.disconnect();
    }
  };
}
