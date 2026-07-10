export const isVercel = process.env.VERCEL === "1";

export const canUseLocalDatabase =
  !isVercel && process.env.ENABLE_SQLITE !== "false";

export function isLocalDatabaseDisabled() {
  return isVercel || !canUseLocalDatabase;
}
