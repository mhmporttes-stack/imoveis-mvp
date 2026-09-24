import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { duplicateWhatsappFlow } from "@/lib/whatsapp-flows";
import { flowErrorResponse } from "../../flow-errors";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    return NextResponse.json({ flow: await duplicateWhatsappFlow(id, auth) }, { status: 201 });
  } catch (error) {
    return flowErrorResponse(error, "Não foi possível duplicar o fluxo.");
  }
}
