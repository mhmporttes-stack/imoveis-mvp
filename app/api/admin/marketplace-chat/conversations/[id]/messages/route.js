import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { queueMarketplaceReply } from "@/lib/marketplace-chat";
import { isUuid } from "@/lib/short-links.mjs";
import { marketplaceChatErrorResponse } from "../../../errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Resposta do corretor: entra na fila; a extensão no PC do dono envia pelo Facebook (atraso de ~1–2 min).
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json(await queueMarketplaceReply(id, body?.text, auth));
  } catch (error) {
    return marketplaceChatErrorResponse(error, "Não foi possível enviar a mensagem.");
  }
}
