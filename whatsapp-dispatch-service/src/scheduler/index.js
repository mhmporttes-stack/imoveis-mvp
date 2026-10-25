import { authorizeRequested, assignInstances, requeueQueued, recoverStaleSending, verifyUnknown } from "../services/dispatch.js";
import { processOnboardings } from "../services/onboarding.js";
import { healthCheckAll } from "../services/instances.js";
import { sanitizeText } from "../utils/logger.js";

// Agendador: um único ativo por banco (pg_try_advisory_lock). Respeita limites, disponibilidade, horários e envios
// anteriores; nunca cria envio para "preencher cota" — só distribui trabalhos já autorizados.
const LOCK_KEY = 704519231; // constante do serviço para o advisory lock

export async function runSchedulerTick(ctx, { includeHealth = false } = {}) {
  const result = {};
  const steps = [
    ["recovered_sending", () => recoverStaleSending(ctx)],
    ["authorized", () => authorizeRequested(ctx)],
    ["assigned", () => assignInstances(ctx)],
    ["requeued", () => requeueQueued(ctx)],
    ["unknown_checked", () => verifyUnknown(ctx)],
    ["onboarding", () => processOnboardings(ctx)]
  ];
  if (includeHealth) steps.push(["health", async () => (await healthCheckAll(ctx)).length]);
  for (const [name, fn] of steps) {
    try {
      result[name] = await fn();
    } catch (error) {
      result[name] = `erro: ${sanitizeText(error?.message, 200)}`;
      ctx.logger.error({ step: name, err: sanitizeText(error?.message) }, "falha numa etapa do agendador");
    }
  }
  return result;
}

export function startScheduler(ctx) {
  let stopped = false;
  let timer = null;
  let lockClient = null;
  let lastHealth = 0;

  async function ensureLock() {
    if (lockClient) return true;
    const client = await ctx.db.pool.connect();
    const { rows } = await client.query("select pg_try_advisory_lock($1) as ok", [LOCK_KEY]);
    if (rows[0].ok) {
      lockClient = client;
      client.on("error", () => { lockClient = null; });
      ctx.logger.info("agendador ativo (lock obtido)");
      return true;
    }
    client.release();
    return false;
  }

  async function loop() {
    if (stopped) return;
    try {
      if (await ensureLock()) {
        const includeHealth = Date.now() - lastHealth >= ctx.config.INSTANCE_HEALTH_INTERVAL_MS;
        if (includeHealth) lastHealth = Date.now();
        const r = await runSchedulerTick(ctx, { includeHealth });
        if (Object.values(r).some((v) => v)) ctx.logger.debug({ tick: r }, "ciclo do agendador");
      }
    } catch (error) {
      ctx.logger.error({ err: sanitizeText(error?.message) }, "ciclo do agendador falhou");
      if (lockClient) { lockClient.release(true); lockClient = null; }
    }
    if (!stopped) timer = setTimeout(loop, ctx.config.SCHEDULER_INTERVAL_MS);
  }
  timer = setTimeout(loop, 0);

  return {
    async close() {
      stopped = true;
      clearTimeout(timer);
      if (lockClient) {
        await lockClient.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
        lockClient.release();
        lockClient = null;
      }
    }
  };
}
