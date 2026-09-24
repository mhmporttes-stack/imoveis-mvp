import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getClientChatWindow } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Botão "WhatsApp" dos cards de cliente: diz se o cliente está dentro da janela
// de 24h (então o atendimento abre no Chat) ou fora dela (abre o WhatsApp do
// corretor). Só leitura; respeita o escopo do usuário.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const clientId = new URL(request.url).searchParams.get("clientId");
    if (!clientId) return NextResponse.json({ error: "Informe o cliente." }, { status: 400 });
    return NextResponse.json(await getClientChatWindow(String(clientId), auth));
  } catch (error) {
    return chatErrorResponse(error);
  }
}
