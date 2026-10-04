import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { notifyTelemetry } from "./webhook.js";

// Telemetria de conexão do WhatsApp individual: UMA linha por fato (tentativa,
// conexão, queda, ciclo, interrupção), SEM deduplicação — é o que permite
// responder "quantas vezes esta sessão tentou reconectar e em qual intervalo".
// Vai em lote para o CRM (app/api/webhooks/whatsapp-individual/telemetry) pelo
// mesmo canal e segredo do webhook de status.
//
// Segurança: só entram campos de uma lista fixa (abaixo), com valores curtos.
// NUNCA credenciais, chaves, conteúdo de mensagem nem número de telefone — o
// identificador da sessão é o id interno do corretor. Falha de telemetria nunca
// derruba a sessão: tudo aqui é best-effort e engole erro.

const SAFE_TOKEN = /[^A-Za-z0-9_.:-]/g;
const token = (value, max = 64) => (value === undefined || value === null || value === "" ? null : String(value).replace(SAFE_TOKEN, "").slice(0, max) || null);
const int = (value) => (Number.isFinite(Number(value)) && value !== null && value !== undefined && value !== "" ? Math.trunc(Number(value)) : null);

export function readBaileysVersion() {
  try {
    const require = createRequire(import.meta.url);
    return token(require("@whiskeysockets/baileys/package.json").version) || "unknown";
  } catch {
    return "unknown";
  }
}

export function createTelemetry({
  send = notifyTelemetry,
  now = Date.now,
  env = process.env,
  baileysVersion = readBaileysVersion(),
  bootId = randomUUID(),
  flushMs = 5000,
  maxBatch = 50,
  maxQueue = 500,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  const context = {
    bootId,
    baileysVersion,
    deployId: token(env.RAILWAY_DEPLOYMENT_ID),
    commitSha: token(env.RAILWAY_GIT_COMMIT_SHA, 40),
    waVersion: null,
    waVersionIsLatest: null
  };
  let queue = [];
  let timer = null;

  async function flush() {
    if (timer) { clearTimer(timer); timer = null; }
    while (queue.length) {
      const batch = queue.slice(0, maxBatch);
      queue = queue.slice(batch.length);
      try { await send(batch); } catch (error) { console.error("Falha ao enviar telemetria de sessão:", error?.message || error); }
    }
  }

  function schedule() {
    if (timer) return;
    timer = setTimer(() => { timer = null; flush().catch(() => {}); }, flushMs);
    timer?.unref?.();
  }

  return {
    context,
    get queued() { return queue.length; },

    // Versão do protocolo WA Web usada nas próximas conexões (resultado de fetchLatestBaileysVersion).
    setWaVersion(version, isLatest) {
      context.waVersion = Array.isArray(version) ? version.join(".") : token(version);
      context.waVersionIsLatest = typeof isLatest === "boolean" ? isLatest : null;
    },

    // userId = id interno do corretor (null só para eventos do serviço, como o boot).
    record(userId, type, fields = {}) {
      try {
        const event = {
          userId: userId || null,
          type: token(type, 40),
          occurredAt: new Date(now()).toISOString(),
          bootId: context.bootId,
          deployId: context.deployId,
          commitSha: context.commitSha,
          baileysVersion: context.baileysVersion,
          waVersion: context.waVersion,
          waVersionIsLatest: context.waVersionIsLatest,
          cycleId: token(fields.cycleId),
          attempt: int(fields.attempt),
          nextAttempt: int(fields.nextAttempt),
          statusCode: int(fields.statusCode),
          reason: token(fields.reason),
          kind: token(fields.kind, 24),
          trigger: token(fields.trigger, 24),
          delayMs: int(fields.delayMs),
          connectedMs: int(fields.connectedMs),
          maxRetries: int(fields.maxRetries),
          detail: token(fields.detail, 40)
        };
        if (!event.type) return;
        queue.push(event);
        if (queue.length > maxQueue) queue.splice(0, queue.length - maxQueue);
        if (queue.length >= maxBatch) flush().catch(() => {});
        else schedule();
      } catch (error) {
        console.error("Falha ao registrar telemetria de sessão:", error?.message || error);
      }
    },

    flush
  };
}

export const telemetry = createTelemetry();
