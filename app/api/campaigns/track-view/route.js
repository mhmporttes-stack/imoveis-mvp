import { NextResponse } from "next/server";
import { canManageCampaigns, recordCampaignLinkView, recordOfficialLinkViewByRef } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Rota PÚBLICA (sem auth) — chamada pelo próprio link quando um visitante
// anônimo abre /simulacao?c=<id> (campanha) ou /simulacao?ref=<ref> (link
// pessoal/oficial de corretor/gestor/admin), só para contar a abertura.
// Nunca falha de forma visível para o visitante: best-effort, sempre 204.
export async function POST(request) {
  if (!canManageCampaigns()) return new NextResponse(null, { status: 204 });

  try {
    const payload = await request.json();
    if (payload?.campaignId) await recordCampaignLinkView(payload.campaignId);
    else if (payload?.ref) await recordOfficialLinkViewByRef(payload.ref);
  } catch {
    // silencioso — ver comentário acima.
  }

  return new NextResponse(null, { status: 204 });
}
