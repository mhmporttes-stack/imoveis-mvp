import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { recordAdminHeartbeat } from "@/lib/admin-presence";
import { sendChatMessage } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  // `code` (ex.: WHATSAPP_PRINTED_LIST_MODE, PRO-15) deixa a tela de simulação seguir para o WhatsApp do celular/Web.
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    const message = await sendChatMessage((await params).id, body?.text, auth, body?.replyToMessageId);
    await recordAdminHeartbeat(auth, { grace: true }).catch(() => {});
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
