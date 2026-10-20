import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { getMarketplaceGroups, saveMarketplaceGroups } from "@/lib/marketplace-listings";
import { MarketplaceInputError } from "@/lib/marketplace-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Grupos do Facebook marcados em "Anunciar nos seus grupos" (dono, 2026-10-20) — só o administrador geral edita.
export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ groups: await getMarketplaceGroups() });
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar os grupos." }, { status: 500 });
  }
}

export async function PUT(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  try {
    return NextResponse.json({ groups: await saveMarketplaceGroups(body.groups, auth) });
  } catch (error) {
    const status = error instanceof MarketplaceInputError ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? error.message : "Não foi possível salvar os grupos." }, { status });
  }
}
