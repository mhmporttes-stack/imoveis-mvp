import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getChatOlderHistoryStatus, requestChatOlderHistory } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Carregar mensagens anteriores do celular" (só WhatsApp pessoal conectado; mesmo escopo de quem abre a conversa).
// Corpo opcional { continueFrom }: id do pedido anterior (rodadas até 15 dias, 2026-10-12).
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    const continueFrom = typeof body?.continueFrom === "string" ? body.continueFrom : "";
    return NextResponse.json(await requestChatOlderHistory((await params).id, auth, { continueFrom }));
  } catch (error) {
    return chatErrorResponse(error);
  }
}

// Andamento do pedido (?requestId=): contagens e horários, sem conteúdo.
export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const requestId = new URL(request.url).searchParams.get("requestId") || "";
    return NextResponse.json(await getChatOlderHistoryStatus((await params).id, auth, requestId));
  } catch (error) {
    return chatErrorResponse(error);
  }
}
