import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dataDir = join(process.cwd(), "data");
const dbPath = join(dataDir, "imoveis.sqlite");

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

function createDatabase() {
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
  if (!globalThis.__matheusMachadoDb) {
    globalThis.__matheusMachadoDb = createDatabase();
  }
  return globalThis.__matheusMachadoDb;
}

export { dataDir, dbPath };
