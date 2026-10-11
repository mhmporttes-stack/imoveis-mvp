import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { removeChatGroup } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Remover do chat" um grupo do WhatsApp (2026-10-11): só o dono (checagem em removeChatGroup). Apaga as mensagens e
// os arquivos guardados do grupo e para de receber as próximas.
export async function DELETE(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json({ ok: true, ...(await removeChatGroup((await params).id, auth)) });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
