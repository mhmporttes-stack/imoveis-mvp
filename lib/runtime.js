export const canUseLocalDatabase =
  process.env.ENABLE_SQLITE === "true" ||
  (process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1");

