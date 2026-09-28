import { NextResponse } from "next/server";
import { applyIndividualSessionStatus, verifyIndividualServiceSecret } from "@/lib/whatsapp-individual";
import { projectIndividualHistoryBatch, projectIndividualInboundMessage } from "@/lib/whatsapp-individual-inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Recebe do microsserviço whatsapp-individual-service/ (sessão pessoal de
// WhatsApp de cada corretor, via Baileys): mensagem nova (type:'message') ou
// mudança de status/QR da sessão (type:'status'). Autenticado por
// X-Service-Secret (nunca por cookie/sessão do CRM — não é o navegador quem chama).
export async function POST(request) {
  const secretHeader = request.headers.get("x-service-secret");
  if (!verifyIndividualServiceSecret(secretHeader)) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const userId = String(payload?.userId || "").trim();
  if (!userId) return NextResponse.json({ error: "userId não informado." }, { status: 400 });

  try {
    if (payload.type === "status") {
      await applyIndividualSessionStatus(userId, {
        status: payload.status,
        phoneNumber: payload.phoneNumber,
        qrData: payload.qr,
        qrExpiresAt: payload.qrExpiresAt,
        error: payload.error
      });
      return NextResponse.json({ ok: true });
    }

    if (payload.type === "message") {
      const result = await projectIndividualInboundMessage({
        userId,
        from: payload.from,
        text: payload.text,
        waMessageId: payload.waMessageId,
        at: payload.at,
        contactName: payload.contactName,
        fromMe: Boolean(payload.fromMe)
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (payload.type === "history") {
      const result = await projectIndividualHistoryBatch(userId, Array.isArray(payload.items) ? payload.items : []);
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ ok: true, ignored: "unknown_type" });
  } catch (error) {
    console.error("Erro no webhook do WhatsApp individual:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível processar o evento." }, { status: 500 });
  }
}
