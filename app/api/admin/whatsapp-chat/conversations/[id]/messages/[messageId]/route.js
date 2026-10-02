import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { recordAdminHeartbeat } from "@/lib/admin-presence";
import { deleteChatMessageForEveryone, editChatMessage } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Editar (PATCH {text}) e "apagar para todos" (DELETE) uma mensagem enviada
// pela equipe pelo WhatsApp individual. Quem pode e até quando: decidido no
// servidor (lib/whatsapp-message-actions.mjs), igual em celular, app e navegador.
export async function PATCH(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id, messageId } = await params;
    const body = await request.json().catch(() => ({}));
    const message = await editChatMessage(id, messageId, body?.text, auth);
    await recordAdminHeartbeat(auth, { grace: true }).catch(() => {});
    return NextResponse.json({ message });
  } catch (error) {
    return chatErrorResponse(error);
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id, messageId } = await params;
    const message = await deleteChatMessageForEveryone(id, messageId, auth);
    await recordAdminHeartbeat(auth, { grace: true }).catch(() => {});
    return NextResponse.json({ message });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
