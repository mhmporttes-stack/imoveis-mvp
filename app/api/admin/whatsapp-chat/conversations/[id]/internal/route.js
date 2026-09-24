import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { sendChatInternalMessage } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mensagem INTERNA do Chat: fica só no CRM (nunca chega ao WhatsApp do cliente nem chama a Meta).
// Permissão validada no backend (responsável, gestão ou administrador).
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    const message = await sendChatInternalMessage((await params).id, body?.text, auth);
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
