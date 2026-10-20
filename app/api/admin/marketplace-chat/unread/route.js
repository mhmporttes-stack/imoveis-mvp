import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { countMarketplaceUnread } from "@/lib/marketplace-chat";
import { marketplaceChatErrorResponse } from "../errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Contador do menu "Chat Marketplace": não lidas nas conversas que a pessoa enxerga (escopo no lib).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ unread: await countMarketplaceUnread(auth) });
  } catch (error) {
    return marketplaceChatErrorResponse(error, "Não foi possível contar as mensagens.");
  }
}
