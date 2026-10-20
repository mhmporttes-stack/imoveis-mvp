import { NextResponse } from "next/server";
import { reportMarketplaceResult, verifyPublisherToken } from "@/lib/marketplace-listings";
import { MarketplaceInputError, readBearerToken } from "@/lib/marketplace-core.mjs";
import { buildRateLimitKey, checkPublicRateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/short-links.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Retorno da extensão: { status: "published", url } ou { status: "failed", error, retry }.
export async function POST(request, { params }) {
  const allowed = await checkPublicRateLimit(buildRateLimitKey(request, "marketplace-result"), { windowSeconds: 60, maxAttempts: 10 });
  if (!allowed) return NextResponse.json({ error: "Muitas tentativas." }, { status: 429 });

  const token = readBearerToken(request.headers.get("authorization"));
  if (!token || !(await verifyPublisherToken(token).catch(() => false))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Anúncio inválido." }, { status: 400 });
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });

  try {
    const result = await reportMarketplaceResult(id, body);
    return NextResponse.json({ ok: true, status: result.status });
  } catch (error) {
    if (error instanceof MarketplaceInputError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "Não foi possível registrar o resultado." }, { status: 500 });
  }
}
