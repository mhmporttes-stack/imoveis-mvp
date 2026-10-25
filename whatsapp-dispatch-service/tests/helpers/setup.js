// Infraestrutura dos testes de integração: Postgres e Redis REAIS (docker compose dev ou TEST_DATABASE_URL/TEST_REDIS_URL).
// Banco próprio de teste (wa_dispatch_test), recriado a cada arquivo; Redis no db 1, limpo a cada arquivo.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import IORedis from "ioredis";
import { loadConfig } from "../../src/config/index.js";
import { createContext } from "../../src/context.js";
import { migrate } from "../../scripts/migrate.js";
import { createLogger } from "../../src/utils/logger.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function dotenv() {
  const file = join(root, ".env");
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
}

export function testUrls() {
  const env = dotenv();
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL || `postgres://wa_dispatch:${env.POSTGRES_PASSWORD}@127.0.0.1:55432/wa_dispatch`;
  const dbUrl = process.env.TEST_DATABASE_URL || adminUrl.replace(/\/wa_dispatch$/, "/wa_dispatch_test");
  const redisUrl = process.env.TEST_REDIS_URL || `redis://:${env.REDIS_PASSWORD}@127.0.0.1:56379/1`;
  return { adminUrl, dbUrl, redisUrl };
}

export const TOKENS = {
  crm: "crm-token-de-teste-0123456789abcdef0123",
  admin: "admin-token-de-teste-0123456789abcdef01",
  viewer: "viewer-token-de-teste-0123456789abcdef0"
};

export async function resetInfra() {
  const { adminUrl, dbUrl, redisUrl } = testUrls();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query("drop database if exists wa_dispatch_test with (force)");
  await admin.query("create database wa_dispatch_test");
  await admin.end();
  await migrate(dbUrl, { log: () => {} });
  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();
  // Tabelas mínimas do CRM (mesmos nomes/colunas lidos pelo verificador crm-db) num schema de teste.
  await db.query(`
    create schema crm_fixture;
    create table crm_fixture.simulation_registrations (id uuid primary key, phone_normalized text not null, status text not null default 'pending', created_at timestamptz not null default now());
    create table crm_fixture.prospecting_contacts (id uuid primary key default gen_random_uuid(), phone_normalized text not null unique, status text not null);
    create table crm_fixture.admin_users (id uuid primary key default gen_random_uuid(), phone text, status text not null default 'active');
    create table crm_fixture.whatsapp_individual_sessions (user_id uuid, phone_number text, known_phone_numbers text[] not null default '{}');
  `);
  await db.end();
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1 });
  await redis.flushdb();
  redis.disconnect();
  return { dbUrl, redisUrl };
}

export function testConfig(overrides = {}) {
  const { dbUrl, redisUrl } = testUrls();
  return loadConfig({
    DATABASE_URL: dbUrl,
    REDIS_URL: redisUrl,
    QUEUE_PREFIX: `wa-test-${process.pid}`,
    CRM_API_TOKEN: TOKENS.crm,
    ADMIN_API_TOKEN: TOKENS.admin,
    READONLY_API_TOKEN: TOKENS.viewer,
    CRM_DB_SCHEMA: "crm_fixture",
    WA_APP_SECRET: "segredo-de-teste-do-app",
    WA_WEBHOOK_VERIFY_TOKEN: "verify-token-de-teste",
    WA_APP_ID: "123456789",
    WA_GRAPH_BASE_URL: "https://graph.mock.invalid",
    RETRY_BASE_DELAY_MS: "1000",
    RETRY_MAX_DELAY_MS: "10000",
    SEND_TIMEOUT_MS: "300",
    RATE_LIMIT_PER_MINUTE: "10000",
    LOG_LEVEL: "silent",
    ...overrides
  });
}

export function testContext({ config = testConfig(), fetchImpl, withQueue = true, env = { WA_TOKEN_TESTE: "token-mock" } } = {}) {
  return createContext({ config, logger: createLogger("silent"), fetchImpl, withQueue, env });
}

export async function addCrmRegistration(ctx, { id = crypto.randomUUID(), national, status = "pending" }) {
  await ctx.db.query(`insert into crm_fixture.simulation_registrations (id, phone_normalized, status) values ($1,$2,$3)`, [id, national, status]);
  return id;
}

export const ALWAYS_OPEN = { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59" };
