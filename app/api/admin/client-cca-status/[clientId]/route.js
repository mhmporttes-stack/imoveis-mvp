import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getCurrentCcaStatus, listCcaStatusHistory } from "@/lib/client-cca-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — status atual + histórico completo do cliente. listCcaStatusHistory
// já aplica o mesmo escopo de acesso usado no resto da Documentação
// (getSimulationRegistration valida se este `auth` pode ver este cliente).
export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const clientId = (await params).clientId;
    const [current, history] = await Promise.all([
      getCurrentCcaStatus(clientId),
      listCcaStatusHistory(clientId, auth)
    ]);
    return NextResponse.json({ current, history });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}
