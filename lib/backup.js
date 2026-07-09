import { canUseLocalDatabase, isLocalDatabaseDisabled, isVercel } from "./runtime";

export async function ensureDailyBackup() {
  if (isVercel || isLocalDatabaseDisabled() || !canUseLocalDatabase) return null;

  const { getDataPaths, getDb } = await import("./db");
  const paths = getDataPaths();
  if (!paths) return null;

  const { existsSync, mkdirSync } = process.getBuiltinModule("node:fs");
  const backupDir = `${paths.dataDir}/backups`;
  if (!existsSync(paths.dbPath)) return null;
  mkdirSync(backupDir, { recursive: true });
  const file = `${backupDir}/imoveis-${new Date().toISOString().slice(0, 10)}.sqlite`;
  if (!existsSync(file)) {
    getDb().exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  }
  return file;
}
