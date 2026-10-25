import { z } from "zod";

// Toda configuração vem de variáveis de ambiente (nomes documentados em .env.example / README).
// Segredos nunca são logados: logger.js redige os campos sensíveis.
const bool = (fallback) =>
  z.preprocess((v) => (v === undefined || v === "" ? fallback : ["1", "true", "yes", "on"].includes(String(v).toLowerCase())), z.boolean());
const int = (fallback, min = 0) => z.preprocess((v) => (v === undefined || v === "" ? fallback : Number(v)), z.number().int().min(min));
const list = (fallback = "") =>
  z.preprocess((v) => String(v ?? fallback).split(",").map((s) => s.trim()).filter(Boolean), z.array(z.string()));
const optional = () => z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  LOG_LEVEL: z.string().default("info"),
  PORT: int(3031, 1),
  DATABASE_URL: optional(),
  DATABASE_SSL: bool(false),
  DATABASE_POOL_MAX: int(10, 1),
  REDIS_URL: optional(),
  QUEUE_PREFIX: z.string().default("wa-dispatch"),
  CRM_API_TOKEN: optional(),
  ADMIN_API_TOKEN: optional(),
  READONLY_API_TOKEN: optional(),
  CORS_ALLOWED_ORIGINS: list(),
  RATE_LIMIT_PER_MINUTE: int(120, 1),
  WORKER_CONCURRENCY: int(2, 1),
  SCHEDULER_INTERVAL_MS: int(5000, 200),
  SCHEDULER_BATCH_SIZE: int(50, 1),
  RETRY_BASE_DELAY_MS: int(60000, 0),
  RETRY_MAX_DELAY_MS: int(3600000, 0),
  MAX_SEND_ATTEMPTS: int(5, 1),
  SEND_TIMEOUT_MS: int(15000, 100),
  SENDING_LOCK_MS: int(120000, 1000),
  UNKNOWN_VERIFICATION_WINDOW_MS: int(1800000, 0),
  INSTANCE_HEALTH_INTERVAL_MS: int(300000, 1000),
  WA_GRAPH_BASE_URL: z.string().default("https://graph.facebook.com"),
  WA_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),
  WA_APP_ID: optional(),
  WA_APP_SECRET: optional(),
  WA_WEBHOOK_VERIFY_TOKEN: optional(),
  WA_CLOUD_ACCESS_TOKEN: optional(),
  WHATSAPP_INDIVIDUAL_SERVICE_URL: optional(),
  WHATSAPP_INDIVIDUAL_SERVICE_SECRET: optional(),
  CONSENT_VERIFIER: z.enum(["crm-db", "crm-http"]).default("crm-db"),
  CRM_DATABASE_URL: optional(),
  CRM_DB_SCHEMA: z.string().regex(/^[a-z_][a-z0-9_]*$/).default("public"),
  CONSENT_CRM_ACCEPTED_PURPOSES: list("retorno_simulacao"),
  CRM_CONSENT_VERIFY_URL: optional(),
  CRM_CONSENT_VERIFY_TOKEN: optional(),
  CONSENT_VERIFY_TIMEOUT_MS: int(5000, 100),
  OPT_OUT_KEYWORDS: list("PARAR,PARE,SAIR,STOP,CANCELAR,DESCADASTRAR"),
  DEFAULT_COUNTRY_CODE: z.string().regex(/^\d{1,3}$/).default("55")
});

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configuração inválida: ${fields}`);
  }
  const config = parsed.data;
  if (!config.CRM_DATABASE_URL) config.CRM_DATABASE_URL = config.DATABASE_URL;
  return Object.freeze(config);
}

// Leitura pontual de segredo pelo NOME guardado no banco (credential_ref). Só nomes no padrão permitido.
export function readCredential(name, env = process.env) {
  if (!name || !/^[A-Z][A-Z0-9_]{2,80}$/.test(name)) return "";
  return String(env[name] || "");
}
