import { Queue } from "bullmq";
import IORedis from "ioredis";

// Fila BullMQ (Redis). O Postgres é a fonte de verdade do estado de cada trabalho; a fila só transporta o id.
// jobId = id da mensagem → adicionar de novo o mesmo trabalho não duplica (recuperação após queda do Redis).
export const SEND_QUEUE = "wa-dispatch-send";

export function createRedisConnection(url, { forWorker = false } = {}) {
  if (!url) throw new Error("REDIS_URL não configurada.");
  return new IORedis(url, {
    // Worker precisa de null (bloqueante). Produtor falha rápido quando o Redis cai (sem fila offline em memória).
    maxRetriesPerRequest: forWorker ? null : 1,
    enableOfflineQueue: forWorker,
    connectTimeout: 5000,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 500, 5000)
  });
}

export function createSendQueue({ redisUrl, prefix }) {
  const connection = createRedisConnection(redisUrl);
  connection.on("error", () => {}); // estado aparece no /ready; sem derrubar o processo
  const queue = new Queue(SEND_QUEUE, {
    connection,
    prefix,
    defaultJobOptions: {
      attempts: 1, // retentativas são decididas no Postgres (backoff persistente), não pela fila
      removeOnComplete: { age: 3600, count: 10000 },
      removeOnFail: { age: 7 * 24 * 3600 }
    }
  });
  queue.on("error", () => {});
  return {
    queue,
    connection,
    async addSend(messageId) {
      await withTimeout(queue.add("send", { messageId }, { jobId: messageId }), 3000, "Redis indisponível (tempo esgotado ao enfileirar)");
    },
    async ping() {
      return (await withTimeout(connection.ping(), 1000, "Redis sem resposta")) === "PONG";
    },
    async counts() {
      return withTimeout(queue.getJobCounts("waiting", "active", "delayed", "failed", "completed"), 2000, "Redis sem resposta");
    },
    async close() {
      await queue.close().catch(() => {});
      connection.disconnect();
    }
  };
}

export function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
  ]).finally(() => clearTimeout(timer));
}
