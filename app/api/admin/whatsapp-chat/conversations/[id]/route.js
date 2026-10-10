import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { deleteChatConversation, getChatConversation, renameChatContact, setChatConversationPrivate, setChatConversationResolved, updateChatConversationStatus } from "@/lib/whatsapp-chat";
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
    // Particular (2026-10-09): { private: true|false } marca/desmarca a conversa como contato pessoal.
    // Nome do contato (2026-10-09): { contactName } corrige o nome (e o do cliente vinculado).
    if (typeof body?.contactName === "string") {
      return NextResponse.json(await renameChatContact((await params).id, body.contactName, auth));
    }
    // Resolvida (2026-10-10): { resolved: true|false } tira/devolve a conversa dos filtros de espera.
    if (typeof body?.resolved === "boolean") {
      await setChatConversationResolved((await params).id, body.resolved, auth);
      return NextResponse.json({ ok: true });
    }
    if (typeof body?.private === "boolean") {
      await setChatConversationPrivate((await params).id, body.private, auth);
      return NextResponse.json({ ok: true });
    }
    await updateChatConversationStatus((await params).id, body?.status, auth);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return chatErrorResponse(error);
  }
}

// "Excluir conversa": soft delete (tira da caixa do Chat; não mexe no cliente nem no resto do CRM).
export async function DELETE(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json(await deleteChatConversation((await params).id, auth));
  } catch (error) {
    return chatErrorResponse(error);
  }
}
