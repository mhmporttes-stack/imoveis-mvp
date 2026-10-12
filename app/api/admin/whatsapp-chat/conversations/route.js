import { NextResponse, after } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listChatConversations } from "@/lib/whatsapp-chat";
import { refreshContactPhotos } from "@/lib/whatsapp-contact-photo";
import { chatErrorResponse } from "../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const params = new URL(request.url).searchParams;
  try {
    const conversations = await listChatConversations({
      filter: params.get("filter") || "all",
      query: params.get("q") || "",
      before: params.get("before") || "",
      brokerId: params.get("brokerId") || "",
      clientStatus: params.get("clientStatus") || "",
      // Pré-carregamento em segundo plano (AdminWarmup): sem recibo "entregue" e sem buscar fotos agora.
      warm: params.get("warm") === "1"
    }, auth);
    // Foto do cliente (2026-10-09): busca em segundo plano as que faltam/estão velhas (poucas por vez).
    if (params.get("warm") !== "1") after(() => refreshContactPhotos(conversations.map((item) => item.id)).catch(() => {}));
    return NextResponse.json({ conversations });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
