import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { retryMarketplaceOutbound } from "@/lib/marketplace-chat";
import { isUuid } from "@/lib/short-links.mjs";
import { marketplaceChatErrorResponse } from "../../../../../errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "Tentar de novo" de uma resposta não enviada (dono, 2026-10-22: o próprio corretor, sem depender do dono). Escopo da
// conversa no lib (loadScopedConversation); antes de voltar à fila, confere se ela já saiu (eco lido do Facebook).
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id, messageId } = await params;
  if (!isUuid(id) || !isUuid(messageId)) return NextResponse.json({ error: "Mensagem inválida." }, { status: 400 });
  try {
    return NextResponse.json(await retryMarketplaceOutbound(id, messageId, auth));
  } catch (error) {
    return marketplaceChatErrorResponse(error, "Não foi possível tentar de novo.");
  }
}
