import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { assertSupportQueueAccess, listSupportQueue } from "@/lib/support-tickets";
import { supportErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fila de chamados: SÓ O DONO, conta real fora de "Alterar conta" (gestor e demais perfis recebem 403).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    assertSupportQueueAccess(auth);
    const status = request.nextUrl.searchParams.get("status") || "";
    return NextResponse.json({ tickets: await listSupportQueue(auth, { status }) });
  } catch (error) {
    return supportErrorResponse(error, "Não consegui carregar a fila de chamados.");
  }
}
