import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listChatConversationMedia } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Mídia, links e docs" da conversa (2026-10-11): mesma checagem de acesso da conversa.
export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json(await listChatConversationMedia((await params).id, auth));
  } catch (error) {
    return chatErrorResponse(error);
  }
}
