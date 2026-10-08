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
    // assign: false — abrir a conversa pelo card nunca muda atendente/status.
    // slot (opcional, 2026-10-08): Número 1 ou 2 do WhatsApp do responsável; sem ele, a conversa que já existe.
    return NextResponse.json(await openChatForClient(String(body.clientId), auth, { assign: false, slot: body.slot ?? null }));
  } catch (error) {
    return chatErrorResponse(error);
  }
}
