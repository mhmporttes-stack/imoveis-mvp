import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { assertSupportQueueAccess, countOpenSupportTickets } from "@/lib/support-tickets";
import { supportErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Selo do botão "?" do dono: chamados sem resposta. SÓ O DONO, conta real fora de "Alterar conta" (demais = 403).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    assertSupportQueueAccess(auth);
    return NextResponse.json({ open: await countOpenSupportTickets(auth) });
  } catch (error) {
    return supportErrorResponse(error, "Não consegui contar os chamados.");
  }
}
