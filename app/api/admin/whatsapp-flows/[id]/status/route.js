import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { setWhatsappFlowStatus } from "@/lib/whatsapp-flows";
import { flowErrorResponse } from "../../flow-errors";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ flow: await setWhatsappFlowStatus(id, body.status, auth) });
  } catch (error) {
    return flowErrorResponse(error, "Não foi possível alterar o status do fluxo.");
  }
}
