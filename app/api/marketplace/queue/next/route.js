import { NextResponse } from "next/server";
import { claimNextMarketplaceListing, verifyPublisherToken } from "@/lib/marketplace-listings";
import { readBearerToken } from "@/lib/marketplace-core.mjs";
import { buildRateLimitKey, checkPublicRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Extensão do Chrome do dono (MKT-1): entrega 1 anúncio APROVADO e marca "claimed". Autenticação só pela chave
// pessoal (Authorization: Bearer mkp_...). Resposta contém só os campos do anúncio.
export async function GET(request) {
  const allowed = await checkPublicRateLimit(buildRateLimitKey(request, "marketplace-queue"), { windowSeconds: 60, maxAttempts: 10 });
  if (!allowed) return NextResponse.json({ error: "Muitas tentativas." }, { status: 429 });

  const token = readBearerToken(request.headers.get("authorization"));
  if (!token || !(await verifyPublisherToken(token).catch(() => false))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const result = await claimNextMarketplaceListing();
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar a fila." }, { status: 500 });
  }
}
