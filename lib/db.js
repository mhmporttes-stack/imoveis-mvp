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
      region TEXT DEFAULT '',
      status TEXT DEFAULT '',
      type TEXT DEFAULT 'apartamento',
      price TEXT DEFAULT '',
      terms TEXT DEFAULT '',
      discounts TEXT DEFAULT '',
      installment_entry TEXT DEFAULT '',
      delivery TEXT DEFAULT '',
      area TEXT DEFAULT '',
      bedrooms TEXT DEFAULT '',
      features_json TEXT DEFAULT '[]',
      photos_json TEXT DEFAULT '[]',
      pdf_name TEXT DEFAULT '',
      pdf_data TEXT DEFAULT '',
      builder_url TEXT DEFAULT '',
      whatsapp TEXT DEFAULT '',
      instagram TEXT DEFAULT '',
      internal_notes TEXT DEFAULT '',
      sales_text TEXT DEFAULT '',
      is_published INTEGER NOT NULL DEFAULT 1,
      is_featured INTEGER NOT NULL DEFAULT 0,
      display_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  ensureLocalColumns(database);
  return database;
}

function ensureLocalColumns(database) {
  const existingColumns = new Set(
    database.prepare("PRAGMA table_info(properties)").all().map((column) => column.name)
  );

  const columns = [
    ["region", "TEXT DEFAULT ''"],
    ["status", "TEXT DEFAULT ''"],
    ["features_json", "TEXT DEFAULT '[]'"],
    ["is_published", "INTEGER NOT NULL DEFAULT 1"],
    ["is_featured", "INTEGER NOT NULL DEFAULT 0"],
    ["display_order", "INTEGER DEFAULT 0"]
  ];

  for (const [name, definition] of columns) {
    if (!existingColumns.has(name)) {
      database.exec(`ALTER TABLE properties ADD COLUMN ${name} ${definition}`);
    }
  }
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
