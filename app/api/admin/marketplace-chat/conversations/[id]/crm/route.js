import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { addMarketplaceConversationToCrm } from "@/lib/marketplace-chat";
import { isUuid } from "@/lib/short-links.mjs";
import { marketplaceChatErrorResponse } from "../../../errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "Adicionar ao CRM" { name, phone }: cria/reaproveita o cliente (mesmo cadastro manual do CRM) com origem Marketplace.
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json(await addMarketplaceConversationToCrm(id, { name: body?.name, phone: body?.phone }, auth));
  } catch (error) {
    if (!error?.status && error instanceof Error && /WhatsApp|nome/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    return marketplaceChatErrorResponse(error, "Não foi possível adicionar ao CRM.");
  }
}
