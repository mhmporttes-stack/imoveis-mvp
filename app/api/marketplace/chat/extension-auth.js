import { NextResponse } from "next/server";
import { verifyPublisherToken } from "@/lib/marketplace-listings";
import { readBearerToken } from "@/lib/marketplace-core.mjs";
import { buildRateLimitKey, checkPublicRateLimit } from "@/lib/rate-limit";

// Rotas da extensão do Chat do Marketplace (MKT-2): mesma chave pessoal da publicação (Bearer mkp_…) + limite por IP.
// Devolve uma resposta de erro, ou null quando pode seguir.
export async function rejectExtensionRequest(request, discriminator) {
  const allowed = await checkPublicRateLimit(buildRateLimitKey(request, discriminator), { windowSeconds: 60, maxAttempts: 20 });
  if (!allowed) return NextResponse.json({ error: "Muitas tentativas." }, { status: 429 });
  const token = readBearerToken(request.headers.get("authorization"));
  if (!token || !(await verifyPublisherToken(token).catch(() => false))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return null;
}
