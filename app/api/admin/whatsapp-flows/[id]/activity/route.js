import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { listWhatsappFlowActivity } from "@/lib/whatsapp-flows";
import { flowErrorResponse } from "../../flow-errors";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    return NextResponse.json(await listWhatsappFlowActivity(id));
  } catch (error) {
    return flowErrorResponse(error, "Não foi possível carregar a atividade do fluxo.");
  }
}
