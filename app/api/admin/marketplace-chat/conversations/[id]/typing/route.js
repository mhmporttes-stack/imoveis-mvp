import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { markMarketplaceComposerActivity } from "@/lib/marketplace-chat";
import { isUuid } from "@/lib/short-links.mjs";
import { marketplaceChatErrorResponse } from "../../../errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — alguém da equipe começou a digitar na conversa: cancela a resposta automática de disponibilidade ainda na fila
// (MKT-2l, dono 2026-10-24: "para assim que o corretor digitar"). Mesmo escopo de quem pode abrir a conversa (no lib).
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  try {
    return NextResponse.json(await markMarketplaceComposerActivity(id, auth));
  } catch (error) {
    return marketplaceChatErrorResponse(error, "Não foi possível registrar a digitação.");
  }
}
