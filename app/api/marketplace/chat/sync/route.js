import { NextResponse } from "next/server";
import { syncMarketplaceConversations } from "@/lib/marketplace-chat";
import { rejectExtensionRequest } from "../extension-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Extensão → CRM: conversas do Marketplace (só elas) com as mensagens novas. Idempotente (id externo por conversa).
// Também roda a fila de espera e o prazo sem resposta da roleta. Devolve a configuração do Chat do Marketplace.
export async function POST(request) {
  const rejected = await rejectExtensionRequest(request, "marketplace-chat-sync");
  if (rejected) return rejected;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  try {
    return NextResponse.json(await syncMarketplaceConversations(body));
  } catch (error) {
    return NextResponse.json({ error: error?.status ? error.message : "Não foi possível sincronizar." }, { status: error?.status || 500 });
  }
}
