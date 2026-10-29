import { NextResponse } from "next/server";
import { authenticateExtensionToken } from "@/lib/browser-extensions";
import { buildRateLimitKey, checkPublicRateLimit } from "@/lib/rate-limit";

// Rotas das extensões do dono (EXT-1): limite por IP + chave pessoal de cada extensão no Bearer (mkp_… Marketplace,
// igs_… Seguidor do Instagram). Devolve { ext, version } ou { response } (erro).
export async function authenticateExtensionRequest(request, discriminator, maxAttempts) {
  const allowed = await checkPublicRateLimit(buildRateLimitKey(request, discriminator), { windowSeconds: 60, maxAttempts });
  if (!allowed) return { response: NextResponse.json({ error: "Muitas tentativas." }, { status: 429 }) };
  const header = String(request.headers.get("authorization") || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const ext = token ? await authenticateExtensionToken(token).catch(() => "") : "";
  if (!ext) return { response: NextResponse.json({ error: "Não autorizado." }, { status: 401 }) };
  return { ext, version: String(request.headers.get("x-extension-version") || "").slice(0, 20) };
}
