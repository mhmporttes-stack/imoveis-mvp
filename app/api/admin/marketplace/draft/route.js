import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { getProperty } from "@/lib/properties";
import { buildBrokerSimulationLink } from "@/lib/admin-profiles";
import { getAllowedPhotoHosts, importPropertyPhotosForMarketplace } from "@/lib/marketplace-listings";
import { buildDraftFromProperty } from "@/lib/marketplace-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Rascunho do anúncio a partir de um imóvel/empreendimento do CRM (todas as fotos como links públicos do CRM —
// base64/links de fora são copiados para o armazenamento —, preço, descrição + link da simulação do próprio admin).
// Não grava o anúncio; só as cópias das fotos.
export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const propertyId = new URL(request.url).searchParams.get("propertyId") || "";
  if (!propertyId || propertyId.length > 80) return NextResponse.json({ error: "Imóvel inválido." }, { status: 400 });
  try {
    const property = await getProperty(propertyId);
    if (!property) return NextResponse.json({ error: "Imóvel não encontrado." }, { status: 404 });
    const { photoUrls, problems } = await importPropertyPhotosForMarketplace(property);
    const draft = buildDraftFromProperty(property, { simulationLink: buildBrokerSimulationLink(auth.profile), allowedHosts: getAllowedPhotoHosts(), importedPhotoUrls: photoUrls });
    return NextResponse.json({ draft, photoProblems: problems });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível montar o rascunho." }, { status: 500 });
  }
}
