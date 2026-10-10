import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { transcribeChatAudio } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Transcrição de áudio do Chat (2026-10-10): sob demanda, mesma checagem de acesso do áudio.
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json(await transcribeChatAudio((await params).messageId, auth));
  } catch (error) {
    return chatErrorResponse(error);
  }
}
