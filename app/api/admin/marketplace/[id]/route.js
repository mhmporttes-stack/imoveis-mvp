import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { applyMarketplaceAction, updateMarketplaceListing } from "@/lib/marketplace-listings";
import { MarketplaceInputError } from "@/lib/marketplace-core.mjs";
import { isUuid } from "@/lib/short-links.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH { action: "approve" | "unapprove" | "cancel" | "mark_published", url? } ou { listing: {...} } (edição; tira a aprovação se o conteúdo mudar).
export async function PATCH(request, { params }) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Anúncio inválido." }, { status: 400 });
  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
    const listing = body.action ? await applyMarketplaceAction(id, body.action, auth, { url: body.url }) : await updateMarketplaceListing(id, body.listing || {});
    return NextResponse.json({ listing });
  } catch (error) {
    const status = error instanceof MarketplaceInputError ? 400 : 500;
    return NextResponse.json({ error: error?.message || "Não foi possível atualizar o anúncio." }, { status });
  }
}
