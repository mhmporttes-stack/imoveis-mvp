import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listMarketplaceConversations } from "@/lib/marketplace-chat";
import { marketplaceChatErrorResponse } from "../errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Lista do Chat do Marketplace: admin vê tudo; gestor a equipe; corretor/associado só as atribuídas a ele (escopo no lib).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await listMarketplaceConversations(auth));
  } catch (error) {
    return marketplaceChatErrorResponse(error, "Não foi possível carregar as conversas.");
  }
}
