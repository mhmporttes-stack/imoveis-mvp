import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { publishWhatsappFlow } from "@/lib/whatsapp-flows";
import { flowErrorResponse } from "../../flow-errors";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    return NextResponse.json({ flow: await publishWhatsappFlow(id, auth) });
  } catch (error) {
    return flowErrorResponse(error, "Não foi possível ativar o fluxo.");
  }
}
