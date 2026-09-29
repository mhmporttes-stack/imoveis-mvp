import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { changeCcaStatus } from "@/lib/client-cca-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { clientId, statusId, ccaId?, observation? } — muda o sub-status de
// acompanhamento na CCA (transição livre, sem ordem obrigatória). A checagem
// assertGeneralAdminOrManager acontece dentro de changeCcaStatus, nunca aqui.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    return NextResponse.json({ history: await changeCcaStatus({ ...body, auth }) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}
