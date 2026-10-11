import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { requestChatOlderHistory } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Carregar mensagens anteriores do celular" (só WhatsApp pessoal conectado; mesmo escopo de quem abre a conversa).
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json(await requestChatOlderHistory((await params).id, auth));
  } catch (error) {
    return chatErrorResponse(error);
  }
}
