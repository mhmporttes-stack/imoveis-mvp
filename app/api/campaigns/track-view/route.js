import { NextResponse } from "next/server";
import { canManageCampaigns, getCampaign, recordCampaignLinkView, recordOfficialLinkViewByRef } from "@/lib/campaigns";
import { createRateLimiter } from "@/lib/simulation-presentation-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Rota PÚBLICA (sem auth) — chamada pelo próprio link quando um visitante
// anônimo abre /simulacao?c=<id> (campanha) ou /simulacao?ref=<ref> (link
// pessoal/oficial de corretor/gestor/admin), só para contar a abertura.
// Nunca falha de forma visível para o visitante: best-effort.
//
// Além de contar o clique, devolve `linkJourney` (item 15 do "Disparo") —
// LinkJourneyGate usa isso para pular a tela de escolha quando a campanha
// (ex.: criada pelo Disparo) já define diretamente Atendimento Rápido ou
// Simulação. Link pessoal (?ref=) nunca tem essa configuração — sempre
// "choice", preservando o comportamento atual.
// Limite por IP (em memória, por instância): quem exceder não conta a abertura e recebe a jornada padrão — não infla as métricas.
const allowView = createRateLimiter({ limit: 30, windowMs: 60_000 });

export async function POST(request) {
  if (!canManageCampaigns()) return NextResponse.json({ linkJourney: "choice" });
  const visitor = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "anon";
  if (!allowView(visitor)) return NextResponse.json({ linkJourney: "choice" });

  let linkJourney = "choice";
  try {
    const payload = await request.json();
    if (payload?.campaignId) {
      await recordCampaignLinkView(payload.campaignId);
      const campaign = await getCampaign(payload.campaignId);
      if (campaign?.linkJourney) linkJourney = campaign.linkJourney;
    } else if (payload?.ref) {
      await recordOfficialLinkViewByRef(payload.ref);
    }
  } catch {
    // silencioso — ver comentário acima, nunca deve quebrar a experiência do visitante.
  }

  return NextResponse.json({ linkJourney });
}
