import { NextResponse } from "next/server";
import { verifyIndividualServiceSecret } from "@/lib/whatsapp-individual";
import { runLeaseAction } from "@/lib/whatsapp-service-lease";
import { parseLeaseRequest } from "@/lib/whatsapp-service-lease-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

// Lease (dono único das sessões) do whatsapp-individual-service/ (src/lease.js): acquire/renew/release.
// Autenticado por X-Service-Secret (nunca por cookie/sessão do CRM). Só mexe em whatsapp_service_lease.
// 503 + unavailable:true = migration 20261004213000 ainda não aplicada (o serviço segue sem lease).
export async function POST(request) {
  if (!verifyIndividualServiceSecret(request.headers.get("x-service-secret"))) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const parsed = parseLeaseRequest(payload);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const outcome = await runLeaseAction(parsed);
    if (outcome.unavailable) {
      return NextResponse.json({ error: "Lease indisponível (tabela/função não encontrada).", unavailable: true, reason: outcome.reason }, { status: 503 });
    }
    return NextResponse.json({ ok: true, action: parsed.action, ...outcome.result });
  } catch (error) {
    console.error("Erro no lease do WhatsApp individual:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível processar o lease." }, { status: 500 });
  }
}
