import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { getProperty } from "@/lib/properties";
import { buildBrokerSimulationLink } from "@/lib/admin-profiles";
import { getAllowedPhotoHosts } from "@/lib/marketplace-listings";
import { buildDraftFromProperty } from "@/lib/marketplace-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Rascunho do anúncio a partir de um imóvel/empreendimento do CRM (fotos públicas, preço, descrição + link da
// simulação do próprio admin). Não grava nada.
export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const propertyId = new URL(request.url).searchParams.get("propertyId") || "";
  if (!propertyId || propertyId.length > 80) return NextResponse.json({ error: "Imóvel inválido." }, { status: 400 });
  try {
    const property = await getProperty(propertyId);
    if (!property) return NextResponse.json({ error: "Imóvel não encontrado." }, { status: 404 });
    const draft = buildDraftFromProperty(property, { simulationLink: buildBrokerSimulationLink(auth.profile), allowedHosts: getAllowedPhotoHosts() });
    return NextResponse.json({ draft });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível montar o rascunho." }, { status: 500 });
  }
}
