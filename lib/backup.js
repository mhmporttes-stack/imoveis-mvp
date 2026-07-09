import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir, dbPath, getDb } from "./db";

const backupDir = join(dataDir, "backups");

export function ensureDailyBackup() {
  if (!existsSync(dbPath)) return null;
  mkdirSync(backupDir, { recursive: true });
  const file = join(backupDir, `imoveis-${new Date().toISOString().slice(0, 10)}.sqlite`);
  if (!existsSync(file)) {
    getDb().exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  }
  return file;
}
