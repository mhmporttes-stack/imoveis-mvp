import { NextResponse } from "next/server";
import { verifyIndividualServiceSecret } from "@/lib/whatsapp-individual";
import { createIndividualInboundUploadTarget } from "@/lib/whatsapp-media";

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
