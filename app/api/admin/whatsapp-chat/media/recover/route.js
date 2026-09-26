import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { recoverInboundMedia } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Recupera mídias recebidas (áudio, imagem, documento, vídeo) que ainda estão só como placeholder (gestão/administrador).
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json(await recoverInboundMedia(auth));
  } catch (error) {
    return chatErrorResponse(error);
  }
}
