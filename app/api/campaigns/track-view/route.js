import { NextResponse } from "next/server";
import { canManageCampaigns, getCampaign, recordCampaignLinkView, recordOfficialLinkViewByRef } from "@/lib/campaigns";
import { createRateLimiter } from "@/lib/simulation-presentation-core.mjs";
import { recordSmsLinkClickSafe, resolveSmsContact } from "@/lib/sms-batch-links";
import { smsContactView } from "@/lib/sms-batch-contact-core.mjs";

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
// Formulário curto do SMS (PRO-18h, dono 2026-11-03): com `smsToken` que resolve a um contato da base, a resposta leva também
// `smsContact: { firstName, phoneDisplay }` — SÓ o 1º nome e o telefone mascarado, nunca nome completo nem telefone inteiro
// (o token é fraco). Token inválido/desconhecido/sem nome confiável: sem `smsContact` e o formulário é o de sempre.
// Limite por IP (em memória, por instância): quem exceder não conta a abertura e recebe a jornada padrão — não infla as métricas.
const allowView = createRateLimiter({ limit: 30, windowMs: 60_000 });

export async function POST(request) {
  if (!canManageCampaigns()) return NextResponse.json({ linkJourney: "choice" });
  const visitor = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "anon";
  if (!allowView(visitor)) return NextResponse.json({ linkJourney: "choice" });

  let linkJourney = "choice";
  let smsContact = null;
  try {
    const payload = await request.json();
    if (payload?.campaignId) {
      await recordCampaignLinkView(payload.campaignId);
      // Lote de SMS (PRO-18f): clique do link único do contato. Melhor esforço, mesmo limite por IP; token inválido = nada.
      if (payload.smsToken) {
        await recordSmsLinkClickSafe(payload.smsToken);
        smsContact = smsContactView(await resolveSmsContact(payload.smsToken));
      }
      const campaign = await getCampaign(payload.campaignId);
      if (campaign?.linkJourney) linkJourney = campaign.linkJourney;
    } else if (payload?.ref) {
      await recordOfficialLinkViewByRef(payload.ref);
    }
  } catch {
    // silencioso — ver comentário acima, nunca deve quebrar a experiência do visitante.
  }

  return NextResponse.json(smsContact ? { linkJourney, smsContact } : { linkJourney });
}
