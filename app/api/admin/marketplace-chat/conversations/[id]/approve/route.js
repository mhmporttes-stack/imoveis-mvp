import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { approveMarketplaceConversation } from "@/lib/marketplace-chat";
import { isUuid } from "@/lib/short-links.mjs";
import { marketplaceChatErrorResponse } from "../../../errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — "Aprovar atendimento" (MKT-2m, dono 2026-10-26): conversa do acumulado com texto diferente da pergunta padrão sai
// de "aguardando aprovação" e vai pela entrega de sempre (roleta / fila de espera). Só admin geral (2ª trava no lib).
export async function POST(request, { params }) {
  const auth = await requireGeneralAdminApi(request, "Só o administrador geral aprova o atendimento.");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  try {
    return NextResponse.json(await approveMarketplaceConversation(id, auth));
  } catch (error) {
    return marketplaceChatErrorResponse(error, "Não foi possível aprovar o atendimento.");
  }
}
