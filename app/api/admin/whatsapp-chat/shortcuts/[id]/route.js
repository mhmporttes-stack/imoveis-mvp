import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { deleteChatShortcut, updateChatShortcut } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ shortcut: await updateChatShortcut((await params).id, body, auth) });
  } catch (error) {
    return chatErrorResponse(error);
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json(await deleteChatShortcut((await params).id, auth));
  } catch (error) {
    return chatErrorResponse(error);
  }
}
