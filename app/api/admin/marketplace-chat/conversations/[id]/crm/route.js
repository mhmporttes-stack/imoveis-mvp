import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { addMarketplaceConversationToCrm } from "@/lib/marketplace-chat";
import { isUuid } from "@/lib/short-links.mjs";
import { marketplaceChatErrorResponse } from "../../../errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "Adicionar ao CRM" { name }: cria o cliente só com o nome (origem Marketplace); o WhatsApp vem depois no card.
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json(await addMarketplaceConversationToCrm(id, { name: body?.name }, auth));
  } catch (error) {
    return marketplaceChatErrorResponse(error, "Não foi possível adicionar ao CRM.");
  }
}
