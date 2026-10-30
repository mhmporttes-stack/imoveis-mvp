import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { suggestChatReply } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Sugerir resposta" (WA-37, dono, 2026-10-30): devolve só o rascunho { text } para a caixa de texto — nunca envia.
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json(await suggestChatReply((await params).id, auth));
  } catch (error) {
    return chatErrorResponse(error);
  }
}
