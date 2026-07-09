import { canUseLocalDatabase, isLocalDatabaseDisabled, isVercel } from "./runtime";

let cachedPaths = null;

export function getDataPaths() {
  if (isVercel) return null;
  if (!cachedPaths) {
    const dataDir = `${process.cwd()}/data`;
    cachedPaths = {
      dataDir,
      dbPath: `${dataDir}/imoveis.sqlite`
    };
  }
  return cachedPaths;
}

function createDatabase() {
  if (isLocalDatabaseDisabled()) {
    throw new Error("SQLite local desativado neste ambiente.");
  }
  const paths = getDataPaths();
  const { existsSync, mkdirSync } = process.getBuiltinModule("node:fs");
  if (!existsSync(paths.dataDir)) {
    mkdirSync(paths.dataDir, { recursive: true });
  }
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const database = new DatabaseSync(paths.dbPath);
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
  if (isVercel) return null;
  if (!canUseLocalDatabase) {
    throw new Error("SQLite local desativado neste ambiente.");
  }
  if (!globalThis.__matheusMachadoDb) {
    globalThis.__matheusMachadoDb = createDatabase();
  }
  return globalThis.__matheusMachadoDb;
}
