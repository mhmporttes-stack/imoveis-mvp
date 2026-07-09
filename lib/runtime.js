export const isVercel = process.env.VERCEL === "1";

export const canUseLocalDatabase =
  !isVercel &&
  (process.env.ENABLE_SQLITE === "true" || process.env.NODE_ENV !== "production");

export function isLocalDatabaseDisabled() {
  return isVercel || !canUseLocalDatabase;
}
