import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { assignChatConversation } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Assumir a conversa (sem corpo), atribuir a outra pessoa ({ userId }, só
// gestor/admin) ou liberar ({ userId: null }).
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    const userId = Object.prototype.hasOwnProperty.call(body || {}, "userId") ? body.userId : undefined;
    const result = await assignChatConversation((await params).id, userId, auth);
    return NextResponse.json({ ok: true, transferred: Boolean(result?.transferred) });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
