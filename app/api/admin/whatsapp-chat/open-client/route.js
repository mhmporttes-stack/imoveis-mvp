import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { openChatForClient } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Botão "WhatsApp" dos cards de cliente: abre (ou cria) a conversa do cliente
// no número oficial. Respeita o escopo do usuário (corretor só abre os seus).
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    if (!body?.clientId) return NextResponse.json({ error: "Informe o cliente." }, { status: 400 });
    return NextResponse.json(await openChatForClient(String(body.clientId), auth));
  } catch (error) {
    return chatErrorResponse(error);
  }
}
