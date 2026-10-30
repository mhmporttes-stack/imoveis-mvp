import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { linkMarketplaceConversationWhatsapp } from "@/lib/marketplace-chat";
import { isUuid } from "@/lib/short-links.mjs";
import { marketplaceChatErrorResponse } from "../../../errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "Criar/vincular cliente" { name, phone } (MKT-4, dono 2026-10-30): cria o cliente se faltar e grava o WhatsApp que o
// cliente mandou na conversa. Escopo da conversa e do cliente, Não contactar e validação do número no servidor. Não envia nada.
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json(await linkMarketplaceConversationWhatsapp(id, { name: body?.name, phone: body?.phone }, auth));
  } catch (error) {
    return marketplaceChatErrorResponse(error, "Não foi possível criar/vincular o cliente.");
  }
}
