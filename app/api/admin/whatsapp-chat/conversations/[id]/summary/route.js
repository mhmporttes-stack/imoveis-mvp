import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { summarizeChatConversation } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Resumo da conversa por IA (2026-10-10): sob demanda; { force: true } refaz mesmo sem mensagem nova.
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await summarizeChatConversation((await params).id, auth, { force: body?.force === true }));
  } catch (error) {
    return chatErrorResponse(error);
  }
}
