import { NextResponse } from "next/server";
import { canManageCampaigns, recordCampaignLinkView } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Rota PÚBLICA (sem auth) — chamada pelo próprio link de campanha quando um
// visitante anônimo abre /simulacao?c=<id>, só para contar a abertura. Nunca
// falha de forma visível para o visitante: best-effort, sempre 204.
export async function POST(request) {
  if (!canManageCampaigns()) return new NextResponse(null, { status: 204 });

  try {
    const payload = await request.json();
    await recordCampaignLinkView(payload?.campaignId);
  } catch {
    // silencioso — ver comentário acima.
  }

  return new NextResponse(null, { status: 204 });
}
