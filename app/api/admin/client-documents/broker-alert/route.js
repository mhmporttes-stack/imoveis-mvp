import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { buildBrokerAlertMessage } from "@/lib/broker-alert";
import { formatClientDocumentsError } from "@/lib/client-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { clientId } — monta a mensagem de alerta pro corretor responsável
// (item 1 do pedido). auth?.status controla 403 quando não é gestor/admin.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    const alert = await buildBrokerAlertMessage(body.clientId, auth);
    return NextResponse.json({ alert });
  } catch (error) {
    return NextResponse.json({ error: formatClientDocumentsError(error) }, { status: error?.status || 400 });
  }
}
