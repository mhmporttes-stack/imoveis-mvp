import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { linkChatConversationToClient } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Vincular a cliente" (2026-10-10): liga a conversa a um cadastro existente que o usuário pode ver.
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await linkChatConversationToClient((await params).id, body?.clientId, auth));
  } catch (error) {
    return chatErrorResponse(error);
  }
}
