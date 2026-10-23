import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listMarketplaceConversations } from "@/lib/marketplace-chat";
import { marketplaceChatErrorResponse } from "../errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Lista do Chat do Marketplace: admin vê tudo; gestor a equipe; corretor/associado só as atribuídas a ele (escopo no lib).
// ?view=all|mine|brokers|unassigned e ?brokerId= só restringem dentro do escopo.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await listMarketplaceConversations(auth, { view: params.get("view") || "all", brokerId: params.get("brokerId") || "" }));
  } catch (error) {
    return marketplaceChatErrorResponse(error, "Não foi possível carregar as conversas.");
  }
}
