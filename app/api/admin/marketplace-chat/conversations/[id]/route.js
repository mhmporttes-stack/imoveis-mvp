import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { assignMarketplaceConversation, getMarketplaceConversation } from "@/lib/marketplace-chat";
import { isUuid } from "@/lib/short-links.mjs";
import { marketplaceChatErrorResponse } from "../../errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  try {
    return NextResponse.json(await getMarketplaceConversation(id, auth));
  } catch (error) {
    return marketplaceChatErrorResponse(error, "Não foi possível abrir a conversa.");
  }
}

// PATCH { assignedUserId } — transferir (só gestor/admin, dentro do escopo; checado no lib).
export async function PATCH(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  const body = await request.json().catch(() => null);
  const userId = body?.assignedUserId || null;
  if (userId && !isUuid(userId)) return NextResponse.json({ error: "Pessoa inválida." }, { status: 400 });
  try {
    await assignMarketplaceConversation(id, userId, auth);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return marketplaceChatErrorResponse(error, "Não foi possível transferir a conversa.");
  }
}
