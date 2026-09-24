import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getChatConversation, updateChatConversationStatus } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const before = new URL(request.url).searchParams.get("before") || "";
    return NextResponse.json(await getChatConversation((await params).id, { before }, auth));
  } catch (error) {
    return chatErrorResponse(error);
  }
}

export async function PATCH(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    await updateChatConversationStatus((await params).id, body?.status, auth);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
