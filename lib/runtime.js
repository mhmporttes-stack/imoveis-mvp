// "Servidor de produção gerenciado": na Vercel (VERCEL=1) ou no servidor próprio do dono (MM_PRODUCTION_HOST=1, 2026-11-08, ver
// servidor-local/GUIA-PC.md). Nos dois casos não há banco SQLite local e os cookies do painel são sempre "secure" (HTTPS).
export const isVercel = process.env.VERCEL === "1" || process.env.MM_PRODUCTION_HOST === "1";

// Requisição por HTTPS (direta ou atrás de túnel/proxy que avisa em x-forwarded-proto) ou servidor de produção.
export function isSecureRequest(request) {
  return request?.nextUrl?.protocol === "https:" || request?.headers?.get?.("x-forwarded-proto") === "https" || isVercel;
}

export const canUseLocalDatabase =
  !isVercel && process.env.ENABLE_SQLITE !== "false";

export function isLocalDatabaseDisabled() {
  return isVercel || !canUseLocalDatabase;
}
