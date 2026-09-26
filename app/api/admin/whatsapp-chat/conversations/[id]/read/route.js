import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { markChatConversationRead } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const result = await markChatConversationRead((await params).id, auth);
    return NextResponse.json({ ok: true, marked: result?.marked !== false });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
