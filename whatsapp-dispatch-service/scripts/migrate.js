import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Aplica migrations/*.sql em ordem (nome YYYYMMDDHHMMSS_descricao.sql) e registra em wa_dispatch.schema_migrations.
// Uso: DATABASE_URL=... node scripts/migrate.js   (ou: npm run migrate)
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function migrate(databaseUrl, { ssl = false, log = console.log } = {}) {
  if (!databaseUrl) throw new Error("DATABASE_URL não configurada.");
  const client = new pg.Client({ connectionString: databaseUrl, ssl: ssl ? { rejectUnauthorized: true } : undefined });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock(704519230)");
    await client.query("create schema if not exists wa_dispatch");
    await client.query(`create table if not exists wa_dispatch.schema_migrations (version text primary key, applied_at timestamptz not null default now())`);
    await client.query("alter table wa_dispatch.schema_migrations enable row level security");
    const files = (await readdir(dir)).filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f)).sort();
    const { rows } = await client.query("select version from wa_dispatch.schema_migrations");
    const done = new Set(rows.map((r) => r.version));
    const applied = [];
    for (const file of files) {
      const version = file.slice(0, 14);
      if (done.has(version)) continue;
      const sql = await readFile(join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into wa_dispatch.schema_migrations (version) values ($1)", [version]);
        await client.query("commit");
        applied.push(file);
        log(`aplicada: ${file}`);
      } catch (error) {
        await client.query("rollback");
        throw new Error(`falha em ${file}: ${error.message}`);
      }
    }
    if (!applied.length) log("nenhuma migração pendente");
    return applied;
  } finally {
    await client.query("select pg_advisory_unlock(704519230)").catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate(process.env.DATABASE_URL, { ssl: ["1", "true"].includes(String(process.env.DATABASE_SSL).toLowerCase()) })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
