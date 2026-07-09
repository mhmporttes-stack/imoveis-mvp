import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { canUseLocalDatabase } from "./runtime";

const require = createRequire(import.meta.url);
const dataDir = join(process.cwd(), "data");
const dbPath = join(dataDir, "imoveis.sqlite");

function createDatabase() {
  if (!canUseLocalDatabase) {
    throw new Error("SQLite local desativado neste ambiente.");
  }
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(dbPath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS properties (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      builder TEXT DEFAULT '',
      location TEXT DEFAULT '',
      type TEXT DEFAULT 'apartamento',
      price TEXT DEFAULT '',
      terms TEXT DEFAULT '',
      discounts TEXT DEFAULT '',
      installment_entry TEXT DEFAULT '',
      delivery TEXT DEFAULT '',
      area TEXT DEFAULT '',
      bedrooms TEXT DEFAULT '',
      photos_json TEXT DEFAULT '[]',
      pdf_name TEXT DEFAULT '',
      pdf_data TEXT DEFAULT '',
      builder_url TEXT DEFAULT '',
      whatsapp TEXT DEFAULT '',
      instagram TEXT DEFAULT '',
      internal_notes TEXT DEFAULT '',
      sales_text TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  return database;
}

export function getDb() {
  if (!canUseLocalDatabase) {
    throw new Error("SQLite local desativado neste ambiente.");
  }
  if (!globalThis.__matheusMachadoDb) {
    globalThis.__matheusMachadoDb = createDatabase();
  }
  return globalThis.__matheusMachadoDb;
}

export { dataDir, dbPath };
