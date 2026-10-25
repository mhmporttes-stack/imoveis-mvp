import pg from "pg";
import { createDb } from "./repositories/db.js";
import { createAdapterRegistry } from "./whatsapp/adapter.js";
import { createCrmDbConsentVerifier } from "./services/consent/crm-db-verifier.js";
import { createCrmHttpConsentVerifier } from "./services/consent/crm-http-verifier.js";
import { createSendQueue } from "./queue/index.js";
import { logger as defaultLogger } from "./utils/logger.js";

// Monta as dependências compartilhadas (API, worker e agendador usam o mesmo contexto).
export function createContext({ config, logger = defaultLogger, fetchImpl = globalThis.fetch, withQueue = true, env = process.env }) {
  const db = createDb({ url: config.DATABASE_URL, ssl: config.DATABASE_SSL, max: config.DATABASE_POOL_MAX });
  let crmPool = null;
  let consent;
  if (config.CONSENT_VERIFIER === "crm-http") {
    consent = createCrmHttpConsentVerifier({
      url: config.CRM_CONSENT_VERIFY_URL, token: config.CRM_CONSENT_VERIFY_TOKEN, timeoutMs: config.CONSENT_VERIFY_TIMEOUT_MS, fetchImpl
    });
  } else {
    crmPool = config.CRM_DATABASE_URL
      ? new pg.Pool({
        connectionString: config.CRM_DATABASE_URL, max: 3, ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
        application_name: "whatsapp-dispatch-service:consent-readonly", connectionTimeoutMillis: 5000, statement_timeout: config.CONSENT_VERIFY_TIMEOUT_MS
      })
      : null;
    crmPool?.on("error", () => {});
    consent = createCrmDbConsentVerifier({ pool: crmPool, schema: config.CRM_DB_SCHEMA, acceptedPurposes: config.CONSENT_CRM_ACCEPTED_PURPOSES });
  }
  const queue = withQueue && config.REDIS_URL ? createSendQueue({ redisUrl: config.REDIS_URL, prefix: config.QUEUE_PREFIX }) : null;
  const ctx = {
    config, logger, db, consent, queue,
    adapters: createAdapterRegistry({ config, fetchImpl, env }),
    now: () => new Date(),
    async close() {
      await queue?.close();
      await crmPool?.end().catch(() => {});
      await db.close().catch(() => {});
    }
  };
  return ctx;
}
