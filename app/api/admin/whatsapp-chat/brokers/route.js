import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listChatBrokers } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lista para filtrar a visão geral / atribuir conversas — só gestor e admin.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json({ brokers: await listChatBrokers(auth) });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
