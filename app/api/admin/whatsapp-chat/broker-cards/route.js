import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getChatBrokerCards } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Aba "Corretores" da Supervisão do Chat — só gestor e admin (mesma trava de listChatBrokers/getTeamPresence).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json({ brokers: await getChatBrokerCards(auth) });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
