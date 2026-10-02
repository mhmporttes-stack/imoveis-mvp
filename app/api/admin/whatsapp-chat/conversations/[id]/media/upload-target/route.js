import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { createChatMediaUploadTarget } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Arquivo grande (vídeo até 16 MB): devolve uma URL assinada para o navegador
// enviar DIRETO ao storage; depois o envio é pedido em POST .../media (JSON).
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    const target = await createChatMediaUploadTarget((await params).id, { mimeType: body?.mimeType, fileName: body?.fileName, size: body?.size }, auth);
    return NextResponse.json(target);
  } catch (error) {
    return chatErrorResponse(error);
  }
}
