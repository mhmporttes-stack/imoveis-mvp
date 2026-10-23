import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { saveMarketplaceInternalNote } from "@/lib/marketplace-chat";
import { isUuid } from "@/lib/short-links.mjs";
import { marketplaceChatErrorResponse } from "../../../errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Mensagem INTERNA do Chat do Marketplace (MKT-2i): fica só no CRM, nunca vai à fila da extensão nem ao Facebook.
// Permissão no lib (escopo da conversa + responsável, gestão ou administrador — o mesmo critério do Chat do WhatsApp).
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json({ message: await saveMarketplaceInternalNote(id, body?.text, auth) }, { status: 201 });
  } catch (error) {
    return marketplaceChatErrorResponse(error, "Não foi possível salvar a mensagem interna.");
  }
}
