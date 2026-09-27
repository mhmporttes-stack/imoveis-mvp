import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { sendChatReaction } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    const reaction = await sendChatReaction((await params).id, body?.messageId, body?.emoji, auth);
    return NextResponse.json({ reaction }, { status: 201 });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
