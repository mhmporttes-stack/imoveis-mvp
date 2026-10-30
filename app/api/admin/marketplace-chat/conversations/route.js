import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listMarketplaceConversations } from "@/lib/marketplace-chat";
import { marketplaceChatErrorResponse } from "../errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Lista do Chat do Marketplace: admin vê tudo; gestor a equipe; corretor/associado só as atribuídas a ele (escopo no lib).
// ?view=all|mine|brokers|unassigned, ?brokerId= e ?q= (busca pelo nome, dono 2026-10-29) só restringem dentro do escopo; ?tab=waiting_us = aba "Sem resposta" (WA-38).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await listMarketplaceConversations(auth, { view: params.get("view") || "all", brokerId: params.get("brokerId") || "", search: params.get("q") || "", tab: params.get("tab") === "waiting_us" ? "waiting_us" : "all" }));
  } catch (error) {
    return marketplaceChatErrorResponse(error, "Não foi possível carregar as conversas.");
  }
}
