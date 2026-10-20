import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { createMarketplaceListing, getPublisherStatus, listMarketplaceListings } from "@/lib/marketplace-listings";
import { MarketplaceInputError } from "@/lib/marketplace-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Publicador do Marketplace (MKT-1): só o admin geral.
export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const [list, publisher] = await Promise.all([listMarketplaceListings(), getPublisherStatus()]);
    return NextResponse.json({ ...list, publisher });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível carregar os anúncios." }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
    return NextResponse.json({ listing: await createMarketplaceListing(body, auth) });
  } catch (error) {
    const status = error instanceof MarketplaceInputError ? 400 : 500;
    return NextResponse.json({ error: error?.message || "Não foi possível salvar o anúncio." }, { status });
  }
}
