import { NextResponse } from "next/server";
import { verifyIndividualServiceSecret } from "@/lib/whatsapp-individual";
import { createIndividualInboundUploadTarget } from "@/lib/whatsapp-media";
import { isGroupRemoved } from "@/lib/whatsapp-individual-inbound";
import { parseSessionId } from "@/lib/whatsapp-session-slots.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

// Só o microsserviço whatsapp-individual-service/ (X-Service-Secret): URL de
// upload assinada, para UM arquivo, no bucket privado de mídias do Chat.
export async function POST(request) {
  if (!verifyIndividualServiceSecret(request.headers.get("x-service-secret"))) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }
  try {
    const body = await request.json();
    // Grupo removido do Chat pelo dono (2026-10-11): não guarda mais nenhuma mídia dele.
    const session = body?.group ? parseSessionId(String(body?.userId || "")) : null;
    if (session && await isGroupRemoved({ userId: session.userId, sessionSlot: session.slot, groupKey: body.group })) {
      return NextResponse.json({ error: "Grupo removido do Chat." }, { status: 409 });
    }
    const target = await createIndividualInboundUploadTarget({
      userId: body?.userId,
      waMessageId: body?.waMessageId,
      mime: body?.mime,
      kind: body?.kind
    });
    return NextResponse.json(target);
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Falha ao preparar a mídia." }, { status: 400 });
  }
}
