import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { recordAdminHeartbeat } from "@/lib/admin-presence";
import { sendChatTemplate } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Envia um modelo aprovado (abre/reabre a conversa fora da janela de 24h).
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    const message = await sendChatTemplate((await params).id, { templateId: body?.templateId, params: body?.params }, auth);
    await recordAdminHeartbeat(auth, { grace: true }).catch(() => {});
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
