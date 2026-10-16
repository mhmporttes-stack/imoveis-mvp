import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getCooledHandoff } from "@/lib/cooled-clients";
import { cooledErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resumo + mensagem sugerida para o novo corretor de um cliente TRANSFERIDO pelo fluxo de clientes que esfriaram.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const clientId = new URL(request.url).searchParams.get("clientId") || "";
    return NextResponse.json({ handoff: await getCooledHandoff(auth, clientId) });
  } catch (error) {
    return cooledErrorResponse(error);
  }
}
